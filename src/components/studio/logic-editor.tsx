/**
 * 逻辑编辑器（规格第七~十章）：事件、变量、函数、计时器、数据绑定、时间绑定和检查。
 * 直接编辑统一协议 v2 的逻辑部分（Project.protocolExtras），所有修改可撤销。
 * 简易模式只显示常用动作和文字输入；高级模式开放表达式、条件、循环、函数、计时器。
 */
import { ArrowDown, ArrowUp, Copy, Crosshair, Plus, Trash2 } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useStudio } from "@/lib/blueos/store";
import type { EditorProject } from "@/lib/protocol/editor";
import { exprToTemplate, projectToDoc } from "@/lib/protocol/editor";
import { assignable, checkExpr, formatTime, type ValueType } from "@/lib/protocol/expr";
import {
  ACTION_KINDS,
  TRIGGER_LABELS,
  actionLabel,
  callGraph,
  cloneAction,
  defaultFor,
  defaultText,
  eventLabel,
  eventPage,
  functionLocals,
  issueTarget,
  labelForPath,
  makeActionNode,
  makeEvent,
  newId,
  parseDefault,
  referencesOf,
  renameVariable,
  typesInScope,
  type IssueTarget,
  type Logic,
} from "@/lib/protocol/logic-tools";
import { templateToExpr } from "@/lib/protocol/migrate";
import {
  BINDABLE_PROPS,
  COMPONENT_EVENTS,
  PAGE_EVENTS,
  PROTOCOL_LIMITS,
  SYSTEM_EVENTS,
  TIME_EVENTS,
  TIME_FIELDS,
  VARIABLE_EVENTS,
  VISIBLE_PROP,
  ValueTypeSchema,
  type ActionNode,
  type BindingDoc,
  type EventDoc,
  type FunctionDoc,
  type ProjectDoc,
  type Trigger,
  type VarType,
} from "@/lib/protocol/schema";
import { validateDoc, type ProtocolIssue } from "@/lib/protocol/validate";

export type LogicTab = "events" | "variables" | "functions" | "timers" | "bindings" | "check";
export type Focus = { tab: LogicTab; id?: string; actionId?: string };

type Ctx = {
  project: EditorProject;
  doc: ProjectDoc;
  advanced: boolean;
  pageId: string;
  selectedComponentId?: string;
  update: (recipe: (logic: Logic) => Logic, live?: boolean) => void;
  focus: Focus;
  setFocus: (focus: Focus) => void;
  locate: (target: IssueTarget) => void;
};

const LogicContext = createContext<Ctx | null>(null);
function useLogic(): Ctx {
  const ctx = useContext(LogicContext);
  if (!ctx) throw new Error("LogicContext missing");
  return ctx;
}

export function useProjectDoc(project: EditorProject): ProjectDoc {
  return useMemo(() => projectToDoc(project), [project]);
}

export function useIssues(doc: ProjectDoc): ProtocolIssue[] {
  return useMemo(() => validateDoc(doc).issues, [doc]);
}

const VAR_TYPE_LABEL: Record<VarType, string> = {
  string: "字符串",
  int: "整数",
  float: "小数",
  bool: "布尔",
  array: "数组",
  object: "对象",
  datetime: "时间",
};

/** 声明为手表未验证的触发方式（规格 7.2 / 11.3）。 */
const UNVERIFIED = new Set(["longPress", "doubleClick", "swipeStart", "swiping", "swipeLeft", "swipeRight", "swipeUp", "swipeDown", "touchStart", "touchEnd", "everySecond"]);

const input = "min-h-11 w-full rounded-md border border-line bg-bg px-2 text-sm";
const small = "min-h-11 rounded-md border border-line bg-bg px-2 text-sm";

export function LogicProvider({
  project,
  advanced,
  pageId,
  selectedComponentId,
  focus,
  setFocus,
  locate,
  children,
}: {
  project: EditorProject;
  advanced: boolean;
  pageId: string;
  selectedComponentId?: string;
  focus: Focus;
  setFocus: (focus: Focus) => void;
  locate: (target: IssueTarget) => void;
  children: ReactNode;
}) {
  const doc = useProjectDoc(project);
  const value = useMemo<Ctx>(
    () => ({
      project,
      doc,
      advanced,
      pageId,
      selectedComponentId,
      update: (recipe, live) => useStudio.getState().updateLogic(project.id, recipe, live),
      focus,
      setFocus,
      locate,
    }),
    [project, doc, advanced, pageId, selectedComponentId, focus, setFocus, locate],
  );
  return <LogicContext.Provider value={value}>{children}</LogicContext.Provider>;
}

/* ---------------- 通用输入 ---------------- */

function Draft({
  value,
  onCommit,
  placeholder,
  mono,
  className,
  label,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  className?: string;
  label?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      aria-label={label ?? placeholder}
      value={text}
      placeholder={placeholder}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
      }}
      className={`${className ?? input} ${mono ? "font-mono" : ""}`}
    />
  );
}

/** 表达式输入：实时语法和类型检查（规格 8.6）。 */
export function ExprField({
  value,
  onCommit,
  types,
  want,
  placeholder,
  label,
}: {
  value: string;
  onCommit: (value: string) => void;
  types: Record<string, ValueType>;
  want?: ValueType | null;
  placeholder?: string;
  label?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const res = useMemo(() => (text.trim() ? checkExpr(text, { types }) : null), [text, types]);
  const bad = res ? !res.ok || (want ? !assignable(res.type, want) : false) : Boolean(want);
  const note = !res
    ? want
      ? "需要填写表达式"
      : ""
    : !res.ok
      ? res.error
      : want && !assignable(res.type, want)
        ? `结果是 ${res.type}，这里需要 ${want}`
        : `结果类型 ${res.type}`;
  return (
    <label className="mt-2 block text-xs text-muted">
      {label}
      <input
        aria-label={label ?? placeholder ?? "表达式"}
        value={text}
        placeholder={placeholder ?? "表达式，例如 count + 1"}
        spellCheck={false}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => text !== value && onCommit(text)}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        }}
        className={`${input} mt-1 font-mono ${bad ? "border-warn" : ""}`}
      />
      {note ? <span className={`mt-1 block ${bad ? "text-warn" : "text-muted"}`}>{note}</span> : null}
    </label>
  );
}

/** 简易模式的文字输入：“你好 $count” ↔ "你好 " + str(count)。表达式过于复杂时只在高级模式编辑。 */
function TextOrExpr({
  value,
  onCommit,
  types,
  label,
}: {
  value: string;
  onCommit: (value: string) => void;
  types: Record<string, ValueType>;
  label: string;
}) {
  const { advanced } = useLogic();
  const template = exprToTemplate(value);
  if (advanced || template === null) {
    return (
      <>
        <ExprField label={`${label}（表达式）`} value={value} onCommit={onCommit} types={types} />
        {!advanced ? <p className="mt-1 text-xs text-muted">这段是表达式，切到高级模式修改更方便。</p> : null}
      </>
    );
  }
  return (
    <label className="mt-2 block text-xs text-muted">
      {label}（$变量名 会替换成变量值）
      <Draft
        label={label}
        value={template}
        onCommit={(next) => onCommit(templateToExpr(next, new Set(Object.keys(types))))}
        className={`${input} mt-1`}
      />
    </label>
  );
}

function Select<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  label?: string;
  className?: string;
}) {
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value as T)} className={className ?? `${input} mt-2`}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function IconButton({ label, onClick, children, danger }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={`grid size-9 shrink-0 place-items-center rounded-md border border-line ${danger ? "text-warn" : "text-muted"}`}>
      {children}
    </button>
  );
}

function useComponents() {
  const { doc } = useLogic();
  return useMemo(
    () => doc.pages.flatMap((page) => page.components.map((c) => ({ ...c, pageId: page.id, pageName: page.name }))),
    [doc],
  );
}

/* ======================================================================= */
/* 逻辑面板                                                                 */
/* ======================================================================= */

const TABS: { id: LogicTab; label: string; advanced?: boolean }[] = [
  { id: "events", label: "事件" },
  { id: "variables", label: "变量" },
  { id: "bindings", label: "绑定" },
  { id: "functions", label: "函数", advanced: true },
  { id: "timers", label: "计时器", advanced: true },
  { id: "check", label: "检查" },
];

export function LogicWorkspace() {
  const { focus, setFocus, advanced, doc } = useLogic();
  const issues = useIssues(doc);
  const errors = issues.filter((i) => i.level === "error").length;
  const tabs = TABS.filter((t) => advanced || !t.advanced);
  const tab = tabs.some((t) => t.id === focus.tab) ? focus.tab : "events";
  return (
    <div className="p-3">
      <div className="studio-scroll flex gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setFocus({ tab: t.id })}
            className={`min-h-9 shrink-0 rounded-full border px-3 text-xs ${tab === t.id ? "border-accent bg-accent text-accent-fg" : "border-line text-muted"}`}
          >
            {t.label}
            {t.id === "check" && errors ? ` · ${errors}` : ""}
          </button>
        ))}
      </div>
      <div className="mt-3">
        {tab === "events" ? <EventsTab /> : null}
        {tab === "variables" ? <VariablesTab /> : null}
        {tab === "bindings" ? <BindingsTab /> : null}
        {tab === "functions" ? <FunctionsTab /> : null}
        {tab === "timers" ? <TimersTab /> : null}
        {tab === "check" ? <ChecksTab issues={issues} /> : null}
      </div>
    </div>
  );
}

/* ---------------- 事件 ---------------- */

function EventsTab() {
  const { doc, pageId, selectedComponentId, update, setFocus, focus, advanced } = useLogic();
  const [filter, setFilter] = useState<"all" | "page" | "component">("all");
  const list = doc.events.filter((ev) => {
    if (filter === "all") return true;
    if (filter === "page") return eventPage(doc, ev) === pageId;
    return ev.trigger.kind === "component" && ev.trigger.componentId === selectedComponentId;
  });
  function add(trigger: Trigger) {
    if (doc.events.length >= PROTOCOL_LIMITS.events) return;
    const ev = makeEvent(trigger);
    update((logic) => ({ ...logic, events: [...logic.events, ev] }));
    setFocus({ tab: "events", id: ev.id });
  }
  return (
    <div>
      <div className="grid grid-cols-3 gap-1">
        {(["all", "page", "component"] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={`min-h-9 rounded-md border text-xs ${filter === f ? "border-accent text-accent" : "border-line text-muted"}`}>
            {f === "all" ? `全部 ${doc.events.length}` : f === "page" ? "当前页" : "选中组件"}
          </button>
        ))}
      </div>
      <AddEvent onAdd={add} />
      {list.length === 0 ? <p className="mt-3 text-sm text-muted">{filter === "component" && !selectedComponentId ? "先在画布上选中一个组件。" : "这里还没有事件。"}</p> : null}
      <div className="mt-3 grid gap-2">
        {list.map((ev) => (
          <EventCard key={ev.id} ev={ev} open={focus.id === ev.id} onToggle={() => setFocus({ tab: "events", id: focus.id === ev.id ? undefined : ev.id })} />
        ))}
      </div>
      {!advanced ? <p className="mt-3 text-xs leading-5 text-muted">简易模式显示常用动作。条件、循环、函数和计时器在高级模式里。</p> : null}
    </div>
  );
}

function AddEvent({ onAdd }: { onAdd: (trigger: Trigger) => void }) {
  const { doc, pageId, selectedComponentId, advanced } = useLogic();
  const [kind, setKind] = useState<Trigger["kind"]>("component");
  const components = useComponents();
  const comp = selectedComponentId ?? components.find((c) => c.pageId === pageId)?.id ?? components[0]?.id;
  const kinds: { value: Trigger["kind"]; label: string }[] = [
    { value: "component", label: "组件事件" },
    { value: "page", label: "页面事件" },
    { value: "time", label: "时间事件" },
    { value: "variable", label: "变量事件" },
    { value: "system", label: "系统事件" },
  ];
  function create() {
    if (kind === "component") {
      if (!comp) return;
      onAdd({ kind: "component", componentId: comp, event: "click" });
    } else if (kind === "page") onAdd({ kind: "page", pageId, event: "load" });
    else if (kind === "time") onAdd({ kind: "time", event: "everyMinute", pageId });
    else if (kind === "variable") {
      const v = doc.variables[0];
      if (!v) return;
      onAdd({ kind: "variable", variableId: v.id, event: "change" });
    } else onAdd({ kind: "system", event: "appStart" });
  }
  const blocked = (kind === "component" && !comp) || (kind === "variable" && !doc.variables.length);
  return (
    <div className="mt-2 flex gap-2">
      <Select value={kind} onChange={setKind} options={advanced ? kinds : kinds.slice(0, 3)} label="触发器类型" className={`${small} min-w-0 flex-1`} />
      <button type="button" disabled={blocked} onClick={create} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-50">
        <Plus className="size-4" />
        添加事件
      </button>
    </div>
  );
}

function EventCard({ ev, open, onToggle }: { ev: EventDoc; open: boolean; onToggle: () => void }) {
  const { doc, update, advanced, focus } = useLogic();
  const index = doc.events.findIndex((e) => e.id === ev.id);
  const page = eventPage(doc, ev);
  const types = useMemo(
    () => typesInScope(doc, page, ev.trigger.kind === "variable" || ev.trigger.kind === "component" ? { _value: "any" } : {}),
    [doc, page, ev.trigger.kind],
  );
  function patch(next: Partial<EventDoc>) {
    update((logic) => ({ ...logic, events: logic.events.map((e) => (e.id === ev.id ? ({ ...e, ...next } as EventDoc) : e)) }));
  }
  function move(dir: -1 | 1) {
    update((logic) => {
      const events = logic.events.slice();
      const i = events.findIndex((e) => e.id === ev.id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= events.length) return logic;
      [events[i], events[j]] = [events[j], events[i]];
      return { ...logic, events };
    });
  }
  const unverified = UNVERIFIED.has(ev.trigger.event);
  return (
    <div id={`logic-${ev.id}`} className={`rounded-xl border p-2 ${open ? "border-accent" : "border-line"} ${ev.enabled ? "" : "opacity-60"}`}>
      <div className="flex items-center gap-1">
        <button type="button" onClick={onToggle} className="min-h-9 min-w-0 flex-1 truncate text-left text-sm font-medium">
          {eventLabel(doc, ev)}
          <span className="ml-1 text-xs text-muted">· {ev.actions.length} 个动作</span>
        </button>
        <IconButton label="上移" onClick={() => move(-1)}>
          <ArrowUp className="size-3.5" />
        </IconButton>
        <IconButton label="下移" onClick={() => move(1)}>
          <ArrowDown className="size-3.5" />
        </IconButton>
        <IconButton
          label="复制事件"
          onClick={() =>
            update((logic) => ({
              ...logic,
              events: [...logic.events.slice(0, index + 1), { ...structuredClone(ev), id: newId("e"), actions: ev.actions.map(cloneAction) }, ...logic.events.slice(index + 1)],
            }))
          }
        >
          <Copy className="size-3.5" />
        </IconButton>
        <IconButton label="删除事件" danger onClick={() => update((logic) => ({ ...logic, events: logic.events.filter((e) => e.id !== ev.id) }))}>
          <Trash2 className="size-3.5" />
        </IconButton>
      </div>
      {unverified ? <p className="mt-1 text-xs text-warn">这个触发方式还没在 BlueOS 真机验证，预览可以模拟，但不承诺手表支持。</p> : null}
      {open ? (
        <div className="mt-2 border-t border-line pt-2">
          <label className="flex min-h-9 items-center justify-between text-sm">
            启用
            <input type="checkbox" className="size-5 accent-accent" checked={ev.enabled} onChange={(event) => patch({ enabled: event.target.checked })} />
          </label>
          {advanced ? <Draft label="事件名称" value={ev.name ?? ""} placeholder="事件名称（可选）" onCommit={(name) => patch({ name: name.trim() ? name.trim().slice(0, 40) : undefined })} /> : null}
          <TriggerEditor trigger={ev.trigger} onChange={(trigger) => patch({ trigger })} />
          {advanced ? (
            <>
              <ExprField label="条件（可选，为假时不执行）" value={ev.condition ?? ""} types={types} want={ev.condition ? "bool" : null} onCommit={(condition) => patch({ condition: condition.trim() ? condition : undefined })} placeholder="例如 count > 3" />
              <label className="mt-2 block text-xs text-muted">
                防重复触发间隔（毫秒）
                <Draft label="防重复间隔" value={String(ev.throttleMs ?? 0)} onCommit={(text) => patch({ throttleMs: Math.max(0, Math.min(60000, Math.round(Number(text) || 0))) || undefined })} className={`${input} mt-1`} />
              </label>
            </>
          ) : null}
          <p className="mt-3 text-xs font-medium">动作（按顺序执行，出错时停止后续动作）</p>
          <ActionList
            list={ev.actions}
            types={types}
            pageId={page}
            componentId={ev.trigger.kind === "component" ? ev.trigger.componentId : undefined}
            highlight={focus.actionId}
            onChange={(actions) => patch({ actions })}
          />
        </div>
      ) : null}
    </div>
  );
}

function TriggerEditor({ trigger, onChange }: { trigger: Trigger; onChange: (t: Trigger) => void }) {
  const { doc, advanced } = useLogic();
  const components = useComponents();
  const label = (e: string) => `${TRIGGER_LABELS[e] ?? e}${UNVERIFIED.has(e) ? "（真机未验证）" : ""}`;
  switch (trigger.kind) {
    case "component": {
      const events = advanced ? COMPONENT_EVENTS : (["click", "longPress", "doubleClick", "swipeLeft", "change"] as const);
      return (
        <div className="grid grid-cols-2 gap-2">
          <Select label="触发组件" value={trigger.componentId} onChange={(componentId) => onChange({ ...trigger, componentId })} options={components.map((c) => ({ value: c.id, label: `${c.pageName} · ${c.name || c.type}` }))} />
          <Select label="组件事件" value={trigger.event} onChange={(event) => onChange({ ...trigger, event })} options={events.map((e) => ({ value: e, label: label(e) }))} />
        </div>
      );
    }
    case "page":
      return (
        <div className="grid grid-cols-2 gap-2">
          <Select label="页面" value={trigger.pageId} onChange={(pageId) => onChange({ ...trigger, pageId })} options={doc.pages.map((p) => ({ value: p.id, label: p.name }))} />
          <Select label="页面事件" value={trigger.event} onChange={(event) => onChange({ ...trigger, event })} options={PAGE_EVENTS.map((e) => ({ value: e, label: label(e) }))} />
        </div>
      );
    case "time":
      return (
        <div>
          <div className="grid grid-cols-2 gap-2">
            <Select
              label="时间事件"
              value={trigger.event}
              onChange={(event) =>
                onChange({
                  ...trigger,
                  event,
                  ...(event === "at" ? { at: trigger.at ?? "08:00" } : {}),
                  ...(event === "timerEnd" ? { timerId: trigger.timerId ?? doc.timers[0]?.id ?? "" } : {}),
                })
              }
              options={TIME_EVENTS.filter((e) => advanced || e !== "timerEnd").map((e) => ({ value: e, label: label(e) }))}
            />
            <Select
              label="只在页面可见时运行"
              value={trigger.pageId ?? ""}
              onChange={(pageId) => onChange({ ...trigger, pageId: pageId || undefined })}
              options={[{ value: "", label: "任何页面（更耗电）" }, ...doc.pages.map((p) => ({ value: p.id, label: `仅 ${p.name}` }))]}
            />
          </div>
          {trigger.event === "at" ? (
            <Draft label="触发时刻" value={trigger.at ?? "08:00"} placeholder="HH:mm" onCommit={(at) => /^([01]\d|2[0-3]):[0-5]\d$/.test(at) && onChange({ ...trigger, at })} className={`${input} mt-2 font-mono`} />
          ) : null}
          {trigger.event === "timerEnd" ? (
            <Select label="计时器" value={trigger.timerId ?? ""} onChange={(timerId) => onChange({ ...trigger, timerId })} options={[{ value: "", label: "选择计时器" }, ...doc.timers.map((t) => ({ value: t.id, label: t.name }))]} />
          ) : null}
          <p className="mt-1 text-xs text-muted">手表要省电：尽量用每分钟，并限定页面。</p>
        </div>
      );
    case "variable": {
      const types = typesInScope(doc, undefined, { _value: "any" });
      return (
        <div>
          <div className="grid grid-cols-2 gap-2">
            <Select label="变量" value={trigger.variableId} onChange={(variableId) => onChange({ ...trigger, variableId })} options={doc.variables.map((v) => ({ value: v.id, label: v.key }))} />
            <Select label="变量事件" value={trigger.event} onChange={(event) => onChange({ ...trigger, event })} options={VARIABLE_EVENTS.map((e) => ({ value: e, label: e === "change" ? "值变化" : label(e) }))} />
          </div>
          {trigger.event === "equals" || trigger.event === "condition" ? (
            <ExprField label={trigger.event === "equals" ? "目标值" : "条件（_value 是新值）"} value={trigger.value ?? ""} types={types} want={trigger.event === "condition" ? "bool" : null} onCommit={(value) => onChange({ ...trigger, value })} />
          ) : null}
          {trigger.event === "enterRange" || trigger.event === "leaveRange" ? (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Draft label="最小值" value={String(trigger.min ?? "")} placeholder="最小值" onCommit={(text) => onChange({ ...trigger, min: text.trim() === "" ? undefined : Number(text) })} />
              <Draft label="最大值" value={String(trigger.max ?? "")} placeholder="最大值" onCommit={(text) => onChange({ ...trigger, max: text.trim() === "" ? undefined : Number(text) })} />
            </div>
          ) : null}
        </div>
      );
    }
    case "system":
      return <Select label="系统事件" value={trigger.event} onChange={(event) => onChange({ ...trigger, event })} options={SYSTEM_EVENTS.map((e) => ({ value: e, label: label(e) }))} />;
  }
}

/* ---------------- 动作 ---------------- */

type ListProps = {
  types: Record<string, ValueType>;
  pageId?: string;
  componentId?: string;
  fn?: FunctionDoc;
  highlight?: string;
};

function ActionList({ list, onChange, depth = 0, ...rest }: ListProps & { list: ActionNode[]; onChange: (list: ActionNode[]) => void; depth?: number }) {
  const { doc, advanced } = useLogic();
  const [kind, setKind] = useState<ActionNode["kind"]>("toast");
  const kinds = ACTION_KINDS.filter((k) => (advanced || !k.advanced) && (rest.fn || (k.kind !== "return" && k.kind !== "setLocal")));
  const chosen = kinds.some((k) => k.kind === kind) ? kind : kinds[0].kind;
  return (
    <div className={`grid gap-2 ${depth ? "border-l-2 border-line pl-2" : ""}`}>
      {list.map((a, i) => (
        <ActionItem
          key={a.id}
          action={a}
          depth={depth}
          {...rest}
          onChange={(next) => onChange(list.map((x) => (x.id === a.id ? next : x)))}
          onRemove={() => onChange(list.filter((x) => x.id !== a.id))}
          onMove={(dir) => {
            const j = i + dir;
            if (j < 0 || j >= list.length) return;
            const next = list.slice();
            [next[i], next[j]] = [next[j], next[i]];
            onChange(next);
          }}
          onCopy={() => onChange([...list.slice(0, i + 1), cloneAction(a), ...list.slice(i + 1)])}
        />
      ))}
      {list.length < PROTOCOL_LIMITS.actionsPerList && depth < PROTOCOL_LIMITS.actionDepth ? (
        <div className="flex gap-2">
          <Select label="动作类型" value={chosen} onChange={setKind} options={kinds.map((k) => ({ value: k.kind, label: k.label }))} className={`${small} min-w-0 flex-1`} />
          <button
            type="button"
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md border border-line px-3 text-sm"
            onClick={() => onChange([...list, makeActionNode(chosen, { doc, pageId: rest.pageId, componentId: rest.componentId })])}
          >
            <Plus className="size-4" />
            动作
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ActionItem({
  action: a,
  onChange,
  onRemove,
  onMove,
  onCopy,
  depth,
  ...rest
}: ListProps & {
  action: ActionNode;
  onChange: (a: ActionNode) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onCopy: () => void;
  depth: number;
}) {
  const { doc } = useLogic();
  const { types, fn, highlight } = rest;
  const components = useComponents();
  const compOptions = [{ value: "", label: "选择组件" }, ...components.map((c) => ({ value: c.id, label: `${c.pageName} · ${c.name || c.type}` }))];
  const varOptions = [{ value: "", label: "选择变量" }, ...doc.variables.map((v) => ({ value: v.id, label: `${v.key}（${VAR_TYPE_LABEL[v.type]}）` }))];
  const nested = (list: ActionNode[], put: (list: ActionNode[]) => void, extraTypes?: Record<string, ValueType>) => (
    <ActionList list={list} onChange={put} depth={depth + 1} {...rest} types={extraTypes ? { ...types, ...extraTypes } : types} />
  );
  let body: ReactNode = null;
  switch (a.kind) {
    case "navigate":
      body = <Select label="目标页面" value={a.pageId} onChange={(pageId) => onChange({ ...a, pageId })} options={doc.pages.map((p) => ({ value: p.id, label: p.name }))} />;
      break;
    case "toast":
      body = <TextOrExpr label="提示文字" value={a.text} types={types} onCommit={(text) => onChange({ ...a, text })} />;
      break;
    case "log":
      body = <ExprField label="输出内容" value={a.text} types={types} onCommit={(text) => onChange({ ...a, text })} />;
      break;
    case "show":
    case "hide":
    case "toggle":
      body = <Select label="组件" value={a.componentId} onChange={(componentId) => onChange({ ...a, componentId })} options={compOptions} />;
      break;
    case "setProp": {
      const comp = components.find((c) => c.id === a.componentId);
      const props = comp ? Object.keys(BINDABLE_PROPS[comp.type]) : [];
      const want = comp ? (BINDABLE_PROPS[comp.type][a.prop] as ValueType | undefined) : undefined;
      const textual = want === "string" && (a.prop === "text" || a.prop === "value");
      body = (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Select label="组件" value={a.componentId} onChange={(componentId) => onChange({ ...a, componentId })} options={compOptions} />
            <Select label="属性" value={a.prop} onChange={(prop) => onChange({ ...a, prop })} options={(props.includes(a.prop) ? props : [a.prop, ...props]).map((p) => ({ value: p, label: p }))} />
          </div>
          {textual ? (
            <TextOrExpr label="新值" value={a.value} types={types} onCommit={(value) => onChange({ ...a, value })} />
          ) : (
            <ExprField label="新值" value={a.value} types={types} want={want ?? null} onCommit={(value) => onChange({ ...a, value })} />
          )}
        </>
      );
      break;
    }
    case "setVar": {
      const v = doc.variables.find((x) => x.id === a.variableId);
      body = (
        <>
          <Select label="变量" value={a.variableId} onChange={(variableId) => onChange({ ...a, variableId })} options={varOptions} />
          <ExprField label="新值" value={a.value} types={types} want={v?.type ?? null} onCommit={(value) => onChange({ ...a, value })} placeholder={v ? `例如 ${v.key} + 1` : ""} />
        </>
      );
      break;
    }
    case "setLocal":
      body = (
        <>
          <Draft label="局部变量名" value={a.name} mono onCommit={(name) => /^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(name) && onChange({ ...a, name })} className={`${input} mt-2`} />
          <ExprField label="值" value={a.value} types={types} onCommit={(value) => onChange({ ...a, value })} />
        </>
      );
      break;
    case "call": {
      const target = doc.functions.find((f) => f.id === a.functionId);
      body = (
        <>
          <Select
            label="函数"
            value={a.functionId}
            onChange={(functionId) => onChange({ ...a, functionId, args: {} })}
            options={[{ value: "", label: "选择函数" }, ...doc.functions.map((f) => ({ value: f.id, label: `${f.name}(${f.params.map((p) => p.name).join(", ")})` }))]}
          />
          {target?.params.map((p) => (
            <ExprField
              key={p.name}
              label={`参数 ${p.name}（${VAR_TYPE_LABEL[p.type]}${p.default !== undefined ? `，默认 ${p.default}` : ""}）`}
              value={a.args[p.name] ?? ""}
              types={types}
              want={a.args[p.name] || p.default === undefined ? p.type : null}
              onCommit={(value) => {
                const args = { ...a.args };
                if (value.trim()) args[p.name] = value;
                else delete args[p.name];
                onChange({ ...a, args });
              }}
            />
          ))}
          {target && target.returnType !== "void" ? (
            <Select
              label="返回值写入变量"
              value={a.resultVariableId ?? ""}
              onChange={(resultVariableId) => onChange({ ...a, resultVariableId: resultVariableId || undefined })}
              options={[{ value: "", label: "不保存返回值" }, ...doc.variables.map((v) => ({ value: v.id, label: `写入 ${v.key}` }))]}
            />
          ) : null}
        </>
      );
      break;
    }
    case "if":
      body = (
        <>
          <ExprField label="条件" value={a.condition} types={types} want="bool" onCommit={(condition) => onChange({ ...a, condition })} />
          <p className="mt-2 text-xs font-medium">成立时</p>
          {nested(a.then, (then) => onChange({ ...a, then }))}
          <p className="mt-2 text-xs font-medium">否则</p>
          {nested(a.else, (list) => onChange({ ...a, else: list }))}
        </>
      );
      break;
    case "repeat":
      body = (
        <>
          <ExprField label={`次数（最多 ${PROTOCOL_LIMITS.repeatMax}）`} value={a.times} types={types} want="int" onCommit={(times) => onChange({ ...a, times })} />
          {nested(a.body, (list) => onChange({ ...a, body: list }))}
        </>
      );
      break;
    case "forEach":
      body = (
        <>
          <ExprField label="列表" value={a.list} types={types} want="array" onCommit={(list) => onChange({ ...a, list })} />
          <Draft label="每一项的名字" value={a.item} mono onCommit={(item) => /^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(item) && onChange({ ...a, item })} className={`${input} mt-2`} />
          {nested(a.body, (list) => onChange({ ...a, body: list }), { [a.item]: "any" })}
        </>
      );
      break;
    case "return":
      body =
        fn && fn.returnType !== "void" ? (
          <ExprField label="返回值" value={a.value ?? ""} types={types} want={fn.returnType} onCommit={(value) => onChange({ ...a, value: value.trim() ? value : undefined })} />
        ) : (
          <p className="mt-1 text-xs text-muted">结束当前函数。</p>
        );
      break;
    case "startTimer":
    case "stopTimer":
    case "resetTimer":
      body = <Select label="计时器" value={a.timerId} onChange={(timerId) => onChange({ ...a, timerId })} options={[{ value: "", label: "选择计时器" }, ...doc.timers.map((t) => ({ value: t.id, label: t.name }))]} />;
      break;
    default:
      body = null;
  }
  return (
    <div id={`logic-${a.id}`} className={`rounded-md border p-2 ${highlight === a.id ? "border-warn" : "border-line"}`}>
      <div className="flex items-center gap-1">
        <p className="min-w-0 flex-1 truncate text-xs font-medium" title={actionLabel(doc, a)}>
          {ACTION_KINDS.find((k) => k.kind === a.kind)?.label} · <span className="font-normal text-muted">{actionLabel(doc, a)}</span>
        </p>
        <IconButton label="上移动作" onClick={() => onMove(-1)}>
          <ArrowUp className="size-3.5" />
        </IconButton>
        <IconButton label="下移动作" onClick={() => onMove(1)}>
          <ArrowDown className="size-3.5" />
        </IconButton>
        <IconButton label="复制动作" onClick={onCopy}>
          <Copy className="size-3.5" />
        </IconButton>
        <IconButton label="删除动作" danger onClick={onRemove}>
          <Trash2 className="size-3.5" />
        </IconButton>
      </div>
      {body}
    </div>
  );
}

/* ---------------- 变量 ---------------- */

function VariablesTab() {
  const { doc, update, focus, setFocus, advanced } = useLogic();
  const [query, setQuery] = useState("");
  const list = doc.variables.filter((v) => !query || v.key.toLowerCase().includes(query.toLowerCase()) || (v.description ?? "").includes(query));
  function add() {
    if (doc.variables.length >= PROTOCOL_LIMITS.variables) return;
    const used = new Set(doc.variables.map((v) => v.key));
    let key = "count";
    let i = 2;
    while (used.has(key)) key = `count${i++}`;
    const v = { id: newId("v"), key, type: "int" as const, default: 0, scope: "global" as const, persist: false };
    update((logic) => ({ ...logic, variables: [...logic.variables, v] }));
    setFocus({ tab: "variables", id: v.id });
  }
  return (
    <div>
      <div className="flex gap-2">
        <input aria-label="搜索变量" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索变量" className={`${small} min-w-0 flex-1`} />
        <button type="button" onClick={add} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg">
          <Plus className="size-4" />
          变量
        </button>
      </div>
      {list.length === 0 ? <p className="mt-3 text-sm text-muted">还没有变量。变量可以绑定到文字、进度、开关和显示状态。</p> : null}
      <div className="mt-3 grid gap-2">
        {list.map((v) => (
          <VariableCard key={v.id} id={v.id} open={focus.id === v.id} onToggle={() => setFocus({ tab: "variables", id: focus.id === v.id ? undefined : v.id })} />
        ))}
      </div>
      {!advanced ? <p className="mt-3 text-xs text-muted">高级模式可以设置作用域、持久化和数组/对象类型。</p> : null}
    </div>
  );
}

function VariableCard({ id, open, onToggle }: { id: string; open: boolean; onToggle: () => void }) {
  const { doc, update, advanced, locate } = useLogic();
  const v = doc.variables.find((x) => x.id === id)!;
  const refs = useMemo(() => referencesOf(doc, v), [doc, v]);
  const components = useComponents();
  const [error, setError] = useState("");
  const types: VarType[] = advanced ? ValueTypeSchema.options : ["string", "int", "float", "bool"];
  function patch(next: Partial<typeof v>) {
    update((logic) => ({ ...logic, variables: logic.variables.map((x) => (x.id === id ? { ...x, ...next } : x)) }));
  }
  function rename(key: string) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(key)) return setError("变量名用字母、数字、下划线，字母开头");
    const clash = doc.variables.some((x) => x.id !== id && x.key === key && (x.scope === "global" || v.scope === "global" || x.ownerId === v.ownerId));
    if (clash) return setError(`已经有变量叫 ${key}`);
    setError("");
    update((logic) => renameVariable(logic, id, key));
  }
  function changeType(type: VarType) {
    // 修改类型前检查引用（规格 8.2），会产生新错误时先确认。
    const before = validateDoc(doc).issues.filter((i) => i.level === "error").length;
    const nextDoc = { ...doc, variables: doc.variables.map((x) => (x.id === id ? { ...x, type, default: defaultFor(type) } : x)) };
    const after = validateDoc(nextDoc).issues.filter((i) => i.level === "error").length;
    if (after > before && typeof window !== "undefined" && !window.confirm(`改成${VAR_TYPE_LABEL[type]}后会多出 ${after - before} 个错误（引用 ${refs.length} 处）。仍要修改吗？`)) return;
    patch({ type, default: defaultFor(type) });
  }
  return (
    <div id={`logic-${v.id}`} className={`rounded-xl border p-2 ${open ? "border-accent" : "border-line"}`}>
      <div className="flex items-center gap-1">
        <button type="button" onClick={onToggle} className="min-h-9 min-w-0 flex-1 truncate text-left text-sm">
          <span className="font-mono font-medium">{v.key}</span>
          <span className="ml-2 text-xs text-muted">
            {VAR_TYPE_LABEL[v.type]} · {v.scope === "global" ? "全局" : v.scope === "page" ? "页面" : "组件"} · 引用 {refs.length}
          </span>
        </button>
        <IconButton
          label="复制变量"
          onClick={() =>
            update((logic) => {
              const used = new Set(logic.variables.map((x) => x.key));
              let key = `${v.key}Copy`.slice(0, 28);
              let i = 2;
              while (used.has(key)) key = `${v.key}Copy${i++}`.slice(0, 32);
              return { ...logic, variables: [...logic.variables, { ...structuredClone(v), id: newId("v"), key }] };
            })
          }
        >
          <Copy className="size-3.5" />
        </IconButton>
        <IconButton
          label="删除变量"
          danger
          onClick={() => {
            if (refs.length && typeof window !== "undefined" && !window.confirm(`变量 ${v.key} 还有 ${refs.length} 处引用，删除后这些地方会报错。确定删除？`)) return;
            update((logic) => ({ ...logic, variables: logic.variables.filter((x) => x.id !== id) }));
          }}
        >
          <Trash2 className="size-3.5" />
        </IconButton>
      </div>
      {open ? (
        <div className="mt-2 border-t border-line pt-2">
          <label className="block text-xs text-muted">
            名称（改名会同步修改所有表达式）
            <Draft label="变量名" value={v.key} mono onCommit={rename} className={`${input} mt-1`} />
          </label>
          {error ? <p className="mt-1 text-xs text-warn">{error}</p> : null}
          <div className="grid grid-cols-2 gap-2">
            <Select label="类型" value={v.type} onChange={changeType} options={(types.includes(v.type) ? types : [v.type, ...types]).map((t) => ({ value: t, label: VAR_TYPE_LABEL[t] }))} />
            {v.type === "bool" ? (
              <Select label="默认值" value={String(v.default)} onChange={(text) => patch({ default: text === "true" })} options={[{ value: "false", label: "默认 false" }, { value: "true", label: "默认 true" }]} />
            ) : (
              <Draft
                label="默认值"
                value={defaultText(v)}
                placeholder="默认值"
                className={`${input} mt-2`}
                onCommit={(text) => {
                  const value = parseDefault(v.type, text);
                  if (value === undefined) setError(`默认值不是${VAR_TYPE_LABEL[v.type]}`);
                  else {
                    setError("");
                    patch({ default: value });
                  }
                }}
              />
            )}
          </div>
          {advanced ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Select
                  label="作用域"
                  value={v.scope}
                  onChange={(scope) => patch({ scope, ownerId: scope === "global" ? undefined : scope === "page" ? doc.pages[0]?.id : components[0]?.id })}
                  options={[
                    { value: "global", label: "全局变量" },
                    { value: "page", label: "页面变量" },
                    { value: "component", label: "组件变量" },
                  ]}
                />
                {v.scope === "page" ? (
                  <Select label="所属页面" value={v.ownerId ?? ""} onChange={(ownerId) => patch({ ownerId })} options={doc.pages.map((p) => ({ value: p.id, label: p.name }))} />
                ) : v.scope === "component" ? (
                  <Select label="所属组件" value={v.ownerId ?? ""} onChange={(ownerId) => patch({ ownerId })} options={components.map((c) => ({ value: c.id, label: `${c.pageName} · ${c.name}` }))} />
                ) : (
                  <p className="mt-2 flex min-h-11 items-center text-xs text-muted">所有页面可用</p>
                )}
              </div>
              <label className="mt-2 flex min-h-9 items-center justify-between text-sm">
                持久化（重启应用后保留）
                <input type="checkbox" className="size-5 accent-accent" checked={v.persist} onChange={(event) => patch({ persist: event.target.checked })} />
              </label>
              <Draft label="说明" value={v.description ?? ""} placeholder="说明（可选）" onCommit={(text) => patch({ description: text.trim() ? text.trim().slice(0, 80) : undefined })} className={`${input} mt-2`} />
            </>
          ) : null}
          <p className="mt-3 text-xs font-medium">引用位置</p>
          {refs.length === 0 ? <p className="text-xs text-muted">没有地方使用这个变量。</p> : null}
          <ul>
            {refs.map((r, i) => (
              <li key={i}>
                <button type="button" className="min-h-9 w-full truncate text-left text-xs text-accent" onClick={() => locate(issueTarget(doc, r.path))}>
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- 绑定（含时间绑定） ---------------- */

const TIME_FIELD_LABEL: Record<(typeof TIME_FIELDS)[number], string> = {
  now: "当前时间",
  year: "年",
  month: "月",
  day: "日",
  hour: "小时",
  minute: "分钟",
  second: "秒",
  weekday: "星期",
  timestamp: "时间戳",
  timerRemaining: "倒计时剩余",
  timerElapsed: "计时器已运行",
  timerPercent: "计时器进度 %",
};
const TIME_FORMATS = ["HH:mm", "HH:mm:ss", "hh:mm A", "YYYY-MM-DD", "MM月DD日", "MM/DD W", "W"];
const DURATION_FORMATS = ["mm:ss", "HH:mm:ss", "ss"];

function BindingsTab() {
  const { selectedComponentId, doc } = useLogic();
  const components = useComponents();
  const [componentId, setComponentId] = useState(selectedComponentId ?? "");
  useEffect(() => {
    if (selectedComponentId) setComponentId(selectedComponentId);
  }, [selectedComponentId]);
  return (
    <div>
      <Select
        label="组件"
        value={componentId}
        onChange={setComponentId}
        options={[{ value: "", label: `全部绑定（${doc.bindings.length}）` }, ...components.map((c) => ({ value: c.id, label: `${c.pageName} · ${c.name || c.type}` }))]}
      />
      {componentId ? (
        <BindingsEditor componentId={componentId} />
      ) : (
        <ul className="mt-3 grid gap-1">
          {doc.bindings.length === 0 ? <li className="text-sm text-muted">还没有绑定。选中组件后添加。</li> : null}
          {doc.bindings.map((b) => (
            <li key={b.id}>
              <button type="button" className="min-h-9 w-full truncate text-left text-sm" onClick={() => setComponentId(b.componentId)}>
                {components.find((c) => c.id === b.componentId)?.name}.{b.prop === VISIBLE_PROP ? "显示" : b.prop} ← {bindingSourceLabel(doc, b)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function bindingSourceLabel(doc: ProjectDoc, b: BindingDoc): string {
  const s = b.source;
  if (s.kind === "variable") return `变量 ${doc.variables.find((v) => v.id === s.variableId)?.key ?? "?"}`;
  if (s.kind === "expr") return `表达式 ${s.expr}`;
  return `${TIME_FIELD_LABEL[s.field]}${b.format ? `（${b.format}）` : ""}`;
}

/** 某个组件的数据绑定和时间绑定（规格 8.3 / 9.2）。属性面板和逻辑页共用。 */
export function BindingsEditor({ componentId }: { componentId: string }) {
  const { doc, update, advanced } = useLogic();
  const components = useComponents();
  const comp = components.find((c) => c.id === componentId);
  if (!comp) return <p className="mt-2 text-sm text-muted">组件不存在。</p>;
  const allowed: Record<string, VarType> = { ...BINDABLE_PROPS[comp.type], [VISIBLE_PROP]: "bool" };
  const list = doc.bindings.filter((b) => b.componentId === componentId);
  const free = Object.keys(allowed).filter((p) => !list.some((b) => b.prop === p));
  const types = typesInScope(doc, comp.pageId);
  function patch(id: string, next: Partial<BindingDoc>) {
    update((logic) => ({ ...logic, bindings: logic.bindings.map((b) => (b.id === id ? ({ ...b, ...next } as BindingDoc) : b)) }));
  }
  function add(kind: "variable" | "time" | "expr") {
    const prop = kind === "time" ? (free.find((p) => allowed[p] === "string") ?? free[0]) : free[0];
    if (!prop) return;
    const want = allowed[prop];
    const v = doc.variables.find((x) => x.type === want) ?? doc.variables[0];
    const source: BindingDoc["source"] =
      kind === "variable" && v
        ? { kind: "variable", variableId: v.id }
        : kind === "time"
          ? { kind: "time", field: "now" }
          : { kind: "expr", expr: want === "bool" ? "true" : want === "int" ? "0" : '""' };
    const b: BindingDoc = {
      id: newId("b"),
      componentId,
      prop,
      source,
      ...(kind === "time" ? { format: "HH:mm", refresh: "minute" as const } : { refresh: "change" as const }),
    };
    update((logic) => ({ ...logic, bindings: [...logic.bindings, b] }));
  }
  const propLabel = (p: string) => (p === VISIBLE_PROP ? "显示状态" : p);
  return (
    <div className="mt-2">
      {list.map((b) => {
        const want = allowed[b.prop] as ValueType | undefined;
        const timeSrc = b.source.kind === "time" ? b.source : null;
        const isTimer = Boolean(timeSrc?.field.startsWith("timer"));
        const preview = timeSrc && b.format && !isTimer ? formatTime(Date.now(), b.format) : "";
        const formats = isTimer ? DURATION_FORMATS : TIME_FORMATS;
        return (
          <div key={b.id} id={`logic-${b.id}`} className="mt-2 rounded-md border border-line p-2">
            <div className="flex items-center gap-1">
              <Select label="绑定属性" value={b.prop} onChange={(prop) => patch(b.id, { prop })} options={[b.prop, ...free].map((p) => ({ value: p, label: propLabel(p) }))} className={`${small} min-w-0 flex-1`} />
              <Select
                label="数据来源"
                value={b.source.kind}
                onChange={(kind) =>
                  patch(b.id, {
                    source: kind === "variable" ? { kind, variableId: doc.variables[0]?.id ?? "" } : kind === "time" ? { kind, field: "now" } : { kind, expr: '""' },
                    format: kind === "time" ? "HH:mm" : undefined,
                    refresh: kind === "time" ? "minute" : "change",
                  })
                }
                options={[{ value: "variable", label: "变量" }, { value: "time", label: "时间" }, ...(advanced || b.source.kind === "expr" ? [{ value: "expr" as const, label: "表达式" }] : [])]}
                className={`${small} w-24 shrink-0`}
              />
              <IconButton label="删除绑定" danger onClick={() => update((logic) => ({ ...logic, bindings: logic.bindings.filter((x) => x.id !== b.id) }))}>
                <Trash2 className="size-3.5" />
              </IconButton>
            </div>
            {b.source.kind === "variable" ? (
              <Select
                label="变量"
                value={b.source.variableId}
                onChange={(variableId) => patch(b.id, { source: { kind: "variable", variableId } })}
                options={[{ value: "", label: "选择变量" }, ...doc.variables.map((v) => ({ value: v.id, label: `${v.key}（${VAR_TYPE_LABEL[v.type]}）${want && want !== "string" && !assignable(v.type, want) ? " · 类型不符" : ""}` }))]}
              />
            ) : null}
            {b.source.kind === "expr" ? <ExprField label="表达式" value={b.source.expr} types={types} want={want ?? null} onCommit={(expr) => patch(b.id, { source: { kind: "expr", expr } })} /> : null}
            {timeSrc ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Select
                    label="时间数据"
                    value={timeSrc.field}
                    onChange={(field) =>
                      patch(b.id, {
                        source: { kind: "time", field, ...(field.startsWith("timer") ? { timerId: timeSrc.timerId ?? doc.timers[0]?.id ?? "" } : {}) },
                        format: field === "now" ? "HH:mm" : field === "timerRemaining" || field === "timerElapsed" ? "mm:ss" : undefined,
                      })
                    }
                    options={TIME_FIELDS.filter((f) => advanced || !f.startsWith("timer")).map((f) => ({ value: f, label: TIME_FIELD_LABEL[f] }))}
                  />
                  <Select
                    label="刷新频率"
                    value={b.refresh ?? "minute"}
                    onChange={(refresh) => patch(b.id, { refresh })}
                    options={[{ value: "minute", label: "每分钟（省电）" }, { value: "second", label: "每秒" }, { value: "change", label: "变化时" }]}
                  />
                </div>
                {isTimer ? (
                  <Select label="计时器" value={timeSrc.timerId ?? ""} onChange={(timerId) => patch(b.id, { source: { ...timeSrc, timerId } })} options={[{ value: "", label: "选择计时器" }, ...doc.timers.map((t) => ({ value: t.id, label: t.name }))]} />
                ) : null}
                {timeSrc.field !== "timerPercent" ? (
                  <div className="mt-2 flex gap-2">
                    <Select
                      label="格式"
                      value={formats.includes(b.format ?? "") ? (b.format as string) : b.format ? "__custom" : ""}
                      onChange={(format) => format !== "__custom" && patch(b.id, { format: format || undefined })}
                      options={[{ value: "", label: "不格式化（数字）" }, ...formats.map((f) => ({ value: f, label: f })), { value: "__custom", label: "自定义…" }]}
                      className={`${small} min-w-0 flex-1`}
                    />
                    <Draft label="自定义格式" value={b.format ?? ""} mono placeholder="YYYY MM DD HH mm ss" onCommit={(format) => patch(b.id, { format: format.trim() ? format.slice(0, 40) : undefined })} className={`${small} w-32 shrink-0`} />
                  </div>
                ) : null}
                {preview ? <p className="mt-1 text-xs text-muted">现在显示：{preview}（设备本地时间和时区）</p> : null}
              </>
            ) : null}
          </div>
        );
      })}
      {free.length ? (
        <div className="mt-2 grid grid-cols-3 gap-1">
          <button type="button" onClick={() => add("variable")} disabled={!doc.variables.length} className="min-h-11 rounded-md border border-line text-xs disabled:opacity-50">
            + 绑定变量
          </button>
          <button type="button" onClick={() => add("time")} className="min-h-11 rounded-md border border-line text-xs">
            + 绑定时间
          </button>
          <button type="button" onClick={() => add("expr")} disabled={!advanced} className="min-h-11 rounded-md border border-line text-xs disabled:opacity-50">
            + 表达式
          </button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">可绑定的属性都已绑定。</p>
      )}
      <p className="mt-1 text-xs text-muted">可绑定：{Object.keys(allowed).map(propLabel).join("、")}。类型不匹配会在「检查」里报错。</p>
    </div>
  );
}

/* ---------------- 函数 ---------------- */

function FunctionsTab() {
  const { doc, update, focus, setFocus } = useLogic();
  const graph = useMemo(() => callGraph(doc), [doc]);
  const nameOf = (id: string) => doc.functions.find((f) => f.id === id)?.name ?? (doc.events.find((e) => e.id === id) ? `事件「${eventLabel(doc, doc.events.find((e) => e.id === id)!)}」` : id);
  function add() {
    if (doc.functions.length >= PROTOCOL_LIMITS.functions) return;
    const used = new Set(doc.functions.map((f) => f.name));
    let name = "myFunction";
    let i = 2;
    while (used.has(name)) name = `myFunction${i++}`;
    const fn: FunctionDoc = { id: newId("f"), name, params: [], returnType: "void", locals: [], body: [], version: 1 };
    update((logic) => ({ ...logic, functions: [...logic.functions, fn] }));
    setFocus({ tab: "functions", id: fn.id });
  }
  return (
    <div>
      <button type="button" onClick={add} className="inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-md bg-accent text-sm font-medium text-accent-fg">
        <Plus className="size-4" />
        新建函数
      </button>
      {doc.functions.length === 0 ? <p className="mt-3 text-sm text-muted">函数可以带参数和返回值，从事件或其他函数调用。递归深度、循环次数和执行步数都有限制。</p> : null}
      <div className="mt-3 grid gap-2">
        {doc.functions.map((fn) => (
          <FunctionCard
            key={fn.id}
            fn={fn}
            open={focus.id === fn.id}
            callers={(graph.callers[fn.id] ?? []).map(nameOf)}
            calls={(graph.calls[fn.id] ?? []).map(nameOf)}
            onToggle={() => setFocus({ tab: "functions", id: focus.id === fn.id ? undefined : fn.id })}
          />
        ))}
      </div>
    </div>
  );
}

function FunctionCard({ fn, open, onToggle, callers, calls }: { fn: FunctionDoc; open: boolean; onToggle: () => void; callers: string[]; calls: string[] }) {
  const { doc, update, focus } = useLogic();
  const [error, setError] = useState("");
  const types = useMemo(() => typesInScope(doc, undefined, functionLocals(fn)), [doc, fn]);
  function patch(next: Partial<FunctionDoc>) {
    update((logic) => ({ ...logic, functions: logic.functions.map((f) => (f.id === fn.id ? { ...f, ...next } : f)) }));
  }
  const varTypes = ValueTypeSchema.options;
  const typeOptions = varTypes.map((t) => ({ value: t, label: VAR_TYPE_LABEL[t] }));
  const freeName = (base: string) => {
    const used = new Set([...fn.params.map((p) => p.name), ...fn.locals.map((l) => l.name)]);
    let name = base;
    let i = 2;
    while (used.has(name)) name = `${base}${i++}`;
    return name;
  };
  const nameOk = (name: string) => /^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(name);
  return (
    <div id={`logic-${fn.id}`} className={`rounded-xl border p-2 ${open ? "border-accent" : "border-line"}`}>
      <div className="flex items-center gap-1">
        <button type="button" onClick={onToggle} className="min-h-9 min-w-0 flex-1 truncate text-left text-sm">
          <span className="font-mono font-medium">
            {fn.name}({fn.params.map((p) => p.name).join(", ")})
          </span>
          <span className="ml-2 text-xs text-muted">
            → {fn.returnType === "void" ? "无返回" : VAR_TYPE_LABEL[fn.returnType]} · v{fn.version}
          </span>
        </button>
        <IconButton
          label="删除函数"
          danger
          onClick={() => {
            if (callers.length && typeof window !== "undefined" && !window.confirm(`${fn.name} 还被 ${callers.length} 处调用，删除后这些地方会报错。确定删除？`)) return;
            update((logic) => ({ ...logic, functions: logic.functions.filter((f) => f.id !== fn.id) }));
          }}
        >
          <Trash2 className="size-3.5" />
        </IconButton>
      </div>
      {open ? (
        <div className="mt-2 border-t border-line pt-2">
          <div className="grid grid-cols-2 gap-2">
            <Draft
              label="函数名"
              value={fn.name}
              mono
              onCommit={(name) => {
                if (!/^[A-Za-z][A-Za-z0-9_]{0,23}$/.test(name)) return setError("函数名用字母、数字、下划线，字母开头");
                if (doc.functions.some((f) => f.id !== fn.id && f.name === name)) return setError("函数名重复");
                setError("");
                patch({ name });
              }}
              className={`${input} mt-2`}
            />
            <Select
              label="返回类型"
              value={fn.returnType}
              onChange={(returnType) => patch({ returnType })}
              options={[{ value: "void" as const, label: "无返回值" }, ...varTypes.map((t) => ({ value: t, label: `返回${VAR_TYPE_LABEL[t]}` }))]}
            />
          </div>
          {error ? <p className="mt-1 text-xs text-warn">{error}</p> : null}
          <Draft label="函数说明" value={fn.description ?? ""} placeholder="说明（可选）" onCommit={(description) => patch({ description: description.trim() ? description.trim().slice(0, 120) : undefined })} className={`${input} mt-2`} />
          <p className="mt-3 text-xs font-medium">参数（最多 {PROTOCOL_LIMITS.params} 个）</p>
          {fn.params.map((p, i) => (
            <div key={i} className="mt-1 grid grid-cols-[1fr_80px_1fr_auto] gap-1">
              <Draft label="参数名" value={p.name} mono onCommit={(name) => nameOk(name) && patch({ params: fn.params.map((x, j) => (j === i ? { ...x, name } : x)) })} className={small} />
              <Select label="参数类型" value={p.type} onChange={(type) => patch({ params: fn.params.map((x, j) => (j === i ? { ...x, type } : x)) })} options={typeOptions} className={small} />
              <Draft label="默认值表达式" value={p.default ?? ""} mono placeholder="默认值" onCommit={(text) => patch({ params: fn.params.map((x, j) => (j === i ? { ...x, default: text.trim() ? text : undefined } : x)) })} className={small} />
              <IconButton label="删除参数" danger onClick={() => patch({ params: fn.params.filter((_, j) => j !== i) })}>
                <Trash2 className="size-3.5" />
              </IconButton>
            </div>
          ))}
          {fn.params.length < PROTOCOL_LIMITS.params ? (
            <button type="button" className="mt-1 min-h-9 w-full rounded-md border border-line text-xs" onClick={() => patch({ params: [...fn.params, { name: freeName("value"), type: "int" }] })}>
              + 参数
            </button>
          ) : null}
          <p className="mt-3 text-xs font-medium">局部变量</p>
          {fn.locals.map((l, i) => (
            <div key={i} className="mt-1 grid grid-cols-[1fr_80px_auto] gap-1">
              <Draft label="局部变量名" value={l.name} mono onCommit={(name) => nameOk(name) && patch({ locals: fn.locals.map((x, j) => (j === i ? { ...x, name } : x)) })} className={small} />
              <Select label="局部变量类型" value={l.type} onChange={(type) => patch({ locals: fn.locals.map((x, j) => (j === i ? { ...x, type } : x)) })} options={typeOptions} className={small} />
              <IconButton label="删除局部变量" danger onClick={() => patch({ locals: fn.locals.filter((_, j) => j !== i) })}>
                <Trash2 className="size-3.5" />
              </IconButton>
            </div>
          ))}
          <button type="button" className="mt-1 min-h-9 w-full rounded-md border border-line text-xs" onClick={() => patch({ locals: [...fn.locals, { name: freeName("temp"), type: "int" }] })}>
            + 局部变量
          </button>
          <p className="mt-3 text-xs font-medium">函数逻辑</p>
          <ActionList list={fn.body} fn={fn} types={types} highlight={focus.actionId} onChange={(body) => patch({ body })} />
          <div className="mt-3 rounded-md bg-surface-2 p-2 text-xs leading-5 text-muted">
            <p>被调用：{callers.length ? callers.join("、") : "无"}</p>
            <p>调用了：{calls.length ? calls.join("、") : "无"}</p>
            <p className="flex items-center justify-between">
              版本 v{fn.version}
              <button type="button" className="min-h-9 px-2 text-accent" onClick={() => patch({ version: fn.version + 1 })}>
                记为新版本
              </button>
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- 计时器 ---------------- */

function TimersTab() {
  const { doc, update } = useLogic();
  const setTimer = (id: string, next: Partial<ProjectDoc["timers"][number]>) =>
    update((logic) => ({ ...logic, timers: logic.timers.map((x) => (x.id === id ? { ...x, ...next } : x)) }));
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {(["countdown", "stopwatch"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            disabled={doc.timers.length >= PROTOCOL_LIMITS.timers}
            className="min-h-11 rounded-md border border-line text-sm disabled:opacity-50"
            onClick={() =>
              update((logic) => ({
                ...logic,
                timers: [...logic.timers, { id: newId("t"), name: `${kind === "countdown" ? "倒计时" : "秒表"}${logic.timers.length + 1}`, kind, durationSec: 60 }],
              }))
            }
          >
            + {kind === "countdown" ? "倒计时" : "秒表"}
          </button>
        ))}
      </div>
      {doc.timers.length === 0 ? <p className="mt-3 text-sm text-muted">用「启动/暂停/重置计时器」动作控制计时器，结束时触发「计时器结束」事件；剩余时间可以绑定到文字或进度。</p> : null}
      {doc.timers.map((t) => (
        <div key={t.id} id={`logic-${t.id}`} className="mt-2 rounded-md border border-line p-2">
          <div className="flex items-center gap-1">
            <Draft label="计时器名称" value={t.name} onCommit={(name) => name.trim() && setTimer(t.id, { name: name.trim().slice(0, 40) })} className={`${small} min-w-0 flex-1`} />
            <IconButton label="删除计时器" danger onClick={() => update((logic) => ({ ...logic, timers: logic.timers.filter((x) => x.id !== t.id) }))}>
              <Trash2 className="size-3.5" />
            </IconButton>
          </div>
          {t.kind === "countdown" ? (
            <label className="mt-2 block text-xs text-muted">
              时长（秒）
              <Draft
                label="倒计时时长"
                value={String(t.durationSec)}
                onCommit={(text) => {
                  const n = Math.round(Number(text));
                  if (n >= 1 && n <= 604800) setTimer(t.id, { durationSec: n });
                }}
                className={`${input} mt-1`}
              />
            </label>
          ) : (
            <p className="mt-1 text-xs text-muted">秒表从启动开始累计时间。</p>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------------- 检查 ---------------- */

function ChecksTab({ issues }: { issues: ProtocolIssue[] }) {
  const { doc, locate } = useLogic();
  const errors = issues.filter((i) => i.level === "error");
  const warns = issues.filter((i) => i.level === "warn");
  return (
    <div>
      <p className="text-sm">
        {errors.length ? `${errors.length} 个错误，修正后才能构建。` : "没有错误。"}
        {warns.length ? ` ${warns.length} 个提醒。` : ""}
      </p>
      <p className="mt-1 text-xs text-muted">这是静态检查和网页模拟，不代表手表真机已验证。</p>
      <ul className="mt-2 grid gap-1">
        {[...errors, ...warns].map((issue, i) => (
          <li key={i}>
            <button type="button" className="flex min-h-11 w-full items-start gap-2 rounded-md border border-line p-2 text-left text-xs" onClick={() => locate(issueTarget(doc, issue.path))}>
              <Crosshair className={`mt-0.5 size-3.5 shrink-0 ${issue.level === "error" ? "text-warn" : "text-muted"}`} />
              <span className="min-w-0">
                <span className={issue.level === "error" ? "text-warn" : "text-muted"}>{issue.level === "error" ? "错误" : "提醒"}</span> {labelForPath(doc, issue.path)}：{issue.message}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ======================================================================= */
/* 属性面板里的组件逻辑                                                       */
/* ======================================================================= */

/** 属性面板：这个组件的事件（简易模式可直接加常用点击动作）和数据绑定。 */
export function ComponentLogic({ componentId, openInLogic }: { componentId: string; openInLogic: (focus: Focus) => void }) {
  const { doc, update } = useLogic();
  const events = doc.events.filter((ev) => ev.trigger.kind === "component" && ev.trigger.componentId === componentId);
  const page = doc.pages.find((p) => p.components.some((c) => c.id === componentId));
  const types = useMemo(() => typesInScope(doc, page?.id), [doc, page?.id]);
  const click = events.find((ev) => ev.trigger.event === "click" && ev.enabled && !ev.condition);
  const [kind, setKind] = useState<ActionNode["kind"]>("navigate");
  function addClickAction() {
    const action = makeActionNode(kind, { doc, pageId: page?.id, componentId });
    if (click) update((logic) => ({ ...logic, events: logic.events.map((e) => (e.id === click.id ? { ...e, actions: [...e.actions, action] } : e)) }));
    else update((logic) => ({ ...logic, events: [...logic.events, makeEvent({ kind: "component", componentId, event: "click" }, [action])] }));
  }
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="text-sm font-medium">点击动作</p>
      {click ? (
        <div className="mt-2">
          <ActionList list={click.actions} types={types} pageId={page?.id} componentId={componentId} onChange={(actions) => update((logic) => ({ ...logic, events: logic.events.map((e) => (e.id === click.id ? { ...e, actions } : e)) }))} />
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <Select label="点击时执行" value={kind} onChange={setKind} options={ACTION_KINDS.filter((k) => !k.advanced).map((k) => ({ value: k.kind, label: `点击时：${k.label}` }))} className={`${small} min-w-0 flex-1`} />
          <button type="button" className="min-h-11 shrink-0 rounded-md border border-line px-3 text-sm" onClick={addClickAction}>
            添加
          </button>
        </div>
      )}
      {events.filter((ev) => ev !== click).length ? (
        <>
          <p className="mt-3 text-xs text-muted">其他事件</p>
          <ul className="mt-1 grid gap-1">
            {events
              .filter((ev) => ev !== click)
              .map((ev) => (
                <li key={ev.id} className="flex items-center justify-between gap-2 rounded-md border border-line px-2 text-xs">
                  <span className="truncate">
                    {eventLabel(doc, ev)} · {ev.actions.length} 个动作{ev.enabled ? "" : "（已停用）"}
                  </span>
                  <button type="button" className="min-h-9 shrink-0 px-2 text-accent" onClick={() => openInLogic({ tab: "events", id: ev.id })}>
                    编辑
                  </button>
                </li>
              ))}
          </ul>
        </>
      ) : null}
      <button type="button" className="mt-2 min-h-9 w-full rounded-md border border-line text-xs" onClick={() => openInLogic({ tab: "events" })}>
        在逻辑页管理全部事件
      </button>
      <p className="mt-4 text-sm font-medium">数据绑定</p>
      <BindingsEditor componentId={componentId} />
    </div>
  );
}
