/**
 * 网页预览与调试器（规格第十一章）。
 * 预览直接运行统一协议解释器（runtime.ts），与 Android 预览和测试共用同一套执行语义。
 * 时间可以暂停、快进，用来模拟时间事件和计时器；这仍然只是网页模拟，不是真机验证。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PropMap, SceneNode } from "@/lib/blueos/model";
import { formatDuration, formatTime, toText, type Value } from "@/lib/protocol/expr";
import { eventLabel, locateRef, parseDefault, type IssueTarget } from "@/lib/protocol/logic-tools";
import { Runtime, type TraceEntry } from "@/lib/protocol/runtime";
import type { ProjectDoc, Trigger } from "@/lib/protocol/schema";

export type Preview = {
  runtime: Runtime | null;
  version: number;
  toast: string;
  clock: () => number;
  frozen: boolean;
  start: (doc: ProjectDoc) => void;
  stop: () => void;
  bump: () => void;
  jump: (ms: number) => void;
  setFrozen: (frozen: boolean) => void;
  resetClock: () => void;
  interact: (componentId: string, event: Extract<Trigger, { kind: "component" }>["event"], value?: Value) => void;
};

export function usePreview(): Preview {
  const offset = useRef(0);
  const frozenAt = useRef<number | null>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [version, setVersion] = useState(0);
  const [toast, setToast] = useState("");
  const [frozen, setFrozenState] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);
  const clock = useCallback(() => frozenAt.current ?? Date.now() + offset.current, []);

  const bump = useCallback(() => {
    const rt = runtimeRef.current;
    if (rt?.state.toast) {
      setToast(rt.state.toast);
      rt.state.toast = "";
      window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setToast(""), 1800);
    }
    setVersion((v) => v + 1);
  }, []);

  const start = useCallback(
    (doc: ProjectDoc) => {
      offset.current = 0;
      frozenAt.current = null;
      setFrozenState(false);
      const rt = new Runtime(structuredClone(doc), { now: clock });
      rt.start();
      runtimeRef.current = rt;
      setRuntime(rt);
      setToast("");
      bump();
    },
    [bump, clock],
  );

  const stop = useCallback(() => {
    runtimeRef.current = null;
    setRuntime(null);
    setToast("");
  }, []);

  useEffect(() => {
    if (!runtime) return;
    const timer = window.setInterval(() => {
      if (frozenAt.current !== null) return;
      runtime.tick(clock());
      bump();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [runtime, bump, clock]);

  const jump = useCallback(
    (ms: number) => {
      if (frozenAt.current !== null) frozenAt.current += ms;
      else offset.current += ms;
      runtimeRef.current?.tick(clock());
      bump();
    },
    [bump, clock],
  );

  const setFrozen = useCallback(
    (value: boolean) => {
      if (value) frozenAt.current = clock();
      else if (frozenAt.current !== null) {
        offset.current = frozenAt.current - Date.now();
        frozenAt.current = null;
      }
      setFrozenState(value);
      bump();
    },
    [bump, clock],
  );

  const resetClock = useCallback(() => {
    offset.current = 0;
    frozenAt.current = frozenAt.current === null ? null : Date.now();
    runtimeRef.current?.tick(clock());
    bump();
  }, [bump, clock]);

  const interact = useCallback<Preview["interact"]>(
    (componentId, event, value) => {
      runtimeRef.current?.interact(componentId, event, value);
      bump();
    },
    [bump],
  );

  return { runtime, version, toast, clock, frozen, start, stop, bump, jump, setFrozen, resetClock, interact };
}

/** 预览中组件的显示结果（绑定、动作修改后的属性和显示状态）。 */
export function previewNode(runtime: Runtime, node: SceneNode): SceneNode {
  const resolved = runtime.resolvedProps(node.id);
  const props: PropMap = { ...node.props };
  for (const [key, value] of Object.entries(resolved)) {
    if (key === "visible") continue;
    props[key] = typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : toText(value);
  }
  return { ...node, props, hidden: !runtime.visible(node.id) };
}

/** 指针手势识别：点击、双击、长按、四向滑动、触摸开始/结束。 */
export function useGestures(interact: Preview["interact"]) {
  const down = useRef<{ id: string; x: number; y: number; t: number } | null>(null);
  const lastClick = useRef<{ id: string; t: number } | null>(null);
  return {
    onDown(id: string, x: number, y: number) {
      down.current = { id, x, y, t: Date.now() };
      interact(id, "touchStart");
    },
    onUp(id: string, x: number, y: number, extra?: () => void) {
      const d = down.current;
      down.current = null;
      interact(id, "touchEnd");
      if (!d || d.id !== id) return;
      const dx = x - d.x;
      const dy = y - d.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > 30) {
        interact(id, "swipeStart");
        interact(id, Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "swipeLeft" : "swipeRight") : dy < 0 ? "swipeUp" : "swipeDown");
        return;
      }
      if (Date.now() - d.t > 600) {
        interact(id, "longPress");
        return;
      }
      interact(id, "click");
      extra?.();
      const prev = lastClick.current;
      if (prev && prev.id === id && Date.now() - prev.t < 350) {
        interact(id, "doubleClick");
        lastClick.current = null;
      } else lastClick.current = { id, t: Date.now() };
    },
  };
}

const KIND_LABEL: Record<TraceEntry["kind"], string> = {
  event: "事件",
  action: "动作",
  call: "函数",
  var: "变量",
  error: "错误",
  warn: "警告",
  page: "页面",
};

/** 调试器面板：时间模拟、变量当前值、计时器、事件列表（手动触发）、执行记录。 */
export function DebugPanel({ preview, doc, locate }: { preview: Preview; doc: ProjectDoc; locate: (target: IssueTarget) => void }) {
  const rt = preview.runtime;
  const [tab, setTab] = useState<"vars" | "events" | "trace">("trace");
  const [onlyProblems, setOnlyProblems] = useState(false);
  // 运行时是可变对象，每次 bump 后重新取执行记录。
  const trace = rt ? rt.trace.slice().reverse() : [];
  if (!rt) return null;
  const now = preview.clock();
  const problems = rt.trace.filter((t) => t.kind === "error" || t.kind === "warn").length;
  const page = doc.pages.find((p) => p.id === rt.state.pageId);
  return (
    <div className="p-3 text-sm">
      <p className="font-semibold">调试器</p>
      <p className="mt-1 text-xs text-muted">网页模拟，不是真机。当前页面 {page?.name}，返回栈 {rt.state.stack.length} 层。</p>
      <div className="mt-2 rounded-md border border-line p-2">
        <p className="font-mono text-sm">{formatTime(now, "YYYY-MM-DD HH:mm:ss W")}</p>
        <div className="mt-2 grid grid-cols-3 gap-1 text-xs">
          <button type="button" className="min-h-9 rounded-md border border-line" onClick={() => preview.setFrozen(!preview.frozen)}>
            {preview.frozen ? "继续时间" : "暂停时间"}
          </button>
          <button type="button" className="min-h-9 rounded-md border border-line" onClick={() => preview.jump(60_000)}>
            +1 分钟
          </button>
          <button type="button" className="min-h-9 rounded-md border border-line" onClick={() => preview.jump(3_600_000)}>
            +1 小时
          </button>
          <button type="button" className="min-h-9 rounded-md border border-line" onClick={() => preview.jump(86_400_000)}>
            +1 天
          </button>
          <button type="button" className="min-h-9 rounded-md border border-line" onClick={() => preview.jump(1000)}>
            +1 秒
          </button>
          <button type="button" className="min-h-9 rounded-md border border-line" onClick={preview.resetClock}>
            回到现在
          </button>
          <button
            type="button"
            className="min-h-9 rounded-md border border-line"
            onClick={() => {
              rt.system("appBackground");
              preview.bump();
            }}
          >
            进入后台
          </button>
          <button
            type="button"
            className="min-h-9 rounded-md border border-line"
            onClick={() => {
              rt.system("appResume");
              preview.bump();
            }}
          >
            恢复前台
          </button>
          <button type="button" className="min-h-9 rounded-md border border-line" onClick={() => preview.start(doc)}>
            重新开始
          </button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1">
        {(
          [
            ["trace", `执行记录${problems ? ` · ${problems}` : ""}`],
            ["vars", "变量与计时器"],
            ["events", "事件列表"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={`min-h-9 rounded-md border text-xs ${tab === id ? "border-accent text-accent" : "border-line text-muted"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "vars" ? (
        <div className="mt-2">
          {doc.variables.length === 0 ? <p className="text-xs text-muted">没有变量。</p> : null}
          {doc.variables.map((v) => (
            <VarRow key={`${v.id}-${preview.version}`} label={v.key} type={v.type} value={rt.state.vars[v.id]} onSet={(value) => {
              rt.setVariable(v.id, value);
              preview.bump();
            }} />
          ))}
          {doc.timers.map((t) => {
            const st = rt.state.timers[t.id];
            const elapsed = st ? (st.running ? now - st.startedAt : st.elapsedMs) : 0;
            return (
              <p key={t.id} className="mt-1 flex justify-between text-xs">
                <span>⏱ {t.name}</span>
                <span className="font-mono text-muted">
                  {st?.running ? "运行中" : st?.done ? "已结束" : "未运行"} · {t.kind === "countdown" ? `剩余 ${formatDuration(Math.max(0, t.durationSec * 1000 - elapsed))}` : formatDuration(elapsed)}
                </span>
              </p>
            );
          })}
        </div>
      ) : null}
      {tab === "events" ? (
        <ul className="mt-2 grid gap-1">
          {doc.events.length === 0 ? <li className="text-xs text-muted">没有事件。</li> : null}
          {doc.events.map((ev) => (
            <li key={ev.id} className="flex items-center gap-1 text-xs">
              <button type="button" className="min-h-9 min-w-0 flex-1 truncate text-left" onClick={() => locate({ kind: "event", id: ev.id })}>
                {eventLabel(doc, ev)}
                {ev.enabled ? "" : "（停用）"}
              </button>
              <button
                type="button"
                className="min-h-9 shrink-0 rounded-md border border-line px-2"
                onClick={() => {
                  rt.fire(ev.id);
                  preview.bump();
                }}
              >
                触发
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {tab === "trace" ? (
        <div className="mt-2">
          <div className="flex items-center justify-between text-xs">
            <label className="flex min-h-9 items-center gap-2">
              <input type="checkbox" className="accent-accent" checked={onlyProblems} onChange={(event) => setOnlyProblems(event.target.checked)} />
              只看错误和警告
            </label>
            <button
              type="button"
              className="min-h-9 px-2 text-muted"
              onClick={() => {
                rt.trace.length = 0;
                preview.bump();
              }}
            >
              清空
            </button>
          </div>
          <ol className="mt-1 grid gap-1">
            {trace
              .filter((t) => !onlyProblems || t.kind === "error" || t.kind === "warn")
              .slice(0, 150)
              .map((t) => (
                <li key={t.seq}>
                  <button type="button" className="flex w-full items-start gap-2 rounded-md px-1 py-1 text-left text-xs hover:bg-surface-2" onClick={() => locate(locateRef(doc, t.ref))}>
                    <span className={`shrink-0 font-medium ${t.kind === "error" ? "text-warn" : t.kind === "warn" ? "text-warn" : "text-muted"}`}>{KIND_LABEL[t.kind]}</span>
                    <span className="min-w-0 flex-1 break-words">{t.message}</span>
                    <span className="shrink-0 font-mono text-muted">{t.ms !== undefined ? `${t.ms}ms` : formatTime(t.at, "HH:mm:ss")}</span>
                  </button>
                </li>
              ))}
          </ol>
          {trace.length === 0 ? <p className="text-xs text-muted">点一下手表上的组件，这里会显示事件、动作、函数调用和变量变化。</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function VarRow({ label, type, value, onSet }: { label: string; type: Parameters<typeof parseDefault>[0]; value: Value | undefined; onSet: (value: Value) => void }) {
  const shown = typeof value === "string" ? value : JSON.stringify(value ?? null);
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState(false);
  return (
    <label className="mt-1 grid grid-cols-[1fr_1.4fr] items-center gap-2 text-xs">
      <span className="truncate font-mono">{label}</span>
      <input
        aria-label={`变量 ${label} 当前值`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (text === shown) return;
          const next = parseDefault(type, text);
          setBad(next === undefined);
          if (next !== undefined) onSet(next as Value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        }}
        className={`min-h-9 rounded-md border bg-bg px-2 font-mono ${bad ? "border-warn" : "border-line"}`}
      />
    </label>
  );
}
