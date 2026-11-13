/**
 * 协议解释器：网页预览、调试器、Android 预览与测试共用的执行语义（规格 7.5 / 第十章 / 11.2）。
 * - 动作按数组顺序执行；某个动作出错时该事件后续动作停止，并记录错误（不影响其他事件）。
 * - 每次外部触发有动作步数预算；函数调用深度、变量连锁触发深度、循环次数都有限制。
 * - throttleMs 防止重复触发。
 * - 只解释协议里声明的动作，不执行任意脚本。
 */
import {
  coerce,
  evalExpr,
  formatDuration,
  formatTime,
  parseExpr,
  toText,
  truthy,
  ExprError,
  type Expr,
  type Value,
} from "./expr.ts";
import { PROTOCOL_LIMITS, VISIBLE_PROP } from "./limits.ts";
import type {
  ActionNode,
  EventDoc,
  FunctionDoc,
  ProjectDoc,
  Trigger,
} from "./schema.ts";

export const RUNTIME_LIMITS = { stepsPerDispatch: 2000, chainDepth: 4, traceSize: 300 };

export type TraceEntry = {
  seq: number;
  at: number;
  kind: "event" | "action" | "call" | "var" | "error" | "warn" | "page";
  ref: string;
  message: string;
  /** 事件执行用时（毫秒，真实耗时，不受模拟时钟影响）。 */
  ms?: number;
};

const perfNow = () =>
  typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();

export type TimerState = { running: boolean; startedAt: number; elapsedMs: number; done: boolean };

export type RuntimeState = {
  pageId: string;
  stack: string[];
  loaded: string[];
  vars: Record<string, Value>;
  props: Record<string, Record<string, Value>>;
  timers: Record<string, TimerState>;
  toast: string;
  lastFired: Record<string, number>;
  lastTick: number;
};

type Frame = { fn?: FunctionDoc; locals: Record<string, Value>; returned?: { value: Value } };
class Abort extends Error {}

export class Runtime {
  readonly doc: ProjectDoc;
  state: RuntimeState;
  trace: TraceEntry[] = [];
  private seq = 0;
  private clock: () => number;
  private steps = 0;
  private chain = 0;
  private callDepth = 0;
  private parsed = new Map<string, Expr>();
  private pageOf = new Map<string, string>();

  private onVarChange?: (variableId: string, value: Value) => void;

  /**
   * opts.initialVars：按变量 ID 覆盖初始值（手表端从本地存储恢复的持久化变量），会按变量类型转换。
   * opts.onVarChange：变量值变化后回调（手表端用来写回本地存储）。
   */
  constructor(
    doc: ProjectDoc,
    opts: {
      now?: () => number;
      initialVars?: Record<string, Value>;
      onVarChange?: (variableId: string, value: Value) => void;
    } = {},
  ) {
    this.doc = doc;
    this.clock = opts.now ?? (() => Date.now());
    this.onVarChange = opts.onVarChange;
    for (const p of doc.pages) for (const c of p.components) this.pageOf.set(c.id, p.id);
    const vars: Record<string, Value> = {};
    for (const v of doc.variables) {
      const saved = opts.initialVars?.[v.id];
      let value = v.default as Value;
      if (saved !== undefined) {
        try {
          value = coerce(saved, v.type);
        } catch {
          value = v.default as Value;
        }
      }
      vars[v.id] = value;
    }
    const props: Record<string, Record<string, Value>> = {};
    for (const p of doc.pages)
      for (const c of p.components) props[c.id] = { ...c.props, [VISIBLE_PROP]: !c.hidden };
    const timers: Record<string, TimerState> = {};
    for (const t of doc.timers)
      timers[t.id] = { running: false, startedAt: 0, elapsedMs: 0, done: false };
    this.state = {
      pageId: doc.startPageId,
      stack: [],
      loaded: [],
      vars,
      props,
      timers,
      toast: "",
      lastFired: {},
      lastTick: this.clock(),
    };
  }

  /* ---------- 外部入口 ---------- */

  start() {
    this.dispatch({ kind: "system", event: "appStart" });
    this.enterPage(this.state.pageId);
  }

  /** 组件交互：click / longPress / change 等。value 为 change 事件的新值。 */
  interact(
    componentId: string,
    event: Extract<Trigger, { kind: "component" }>["event"],
    value?: Value,
  ) {
    if (this.pageOf.get(componentId) !== this.state.pageId) return;
    if (!this.visible(componentId)) return;
    if (event === "change" && value !== undefined && this.state.props[componentId]) {
      const comp = this.component(componentId);
      if (comp?.type === "switch") this.state.props[componentId].checked = truthy(value);
    }
    this.dispatch({ kind: "component", componentId, event }, value);
  }

  system(event: "appResume" | "appBackground") {
    this.dispatch({ kind: "system", event });
  }

  /** 导航栏等外部入口打开页面（与 navigate 动作语义相同）。 */
  openPage(pageId: string) {
    if (pageId === this.state.pageId || !this.doc.pages.some((p) => p.id === pageId)) return;
    this.steps = 0;
    this.dispatch({ kind: "page", pageId: this.state.pageId, event: "hide" });
    this.state.stack.push(this.state.pageId);
    this.enterPage(pageId);
  }

  /**
   * 页面被系统返回手势等外部方式关闭后，把运行时同步回 pageId（与 back 动作语义相同）。
   * 目标不在页面栈里时直接进入该页面。
   */
  externalBack(pageId: string) {
    if (pageId === this.state.pageId) return;
    this.steps = 0;
    while (this.state.pageId !== pageId) {
      const leaving = this.state.pageId;
      this.dispatch({ kind: "page", pageId: leaving, event: "hide" });
      this.dispatch({ kind: "page", pageId: leaving, event: "exit" });
      this.state.loaded = this.state.loaded.filter((id) => id !== leaving);
      const prev = this.state.stack.pop();
      if (prev === undefined) {
        this.enterPage(pageId);
        return;
      }
      if (prev === pageId) {
        this.enterPage(prev);
        return;
      }
      this.state.pageId = prev;
    }
  }

  /** 调试器：手动触发某个事件（忽略触发器条件，但仍检查启用状态和条件表达式）。 */
  fire(eventId: string) {
    const ev = this.doc.events.find((e) => e.id === eventId);
    if (!ev) return;
    if (!ev.enabled) {
      this.log("warn", ev.id, "事件已停用，未执行");
      return;
    }
    this.steps = 0;
    this.runEvent(ev);
  }

  /** 调试器：直接修改变量当前值（会触发变量事件）。 */
  setVariable(variableId: string, value: Value) {
    this.steps = 0;
    try {
      this.setVar(variableId, value);
    } catch (error) {
      this.log("error", variableId, (error as Error).message);
    }
  }

  /** 推进时间：处理计时器和时间事件。网页预览每秒调用；测试里可以直接跳到任意时间。 */
  tick(now = this.clock()) {
    const prev = this.state.lastTick;
    this.state.lastTick = now;
    for (const t of this.doc.timers) {
      const st = this.state.timers[t.id];
      if (!st?.running) continue;
      st.elapsedMs = now - st.startedAt;
      if (t.kind === "countdown" && st.elapsedMs >= t.durationSec * 1000) {
        st.elapsedMs = t.durationSec * 1000;
        st.running = false;
        st.done = true;
        this.log("event", t.id, `计时器 ${t.name} 结束`);
        this.dispatch({ kind: "time", event: "timerEnd", timerId: t.id });
      }
    }
    const a = new Date(prev);
    const b = new Date(now);
    if (now <= prev) return;
    const changed = (f: (d: Date) => number) => f(a) !== f(b) || now - prev >= 86_400_000;
    if (Math.floor(now / 1000) !== Math.floor(prev / 1000))
      this.dispatch({ kind: "time", event: "everySecond" });
    if (Math.floor(now / 60_000) !== Math.floor(prev / 60_000)) {
      this.dispatch({ kind: "time", event: "everyMinute" });
      const hm = formatTime(now, "HH:mm");
      for (const ev of this.doc.events) {
        if (ev.trigger.kind === "time" && ev.trigger.event === "at" && ev.trigger.at === hm)
          this.runEvent(ev);
      }
    }
    if (Math.floor(now / 3_600_000) !== Math.floor(prev / 3_600_000))
      this.dispatch({ kind: "time", event: "everyHour" });
    if (changed((d) => d.getDate())) this.dispatch({ kind: "time", event: "dateChange" });
    if (changed((d) => Math.floor((d.getTime() / 86_400_000 + 4) / 7)))
      this.dispatch({ kind: "time", event: "weekChange" });
  }

  /** 组件当前要显示的属性（含绑定计算结果）。 */
  resolvedProps(componentId: string): Record<string, Value> {
    const base = { ...(this.state.props[componentId] ?? {}) };
    for (const b of this.doc.bindings) {
      if (b.componentId !== componentId) continue;
      try {
        base[b.prop] = this.bindingValue(b);
      } catch (error) {
        this.log("error", b.id, `绑定计算失败：${(error as Error).message}`);
      }
    }
    return base;
  }

  visible(componentId: string): boolean {
    return truthy(this.resolvedProps(componentId)[VISIBLE_PROP] ?? true);
  }

  varByKey(key: string): Value | undefined {
    const v = this.doc.variables.find((x) => x.key === key);
    return v ? this.state.vars[v.id] : undefined;
  }

  /* ---------- 内部 ---------- */

  private component(id: string) {
    for (const p of this.doc.pages) for (const c of p.components) if (c.id === id) return c;
    return undefined;
  }

  private log(kind: TraceEntry["kind"], ref: string, message: string) {
    this.trace.push({ seq: ++this.seq, at: this.clock(), kind, ref, message });
    if (this.trace.length > RUNTIME_LIMITS.traceSize)
      this.trace.splice(0, this.trace.length - RUNTIME_LIMITS.traceSize);
  }

  private matches(ev: EventDoc, t: Trigger): boolean {
    const a = ev.trigger;
    if (a.kind !== t.kind || a.event !== t.event) return false;
    if (a.kind === "component" && t.kind === "component") return a.componentId === t.componentId;
    if (a.kind === "page" && t.kind === "page") return a.pageId === t.pageId;
    if (a.kind === "time" && t.kind === "time") {
      if (a.pageId && a.pageId !== this.state.pageId) return false;
      if (a.event === "timerEnd") return a.timerId === t.timerId;
      return a.event !== "at";
    }
    if (a.kind === "variable" && t.kind === "variable") return a.variableId === t.variableId;
    return a.kind === "system";
  }

  private dispatch(t: Trigger, value?: Value) {
    const top = this.chain === 0;
    if (top) this.steps = 0;
    for (const ev of this.doc.events)
      if (ev.enabled && this.matches(ev, t)) this.runEvent(ev, value);
  }

  private runEvent(ev: EventDoc, value?: Value) {
    const now = this.clock();
    if (ev.throttleMs && now - (this.state.lastFired[ev.id] ?? -Infinity) < ev.throttleMs) {
      this.log("warn", ev.id, "触发过于频繁，已忽略");
      return;
    }
    this.state.lastFired[ev.id] = now;
    const frame: Frame = { locals: value === undefined ? {} : { _value: value } };
    try {
      if (ev.condition && !truthy(this.evaluate(ev.condition, frame))) {
        this.log("event", ev.id, `${ev.name ?? ev.id}：条件不满足，跳过`);
        return;
      }
      this.log("event", ev.id, `${ev.name ?? ev.id} 触发`);
      const t0 = perfNow();
      try {
        this.runList(ev.actions, frame);
      } finally {
        const ms = Math.round((perfNow() - t0) * 100) / 100;
        this.trace.push({ seq: ++this.seq, at: this.clock(), kind: "event", ref: ev.id, message: `${ev.name ?? ev.id} 结束`, ms });
        if (this.trace.length > RUNTIME_LIMITS.traceSize)
          this.trace.splice(0, this.trace.length - RUNTIME_LIMITS.traceSize);
      }
    } catch (error) {
      if (!(error instanceof Abort)) this.log("error", ev.id, (error as Error).message);
    }
  }

  private expr(src: string): Expr {
    let e = this.parsed.get(src);
    if (!e) {
      e = parseExpr(src);
      this.parsed.set(src, e);
    }
    return e;
  }

  private scopeLookup(frame: Frame, pageId: string) {
    return (name: string): Value | undefined => {
      if (Object.prototype.hasOwnProperty.call(frame.locals, name)) return frame.locals[name];
      let found: Value | undefined;
      for (const v of this.doc.variables) {
        if (v.key !== name) continue;
        if (v.scope === "global") found ??= this.state.vars[v.id];
        else {
          const owner = v.scope === "page" ? v.ownerId : this.pageOf.get(v.ownerId ?? "");
          if (owner === pageId) return this.state.vars[v.id];
        }
      }
      return found;
    };
  }

  private evaluate(src: string, frame: Frame, pageId = this.state.pageId): Value {
    return evalExpr(this.expr(src), {
      get: this.scopeLookup(frame, pageId),
      now: () => this.clock(),
    });
  }

  private runList(list: ActionNode[], frame: Frame) {
    for (const a of list) {
      if (frame.returned) return;
      if (++this.steps > RUNTIME_LIMITS.stepsPerDispatch) {
        this.log("error", a.id, "执行步数超过限制，已停止（可能存在死循环）");
        throw new Abort();
      }
      try {
        this.run(a, frame);
      } catch (error) {
        if (error instanceof Abort) throw error;
        const msg =
          error instanceof ExprError ? `表达式错误：${error.message}` : (error as Error).message;
        this.log("error", a.id, `${a.kind} 失败：${msg}`);
        throw new Abort();
      }
    }
  }

  private setVar(id: string, value: Value) {
    const v = this.doc.variables.find((x) => x.id === id);
    if (!v) throw new Error("变量不存在");
    const next = coerce(value, v.type);
    const prev = this.state.vars[id];
    this.state.vars[id] = next;
    this.log("var", id, `${v.key} = ${toText(next)}`);
    if (JSON.stringify(prev) === JSON.stringify(next)) return;
    if (this.onVarChange) {
      try {
        this.onVarChange(id, next);
      } catch (error) {
        this.log("warn", id, `保存变量失败：${(error as Error).message}`);
      }
    }
    if (this.chain >= RUNTIME_LIMITS.chainDepth) {
      this.log(
        "warn",
        id,
        `变量连锁触发超过 ${RUNTIME_LIMITS.chainDepth} 层，已停止继续触发（检查是否存在循环）`,
      );
      return;
    }
    this.chain++;
    try {
      for (const ev of this.doc.events) {
        const t = ev.trigger;
        if (!ev.enabled || t.kind !== "variable" || t.variableId !== id) continue;
        const frame: Frame = { locals: { _value: next } };
        let fire = false;
        if (t.event === "change") fire = true;
        else if (t.event === "equals")
          fire =
            JSON.stringify(this.evaluate(t.value ?? "null", frame)) === JSON.stringify(next) ||
            toText(this.evaluate(t.value ?? "null", frame)) === toText(next);
        else if (t.event === "condition") fire = truthy(this.evaluate(t.value ?? "false", frame));
        else if (t.event === "enterRange" || t.event === "leaveRange") {
          const inside = (x: Value) =>
            typeof x === "number" && x >= (t.min ?? -Infinity) && x <= (t.max ?? Infinity);
          fire =
            t.event === "enterRange"
              ? !inside(prev) && inside(next)
              : inside(prev) && !inside(next);
        }
        if (fire) this.runEvent(ev, next);
      }
    } finally {
      this.chain--;
    }
  }

  private enterPage(pageId: string) {
    this.state.pageId = pageId;
    this.log(
      "page",
      pageId,
      `进入页面 ${this.doc.pages.find((p) => p.id === pageId)?.name ?? pageId}`,
    );
    if (!this.state.loaded.includes(pageId)) {
      this.state.loaded.push(pageId);
      this.dispatch({ kind: "page", pageId, event: "load" });
    }
    this.dispatch({ kind: "page", pageId, event: "show" });
  }

  private run(a: ActionNode, frame: Frame) {
    this.log("action", a.id, a.kind);
    switch (a.kind) {
      case "navigate":
        if (a.pageId === this.state.pageId) return;
        this.dispatch({ kind: "page", pageId: this.state.pageId, event: "hide" });
        this.state.stack.push(this.state.pageId);
        this.enterPage(a.pageId);
        return;
      case "back": {
        const prev = this.state.stack.pop();
        if (!prev) return;
        const leaving = this.state.pageId;
        this.dispatch({ kind: "page", pageId: leaving, event: "hide" });
        this.dispatch({ kind: "page", pageId: leaving, event: "exit" });
        this.state.loaded = this.state.loaded.filter((id) => id !== leaving);
        this.enterPage(prev);
        return;
      }
      case "toast":
        this.state.toast = toText(this.evaluate(a.text, frame));
        return;
      case "log":
        this.log("action", a.id, `日志：${toText(this.evaluate(a.text, frame))}`);
        return;
      case "show":
      case "hide":
      case "toggle": {
        const props = this.state.props[a.componentId];
        if (!props) throw new Error("组件不存在");
        props[VISIBLE_PROP] =
          a.kind === "toggle" ? !truthy(props[VISIBLE_PROP] ?? true) : a.kind === "show";
        return;
      }
      case "setProp": {
        const props = this.state.props[a.componentId];
        if (!props) throw new Error("组件不存在");
        props[a.prop] = this.evaluate(a.value, frame);
        return;
      }
      case "setVar":
        this.setVar(a.variableId, this.evaluate(a.value, frame));
        return;
      case "setLocal":
        frame.locals[a.name] = this.evaluate(a.value, frame);
        return;
      case "call": {
        const result = this.call(a.functionId, a.args, frame);
        if (a.resultVariableId) this.setVar(a.resultVariableId, result);
        if (a.resultLocal) frame.locals[a.resultLocal] = result;
        return;
      }
      case "if":
        this.runList(truthy(this.evaluate(a.condition, frame)) ? a.then : a.else, frame);
        return;
      case "repeat": {
        const times = Math.trunc(Number(this.evaluate(a.times, frame)));
        if (!Number.isFinite(times) || times < 0) throw new Error("循环次数无效");
        if (times > PROTOCOL_LIMITS.repeatMax)
          throw new Error(`循环次数不能超过 ${PROTOCOL_LIMITS.repeatMax}`);
        for (let i = 0; i < times && !frame.returned; i++) this.runList(a.body, frame);
        return;
      }
      case "forEach": {
        const list = this.evaluate(a.list, frame);
        if (!Array.isArray(list)) throw new Error("遍历的不是列表");
        for (const item of list.slice(0, PROTOCOL_LIMITS.repeatMax)) {
          if (frame.returned) break;
          frame.locals[a.item] = item;
          this.runList(a.body, frame);
        }
        return;
      }
      case "return":
        frame.returned = { value: a.value ? this.evaluate(a.value, frame) : null };
        return;
      case "startTimer": {
        const st = this.state.timers[a.timerId];
        if (!st) throw new Error("计时器不存在");
        if (!st.running) {
          st.running = true;
          st.done = false;
          st.startedAt = this.clock() - st.elapsedMs;
        }
        return;
      }
      case "stopTimer": {
        const st = this.state.timers[a.timerId];
        if (!st) throw new Error("计时器不存在");
        if (st.running) st.elapsedMs = this.clock() - st.startedAt;
        st.running = false;
        return;
      }
      case "resetTimer": {
        const st = this.state.timers[a.timerId];
        if (!st) throw new Error("计时器不存在");
        Object.assign(st, { running: false, startedAt: 0, elapsedMs: 0, done: false });
        return;
      }
    }
  }

  /** 调用自定义函数并返回结果（无返回值时为 null）。 */
  call(functionId: string, args: Record<string, string>, caller: Frame = { locals: {} }): Value {
    const fn = this.doc.functions.find((f) => f.id === functionId);
    if (!fn) throw new Error("函数不存在");
    if (this.callDepth >= PROTOCOL_LIMITS.callDepth)
      throw new Error(`函数调用超过 ${PROTOCOL_LIMITS.callDepth} 层`);
    const locals: Record<string, Value> = {};
    for (const p of fn.params) {
      const src = args[p.name] ?? p.default;
      if (src === undefined) throw new Error(`缺少参数 ${p.name}`);
      locals[p.name] = coerce(
        this.evaluate(src, args[p.name] !== undefined ? caller : { locals: {} }),
        p.type,
      );
    }
    for (const l of fn.locals)
      locals[l.name] =
        l.type === "string"
          ? ""
          : l.type === "bool"
            ? false
            : l.type === "array"
              ? []
              : l.type === "object"
                ? {}
                : 0;
    const frame: Frame = { fn, locals };
    this.callDepth++;
    this.log(
      "call",
      fn.id,
      `调用 ${fn.name}(${fn.params.map((p) => `${p.name}=${toText(locals[p.name])}`).join(", ")})`,
    );
    try {
      this.runList(fn.body, frame);
    } finally {
      this.callDepth--;
    }
    const value = frame.returned?.value ?? null;
    const out = fn.returnType === "void" ? null : coerce(value, fn.returnType);
    this.log("call", fn.id, `${fn.name} 返回 ${toText(out)}`);
    return out;
  }

  private bindingValue(b: ProjectDoc["bindings"][number]): Value {
    const pageId = this.pageOf.get(b.componentId) ?? this.state.pageId;
    const now = this.clock();
    if (b.source.kind === "variable") return this.state.vars[b.source.variableId] ?? null;
    if (b.source.kind === "expr") return this.evaluate(b.source.expr, { locals: {} }, pageId);
    const f = b.source.field;
    if (f.startsWith("timer")) {
      const timer = this.doc.timers.find(
        (t) => t.id === (b.source as { timerId?: string }).timerId,
      );
      const st = timer ? this.state.timers[timer.id] : undefined;
      if (!timer || !st) return null;
      const elapsed = st.running ? now - st.startedAt : st.elapsedMs;
      const total = timer.durationSec * 1000;
      if (f === "timerElapsed")
        return b.format ? formatDuration(elapsed, b.format) : Math.floor(elapsed / 1000);
      if (f === "timerRemaining") {
        const left = Math.max(0, total - elapsed);
        return b.format ? formatDuration(left, b.format) : Math.ceil(left / 1000);
      }
      return Math.round(Math.min(100, (elapsed / total) * 100));
    }
    const d = new Date(now);
    if (b.format) return formatTime(now, b.format);
    switch (f) {
      case "now":
      case "timestamp":
        return now;
      case "year":
        return d.getFullYear();
      case "month":
        return d.getMonth() + 1;
      case "day":
        return d.getDate();
      case "hour":
        return d.getHours();
      case "minute":
        return d.getMinutes();
      case "second":
        return d.getSeconds();
      case "weekday":
        return d.getDay();
    }
    return null;
  }
}
