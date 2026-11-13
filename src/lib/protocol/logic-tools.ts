/**
 * 逻辑编辑器用的纯函数：作用域类型、引用查找、变量改名、新建事件/动作、中文描述、问题定位。
 * 网页编辑器和测试共用；Android 客户端按同样规则实现（见 docs/11-逻辑编辑器.md）。
 */
import { identifiersOf, renameIdentifier, type ValueType } from "./expr.ts";
import type {
  ActionNode,
  BindingDoc,
  EventDoc,
  FunctionDoc,
  ProjectDoc,
  Trigger,
  VariableDoc,
  VarType,
} from "./schema.ts";

export type Logic = Pick<ProjectDoc, "variables" | "events" | "functions" | "timers" | "bindings">;
type Pages = Pick<ProjectDoc, "pages">;

export function newId(prefix: string): string {
  const bytes = new Uint8Array(4);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256);
  return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 组件/页面所在页。 */
export function pageOfOwner(doc: Pages, ownerId?: string): string | undefined {
  if (!ownerId) return undefined;
  for (const p of doc.pages) {
    if (p.id === ownerId) return p.id;
    if (p.components.some((c) => c.id === ownerId)) return p.id;
  }
  return undefined;
}

/** 某个位置可见的变量类型表（与校验器规则一致）。 */
export function typesInScope(
  doc: Pages & Pick<Logic, "variables">,
  pageId?: string,
  extra: Record<string, ValueType> = {},
): Record<string, ValueType> {
  const types: Record<string, ValueType> = {};
  for (const v of doc.variables) if (v.scope === "global") types[v.key] = v.type;
  if (pageId)
    for (const v of doc.variables)
      if (v.scope !== "global" && pageOfOwner(doc, v.ownerId) === pageId) types[v.key] = v.type;
  return { ...types, ...extra };
}

export function functionLocals(fn: FunctionDoc): Record<string, ValueType> {
  const out: Record<string, ValueType> = {};
  for (const p of fn.params) out[p.name] = p.type;
  for (const l of fn.locals) out[l.name] = l.type;
  return out;
}

/** 事件运行时所在页面（页面/组件事件有；时间事件可限定页面）。 */
export function eventPage(doc: Pages, ev: EventDoc): string | undefined {
  const t = ev.trigger;
  if (t.kind === "page") return t.pageId;
  if (t.kind === "component") return pageOfOwner(doc, t.componentId);
  if (t.kind === "time") return t.pageId || undefined;
  return undefined;
}

/* ---------------- 表达式字段遍历 ---------------- */

type ExprVisitor = (src: string, where: string) => string;

function mapActionExprs(list: ActionNode[], f: ExprVisitor, where: string): ActionNode[] {
  return list.map((a, i) => {
    const w = `${where}.${i}`;
    switch (a.kind) {
      case "toast":
      case "log":
        return { ...a, text: f(a.text, `${w}.text`) };
      case "setProp":
      case "setVar":
      case "setLocal":
        return { ...a, value: f(a.value, `${w}.value`) };
      case "call":
        return {
          ...a,
          args: Object.fromEntries(
            Object.entries(a.args).map(([k, v]) => [k, f(v, `${w}.args.${k}`)]),
          ),
        };
      case "if":
        return {
          ...a,
          condition: f(a.condition, `${w}.condition`),
          then: mapActionExprs(a.then, f, `${w}.then`),
          else: mapActionExprs(a.else, f, `${w}.else`),
        };
      case "repeat":
        return { ...a, times: f(a.times, `${w}.times`), body: mapActionExprs(a.body, f, `${w}.body`) };
      case "forEach":
        return { ...a, list: f(a.list, `${w}.list`), body: mapActionExprs(a.body, f, `${w}.body`) };
      case "return":
        return a.value === undefined ? a : { ...a, value: f(a.value, `${w}.value`) };
      default:
        return a;
    }
  });
}

/**
 * 遍历/改写逻辑里所有表达式。skipFn 返回 true 的函数不处理（例如参数遮蔽了同名变量）。
 */
export function mapExprs(
  logic: Logic,
  f: ExprVisitor,
  skipFn: (fn: FunctionDoc) => boolean = () => false,
): Logic {
  return {
    ...logic,
    events: logic.events.map((ev, i) => ({
      ...ev,
      ...(ev.condition !== undefined ? { condition: f(ev.condition, `events.${i}.condition`) } : {}),
      ...(ev.trigger.kind === "variable" && ev.trigger.value !== undefined
        ? { trigger: { ...ev.trigger, value: f(ev.trigger.value, `events.${i}.trigger.value`) } }
        : {}),
      actions: mapActionExprs(ev.actions, f, `events.${i}.actions`),
    })),
    functions: logic.functions.map((fn, i) =>
      skipFn(fn)
        ? fn
        : {
            ...fn,
            params: fn.params.map((p, pi) =>
              p.default === undefined ? p : { ...p, default: f(p.default, `functions.${i}.params.${pi}.default`) },
            ),
            body: mapActionExprs(fn.body, f, `functions.${i}.body`),
          },
    ),
    bindings: logic.bindings.map((b, i) =>
      b.source.kind === "expr" ? { ...b, source: { ...b.source, expr: f(b.source.expr, `bindings.${i}.source.expr`) } } : b,
    ),
  };
}

function walk(list: ActionNode[], visit: (a: ActionNode, where: string) => void, where: string) {
  list.forEach((a, i) => {
    const w = `${where}.${i}`;
    visit(a, w);
    if (a.kind === "if") {
      walk(a.then, visit, `${w}.then`);
      walk(a.else, visit, `${w}.else`);
    }
    if (a.kind === "repeat" || a.kind === "forEach") walk(a.body, visit, `${w}.body`);
  });
}

export type Reference = { path: string; label: string };

/** 变量被哪些地方引用（规格 8.2 引用位置查看）。 */
export function referencesOf(doc: Pages & Logic, variable: VariableDoc): Reference[] {
  const refs: Reference[] = [];
  const shadowed = (fn: FunctionDoc) =>
    fn.params.some((p) => p.name === variable.key) || fn.locals.some((l) => l.name === variable.key);
  mapExprs(
    doc,
    (src, where) => {
      if (identifiersOf(src)?.includes(variable.key)) refs.push({ path: where, label: labelForPath(doc, where) });
      return src;
    },
    shadowed,
  );
  doc.events.forEach((ev, i) => {
    if (ev.trigger.kind === "variable" && ev.trigger.variableId === variable.id)
      refs.push({ path: `events.${i}.trigger`, label: `${eventLabel(doc, ev)}（触发器）` });
    walk(
      ev.actions,
      (a, w) => {
        if ((a.kind === "setVar" && a.variableId === variable.id) || (a.kind === "call" && a.resultVariableId === variable.id))
          refs.push({ path: w, label: labelForPath(doc, w) });
      },
      `events.${i}.actions`,
    );
  });
  doc.functions.forEach((fn, i) =>
    walk(
      fn.body,
      (a, w) => {
        if ((a.kind === "setVar" && a.variableId === variable.id) || (a.kind === "call" && a.resultVariableId === variable.id))
          refs.push({ path: w, label: labelForPath(doc, w) });
      },
      `functions.${i}.body`,
    ),
  );
  doc.bindings.forEach((b, i) => {
    if (b.source.kind === "variable" && b.source.variableId === variable.id)
      refs.push({ path: `bindings.${i}`, label: labelForPath(doc, `bindings.${i}`) });
  });
  return refs;
}

/** 变量改名：同时改写所有表达式里的引用（被同名参数/局部变量遮蔽的函数不改）。 */
export function renameVariable(logic: Logic, variableId: string, nextKey: string): Logic {
  const v = logic.variables.find((x) => x.id === variableId);
  if (!v || v.key === nextKey) return logic;
  const from = v.key;
  const shadowed = (fn: FunctionDoc) =>
    fn.params.some((p) => p.name === from) || fn.locals.some((l) => l.name === from);
  const out = mapExprs(logic, (src) => renameIdentifier(src, from, nextKey), shadowed);
  out.variables = logic.variables.map((x) => (x.id === variableId ? { ...x, key: nextKey } : x));
  return out;
}

export function defaultFor(type: VarType): VariableDoc["default"] {
  switch (type) {
    case "string":
      return "";
    case "int":
    case "float":
    case "datetime":
      return 0;
    case "bool":
      return false;
    case "array":
      return [];
    case "object":
      return {};
  }
}

/** 把用户输入的默认值文本转换成对应类型；失败返回 undefined。 */
export function parseDefault(type: VarType, text: string): VariableDoc["default"] | undefined {
  const t = text.trim();
  switch (type) {
    case "string":
      return text.slice(0, 2000);
    case "int": {
      if (!/^-?\d+$/.test(t)) return undefined;
      return Number(t);
    }
    case "float":
    case "datetime": {
      const n = Number(t);
      return t !== "" && Number.isFinite(n) ? n : undefined;
    }
    case "bool":
      return t === "true" ? true : t === "false" ? false : undefined;
    case "array":
    case "object": {
      try {
        const v = JSON.parse(t || (type === "array" ? "[]" : "{}"));
        if (type === "array" ? Array.isArray(v) : v && typeof v === "object" && !Array.isArray(v)) return v;
      } catch {
        return undefined;
      }
      return undefined;
    }
  }
}

export function defaultText(v: VariableDoc): string {
  return typeof v.default === "string" ? v.default : JSON.stringify(v.default);
}

/* ---------------- 新建 ---------------- */

export const ACTION_KINDS: { kind: ActionNode["kind"]; label: string; advanced?: boolean }[] = [
  { kind: "navigate", label: "打开页面" },
  { kind: "back", label: "返回上一页" },
  { kind: "toast", label: "显示提示" },
  { kind: "show", label: "显示组件" },
  { kind: "hide", label: "隐藏组件" },
  { kind: "toggle", label: "切换显示" },
  { kind: "setProp", label: "修改组件属性" },
  { kind: "setVar", label: "修改变量" },
  { kind: "if", label: "条件判断", advanced: true },
  { kind: "repeat", label: "重复执行", advanced: true },
  { kind: "forEach", label: "遍历列表", advanced: true },
  { kind: "call", label: "调用函数", advanced: true },
  { kind: "setLocal", label: "设置局部变量", advanced: true },
  { kind: "return", label: "返回结果", advanced: true },
  { kind: "startTimer", label: "启动计时器", advanced: true },
  { kind: "stopTimer", label: "暂停计时器", advanced: true },
  { kind: "resetTimer", label: "重置计时器", advanced: true },
  { kind: "log", label: "调试输出", advanced: true },
];

export function makeActionNode(
  kind: ActionNode["kind"],
  ctx: { doc: Pages & Logic; pageId?: string; componentId?: string },
): ActionNode {
  const id = newId("a");
  const otherPage = ctx.doc.pages.find((p) => p.id !== ctx.pageId) ?? ctx.doc.pages[0];
  const comp =
    ctx.componentId ??
    ctx.doc.pages.find((p) => p.id === ctx.pageId)?.components[0]?.id ??
    ctx.doc.pages.flatMap((p) => p.components)[0]?.id ??
    "";
  const v = ctx.doc.variables[0];
  const timer = ctx.doc.timers[0];
  const fn = ctx.doc.functions[0];
  switch (kind) {
    case "navigate":
      return { id, kind, pageId: otherPage?.id ?? "" };
    case "back":
      return { id, kind };
    case "toast":
      return { id, kind, text: '"已完成"' };
    case "log":
      return { id, kind, text: '"调试"' };
    case "show":
    case "hide":
    case "toggle":
      return { id, kind, componentId: comp };
    case "setProp":
      return { id, kind, componentId: comp, prop: "text", value: '"新文字"' };
    case "setVar":
      return { id, kind, variableId: v?.id ?? "", value: v ? literalOf(v.type) : "0" };
    case "setLocal":
      return { id, kind, name: "temp", value: "0" };
    case "call":
      return { id, kind, functionId: fn?.id ?? "", args: {} };
    case "if":
      return { id, kind, condition: "true", then: [], else: [] };
    case "repeat":
      return { id, kind, times: "3", body: [] };
    case "forEach":
      return { id, kind, list: "[1, 2, 3]", item: "item", body: [] };
    case "return":
      return { id, kind };
    case "startTimer":
    case "stopTimer":
    case "resetTimer":
      return { id, kind, timerId: timer?.id ?? "" };
  }
}

export function literalOf(type: VarType): string {
  switch (type) {
    case "string":
      return '""';
    case "bool":
      return "true";
    case "array":
      return "[]";
    default:
      return "0";
  }
}

export function makeEvent(trigger: Trigger, actions: ActionNode[] = []): EventDoc {
  return { id: newId("e"), enabled: true, trigger, actions };
}

/* ---------------- 中文描述 ---------------- */

export const TRIGGER_LABELS: Record<string, string> = {
  click: "点击",
  longPress: "长按",
  doubleClick: "双击",
  swipeStart: "滑动开始",
  swiping: "滑动中",
  swipeLeft: "向左滑",
  swipeRight: "向右滑",
  swipeUp: "向上滑",
  swipeDown: "向下滑",
  touchStart: "触摸开始",
  touchEnd: "触摸结束",
  change: "状态变化",
  load: "页面加载",
  show: "页面显示",
  hide: "页面隐藏",
  exit: "页面退出",
  everySecond: "每秒",
  everyMinute: "每分钟",
  everyHour: "每小时",
  at: "指定时刻",
  dateChange: "日期变化",
  weekChange: "星期变化",
  timerEnd: "计时器结束",
  equals: "等于指定值",
  condition: "满足条件",
  enterRange: "进入范围",
  leaveRange: "离开范围",
  appStart: "应用启动",
  appResume: "应用恢复",
  appBackground: "进入后台",
};

function compName(doc: Pages, id: string): string {
  for (const p of doc.pages) for (const c of p.components) if (c.id === id) return c.name || c.type;
  return `缺失组件(${id})`;
}
function pageName(doc: Pages, id: string): string {
  return doc.pages.find((p) => p.id === id)?.name ?? `缺失页面(${id})`;
}

export function triggerLabel(doc: Pages & Logic, t: Trigger): string {
  const ev = TRIGGER_LABELS[t.event] ?? t.event;
  switch (t.kind) {
    case "component":
      return `${compName(doc, t.componentId)} · ${t.event === "change" ? "状态变化" : ev}`;
    case "page":
      return `${pageName(doc, t.pageId)} · ${ev}`;
    case "time":
      return t.event === "at"
        ? `每天 ${t.at ?? "--:--"}`
        : t.event === "timerEnd"
          ? `计时器 ${doc.timers.find((x) => x.id === t.timerId)?.name ?? "?"} 结束`
          : ev;
    case "variable": {
      const v = doc.variables.find((x) => x.id === t.variableId)?.key ?? "?";
      if (t.event === "change") return `变量 ${v} 变化`;
      if (t.event === "equals") return `变量 ${v} 等于 ${t.value ?? ""}`;
      if (t.event === "condition") return `条件 ${t.value ?? ""} 成立`;
      return `变量 ${v} ${ev} [${t.min ?? ""}, ${t.max ?? ""}]`;
    }
    case "system":
      return ev;
  }
}

export function eventLabel(doc: Pages & Logic, ev: EventDoc): string {
  return ev.name || triggerLabel(doc, ev.trigger);
}

export function actionLabel(doc: Pages & Logic, a: ActionNode): string {
  switch (a.kind) {
    case "navigate":
      return `打开 ${pageName(doc, a.pageId)}`;
    case "back":
      return "返回上一页";
    case "toast":
      return `提示 ${a.text}`;
    case "log":
      return `调试输出 ${a.text}`;
    case "show":
      return `显示 ${compName(doc, a.componentId)}`;
    case "hide":
      return `隐藏 ${compName(doc, a.componentId)}`;
    case "toggle":
      return `切换 ${compName(doc, a.componentId)} 显示`;
    case "setProp":
      return `${compName(doc, a.componentId)}.${a.prop} = ${a.value}`;
    case "setVar":
      return `${doc.variables.find((v) => v.id === a.variableId)?.key ?? "?"} = ${a.value}`;
    case "setLocal":
      return `局部 ${a.name} = ${a.value}`;
    case "call": {
      const fn = doc.functions.find((f) => f.id === a.functionId);
      const args = Object.entries(a.args).map(([k, v]) => `${k}: ${v}`).join(", ");
      return `调用 ${fn?.name ?? "?"}(${args})`;
    }
    case "if":
      return `如果 ${a.condition}`;
    case "repeat":
      return `重复 ${a.times} 次`;
    case "forEach":
      return `遍历 ${a.list} 为 ${a.item}`;
    case "return":
      return a.value ? `返回 ${a.value}` : "返回";
    case "startTimer":
    case "stopTimer":
    case "resetTimer":
      return `${a.kind === "startTimer" ? "启动" : a.kind === "stopTimer" ? "暂停" : "重置"}计时器 ${doc.timers.find((t) => t.id === a.timerId)?.name ?? "?"}`;
  }
}

/* ---------------- 问题定位 ---------------- */

export type IssueTarget =
  | { kind: "event"; id: string; actionId?: string }
  | { kind: "function"; id: string; actionId?: string }
  | { kind: "variable"; id: string }
  | { kind: "binding"; id: string; componentId: string }
  | { kind: "timer"; id: string }
  | { kind: "component"; id: string; pageId: string }
  | { kind: "page"; id: string }
  | { kind: "project" };

function actionAt(list: ActionNode[], rest: string[]): string | undefined {
  // rest 形如 ["0","then","1","value"]
  let cur: ActionNode | undefined;
  let items: ActionNode[] = list;
  let i = 0;
  while (i < rest.length && /^\d+$/.test(rest[i])) {
    cur = items[Number(rest[i])];
    if (!cur) break;
    const branch = rest[i + 1];
    if (branch === "then" || branch === "else" || branch === "body") {
      items = (cur as unknown as Record<string, ActionNode[]>)[branch] ?? [];
      i += 2;
    } else break;
  }
  return cur?.id;
}

export function issueTarget(doc: ProjectDoc, path: string): IssueTarget {
  const parts = path.split(".");
  const idx = Number(parts[1]);
  switch (parts[0]) {
    case "events": {
      const ev = doc.events[idx];
      if (!ev) return { kind: "project" };
      return { kind: "event", id: ev.id, actionId: parts[2] === "actions" ? actionAt(ev.actions, parts.slice(3)) : undefined };
    }
    case "functions": {
      const fn = doc.functions[idx];
      if (!fn) return { kind: "project" };
      return { kind: "function", id: fn.id, actionId: parts[2] === "body" ? actionAt(fn.body, parts.slice(3)) : undefined };
    }
    case "variables":
      return doc.variables[idx] ? { kind: "variable", id: doc.variables[idx].id } : { kind: "project" };
    case "bindings": {
      const b: BindingDoc | undefined = doc.bindings[idx];
      return b ? { kind: "binding", id: b.id, componentId: b.componentId } : { kind: "project" };
    }
    case "timers":
      return doc.timers[idx] ? { kind: "timer", id: doc.timers[idx].id } : { kind: "project" };
    case "pages": {
      const page = doc.pages[idx];
      if (!page) return { kind: "project" };
      if (parts[2] === "components") {
        const c = page.components[Number(parts[3])];
        if (c) return { kind: "component", id: c.id, pageId: page.id };
      }
      return { kind: "page", id: page.id };
    }
    default:
      return { kind: "project" };
  }
}

export function labelForPath(doc: Pages & Logic, path: string): string {
  const parts = path.split(".");
  const idx = Number(parts[1]);
  if (parts[0] === "events" && doc.events[idx]) return `事件「${eventLabel(doc, doc.events[idx])}」`;
  if (parts[0] === "functions" && doc.functions[idx]) return `函数 ${doc.functions[idx].name}`;
  if (parts[0] === "bindings" && doc.bindings[idx])
    return `绑定 ${compName(doc, doc.bindings[idx].componentId)}.${doc.bindings[idx].prop}`;
  if (parts[0] === "variables" && doc.variables[idx]) return `变量 ${doc.variables[idx].key}`;
  if (parts[0] === "timers" && doc.timers[idx]) return `计时器 ${doc.timers[idx].name}`;
  return path;
}

/** 函数调用关系：每个函数调用了哪些函数（含被哪些事件调用），用于显示调用关系。 */
export function callGraph(logic: Logic): { calls: Record<string, string[]>; callers: Record<string, string[]> } {
  const calls: Record<string, string[]> = {};
  const callers: Record<string, string[]> = {};
  const add = (from: string, list: ActionNode[]) =>
    walk(
      list,
      (a) => {
        if (a.kind !== "call") return;
        const out = (calls[from] ??= []);
        if (!out.includes(a.functionId)) out.push(a.functionId);
        const back = (callers[a.functionId] ??= []);
        if (!back.includes(from)) back.push(from);
      },
      "",
    );
  logic.functions.forEach((fn) => add(fn.id, fn.body));
  logic.events.forEach((ev) => add(ev.id, ev.actions));
  return { calls, callers };
}

/** 递归更新动作树里某个 ID 的动作；返回新数组。 */
export function updateAction(list: ActionNode[], id: string, fn: (a: ActionNode) => ActionNode | null): ActionNode[] {
  const out: ActionNode[] = [];
  for (const a of list) {
    if (a.id === id) {
      const next = fn(a);
      if (next) out.push(next);
      continue;
    }
    if (a.kind === "if") out.push({ ...a, then: updateAction(a.then, id, fn), else: updateAction(a.else, id, fn) });
    else if (a.kind === "repeat" || a.kind === "forEach") out.push({ ...a, body: updateAction(a.body, id, fn) });
    else out.push(a);
  }
  return out;
}

/** 深拷贝动作并全部重新编号（复制节点用）。 */
export function cloneAction(a: ActionNode): ActionNode {
  const copy = structuredClone(a) as ActionNode;
  const re = (x: ActionNode): ActionNode => {
    const y = { ...x, id: newId("a") } as ActionNode;
    if (y.kind === "if") return { ...y, then: y.then.map(re), else: y.else.map(re) };
    if (y.kind === "repeat" || y.kind === "forEach") return { ...y, body: y.body.map(re) };
    return y;
  };
  return re(copy);
}

/** 调试记录里的引用 ID（事件/动作/函数/变量/计时器/绑定/页面）定位到编辑器位置。 */
export function locateRef(doc: ProjectDoc, ref: string): IssueTarget {
  const inList = (list: ActionNode[]): boolean => {
    let found = false;
    walk(list, (a) => {
      if (a.id === ref) found = true;
    }, "");
    return found;
  };
  for (const ev of doc.events) {
    if (ev.id === ref) return { kind: "event", id: ev.id };
    if (inList(ev.actions)) return { kind: "event", id: ev.id, actionId: ref };
  }
  for (const fn of doc.functions) {
    if (fn.id === ref) return { kind: "function", id: fn.id };
    if (inList(fn.body)) return { kind: "function", id: fn.id, actionId: ref };
  }
  if (doc.variables.some((v) => v.id === ref)) return { kind: "variable", id: ref };
  if (doc.timers.some((t) => t.id === ref)) return { kind: "timer", id: ref };
  const b = doc.bindings.find((x) => x.id === ref);
  if (b) return { kind: "binding", id: b.id, componentId: b.componentId };
  if (doc.pages.some((p) => p.id === ref)) return { kind: "page", id: ref };
  return { kind: "project" };
}
