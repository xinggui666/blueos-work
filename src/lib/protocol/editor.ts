/**
 * 网页编辑器模型（Project）与统一协议（ProjectDoc）之间的适配。
 *
 * 原生模式（protocolExtras.native = true，阶段 3 起的默认）：
 *   Project 只承载外观（页面、组件、导航、元信息），全部逻辑（变量、事件、函数、计时器、绑定）
 *   以协议 v2 原样保存在 protocolExtras 里，由逻辑编辑器直接编辑，ID 稳定、往返无损。
 * 旧模式（v1 编辑器数据）：逻辑在 node.actions / variables / functions / timeBindings 里，
 *   打开时用 toNative() 一次性转换成原生模式。
 * docToLegacyProject() 把协议降级成 v1 结构（兼容旧客户端读取，生成器不再使用）。
 */
import type {
  AppAction,
  AppFunction,
  AppVariable,
  Project,
  ScenePage,
  TimeBinding,
  TimeFormat,
} from "../blueos/model.ts";
import { parseExpr, toText, type Expr } from "./expr.ts";
import { v1EditorToV2 } from "./migrate.ts";
import type {
  ActionNode,
  BindingDoc,
  EventDoc,
  FunctionDoc,
  ProjectDoc,
  TimerDoc,
  AssetDoc,
  VariableDoc,
} from "./schema.ts";
import { computeDependencies } from "./validate.ts";

export type ProtocolExtras = {
  createdAt: number;
  revision: number;
  manifest: ProjectDoc["manifest"];
  variables: VariableDoc[];
  events: EventDoc[];
  functions: FunctionDoc[];
  timers: TimerDoc[];
  bindings: BindingDoc[];
  assets: AssetDoc[];
  /** 页面标题等编辑器还没有的字段。 */
  pageTitles: Record<string, string>;
  /** 组件旋转、版本等。 */
  componentMeta: Record<string, { version: string; rotation?: number }>;
  /** 原生模式：逻辑只存在这里。 */
  native?: true;
  /** 协议里没有 templateId 时为 null（Project 要求有值，往返时还原）。 */
  templateId?: string | null;
};

export type LogicDoc = Pick<ProjectDoc, "variables" | "events" | "functions" | "timers" | "bindings">;

export type EditorProject = Project & { protocolExtras?: ProtocolExtras };

const TRIGGER_TO_V1: Record<string, AppAction["trigger"]> = {
  click: "click",
  longPress: "longpress",
  doubleClick: "double",
  swipeLeft: "swipe",
};
const TEXT_PROP: Record<string, string> = {
  text: "text",
  number: "text",
  time: "text",
  button: "value",
};
const FORMAT_TO_V1: Record<string, TimeFormat> = {
  "HH:mm": "time",
  "HH:mm:ss": "timeSeconds",
  "YYYY-MM-DD": "date",
  W: "weekday",
};

/** 表达式如果只是 "文字" + str(变量) 的拼接，还原成 v1 的 "$变量" 模板。 */
export function exprToTemplate(src: string): string | null {
  let ast: Expr;
  try {
    ast = parseExpr(src);
  } catch {
    return null;
  }
  const parts: string[] = [];
  const walk = (e: Expr): boolean => {
    if (e.t === "bin" && e.op === "+") return walk(e.a) && walk(e.b);
    if (e.t === "lit" && typeof e.v === "string") {
      parts.push(e.v);
      return true;
    }
    if (e.t === "call" && e.fn === "str" && e.args.length === 1 && e.args[0].t === "var") {
      parts.push(`$${e.args[0].name}`);
      return true;
    }
    return false;
  };
  return walk(ast) ? parts.join("") : null;
}

function literalValue(src: string): string | null {
  try {
    const ast = parseExpr(src);
    if (ast.t === "lit") return toText(ast.v);
    if (ast.t === "un" && ast.op === "-" && ast.a.t === "lit" && typeof ast.a.v === "number")
      return String(-ast.a.v);
  } catch {
    return null;
  }
  return null;
}

/** 协议 → v1 结构（能表达的逻辑还原成 v1 字段）。只用于旧生成器和兼容旧客户端。 */
export function docToLegacyProject(
  doc: ProjectDoc,
  revisions: Project["revisions"] = [],
  loose = false,
): EditorProject {
  const pageName = new Map(doc.pages.map((p) => [p.id, p.name]));
  const compType = new Map<string, string>();
  doc.pages.forEach((p) => p.components.forEach((c) => compType.set(c.id, c.type)));
  const extras: ProtocolExtras = {
    createdAt: doc.project.createdAt,
    revision: doc.project.revision,
    manifest: doc.manifest,
    variables: [],
    events: [],
    functions: [],
    timers: doc.timers,
    bindings: [],
    assets: doc.assets,
    pageTitles: {},
    componentMeta: {},
  };

  const variables: AppVariable[] = [];
  const v1Vars = new Map<string, AppVariable>();
  for (const v of doc.variables) {
    const kind =
      v.type === "string"
        ? "string"
        : v.type === "bool"
          ? "boolean"
          : v.type === "int" || v.type === "float"
            ? "number"
            : null;
    if (!kind || v.scope === "component" || v.persist || v.description) {
      extras.variables.push(v);
      continue;
    }
    const item: AppVariable = {
      id: v.id,
      key: v.key,
      kind,
      value: toText(v.default as never),
      scope: v.scope === "page" ? "page" : "app",
      pageId: v.ownerId ?? "",
    };
    variables.push(item);
    v1Vars.set(v.id, item);
  }
  const v1Fns = new Map<string, string>();
  for (const f of doc.functions)
    if (
      !f.params.length &&
      f.returnType === "void" &&
      !f.locals.length &&
      !f.description &&
      f.version === 1
    )
      v1Fns.set(f.id, f.name);

  const back = (a: ActionNode): AppAction | null => {
    const base: AppAction = {
      id: a.id,
      kind: "back",
      trigger: "click",
      pageName: "",
      nodeId: "",
      text: "",
      varKey: "",
      varValue: "",
      whenKey: "",
      whenValue: "",
    };
    switch (a.kind) {
      case "navigate": {
        const name = pageName.get(a.pageId);
        return name ? { ...base, kind: "navigate", pageName: name } : null;
      }
      case "back":
        return base;
      case "toast": {
        const text = exprToTemplate(a.text);
        return text === null ? null : { ...base, kind: "toast", text };
      }
      case "show":
      case "hide":
        return { ...base, kind: a.kind, nodeId: a.componentId };
      case "setProp": {
        if (TEXT_PROP[compType.get(a.componentId) ?? ""] !== a.prop) return null;
        const text = exprToTemplate(a.value);
        return text === null ? null : { ...base, kind: "setText", nodeId: a.componentId, text };
      }
      case "setVar": {
        const v = v1Vars.get(a.variableId);
        const value = literalValue(a.value);
        return v && value !== null
          ? { ...base, kind: "setVar", varKey: v.key, varValue: value }
          : null;
      }
      case "call": {
        const name = v1Fns.get(a.functionId);
        return name && !Object.keys(a.args).length && !a.resultVariableId && !a.resultLocal
          ? { ...base, kind: "call", varKey: name }
          : null;
      }
      case "if": {
        if (a.then.length !== 1 || a.else.length) return null;
        const m = /^([A-Za-z_][A-Za-z0-9_]*) == (.+)$/.exec(a.condition);
        if (!m) return null;
        const v = [...v1Vars.values()].find((x) => x.key === m[1]);
        const value = literalValue(m[2]);
        const inner = back(a.then[0]);
        if (!v || value === null || !inner || inner.whenKey) return null;
        return { ...inner, whenKey: v.key, whenValue: value };
      }
      default:
        return null;
    }
  };
  const backAll = (list: ActionNode[]): AppAction[] | null => {
    const out: AppAction[] = [];
    for (const a of list) {
      const x = back(a);
      if (!x) return null;
      out.push(x);
    }
    return out;
  };

  const nodeActions = new Map<string, AppAction[]>();
  for (const ev of doc.events) {
    const trig = ev.trigger.kind === "component" ? TRIGGER_TO_V1[ev.trigger.event] : undefined;
    const converted =
      trig &&
      ev.enabled &&
      !ev.condition &&
      !ev.throttleMs &&
      (loose ||
        (!ev.name &&
          ev.id ===
            `e-${(ev.trigger as { componentId: string }).componentId}-${ev.trigger.event}`.slice(0, 48)))
        ? backAll(ev.actions)
        : null;
    if (!converted || ev.trigger.kind !== "component") {
      extras.events.push(ev);
      continue;
    }
    const list = nodeActions.get(ev.trigger.componentId) ?? [];
    list.push(...converted.map((a) => ({ ...a, trigger: trig! })));
    nodeActions.set(ev.trigger.componentId, list);
  }

  const functions: AppFunction[] = [];
  for (const f of doc.functions) {
    const steps = v1Fns.has(f.id) ? backAll(f.body) : null;
    if (steps) functions.push({ id: f.id, name: f.name, steps });
    else extras.functions.push(f);
  }

  const textOverride = new Map<string, string>();
  const timeBindings: TimeBinding[] = [];
  for (const b of doc.bindings) {
    const prop = TEXT_PROP[compType.get(b.componentId) ?? ""];
    if (
      b.source.kind === "time" &&
      b.source.field === "now" &&
      prop === b.prop &&
      b.format &&
      FORMAT_TO_V1[b.format]
    ) {
      const format = FORMAT_TO_V1[b.format];
      const expectRefresh = format === "timeSeconds" ? "second" : "minute";
      if ((b.refresh ?? expectRefresh) === expectRefresh) {
        timeBindings.push({ id: b.id, nodeId: b.componentId, format });
        continue;
      }
    }
    if (
      b.source.kind === "expr" &&
      prop === b.prop &&
      b.id === `b-${b.componentId}-${b.prop}`.slice(0, 48) &&
      (b.refresh ?? "change") === "change"
    ) {
      const template = exprToTemplate(b.source.expr);
      if (template !== null && /\$[A-Za-z]/.test(template)) {
        textOverride.set(b.componentId, template);
        continue;
      }
    }
    extras.bindings.push(b);
  }

  const pages: ScenePage[] = doc.pages.map((page) => {
    if (page.title) extras.pageTitles[page.id] = page.title;
    return {
      id: page.id,
      name: page.name,
      background: page.background,
      nodes: page.components.map((c) => {
        if (c.version !== "1.0.0" || c.layout.rotation)
          extras.componentMeta[c.id] = {
            version: c.version,
            ...(c.layout.rotation ? { rotation: c.layout.rotation } : {}),
          };
        const props = { ...c.props };
        const prop = TEXT_PROP[c.type];
        if (prop && textOverride.has(c.id)) props[prop] = textOverride.get(c.id)!;
        return {
          id: c.id,
          type: c.type,
          name: c.name,
          x: c.layout.x,
          y: c.layout.y,
          w: c.layout.w,
          h: c.layout.h,
          locked: c.locked,
          hidden: c.hidden,
          props,
          actions: nodeActions.get(c.id) ?? [],
        };
      }),
    };
  });

  return {
    id: doc.project.id,
    name: doc.project.name,
    appName: doc.project.appName,
    packageName: doc.project.packageName,
    device: doc.manifest.device,
    designWidth: 466,
    updatedAt: doc.project.updatedAt,
    startPageId: doc.startPageId,
    nav: {
      kind: doc.navigation.kind,
      items: doc.navigation.items.map((i) => ({ id: i.id, label: i.label, pageId: i.pageId })),
    },
    variables,
    functions,
    timeBindings,
    templateId: (doc.project.templateId as Project["templateId"]) ?? "blank",
    pages,
    revisions,
    protocolExtras: extras,
  };
}

function legacyProjectToDoc(project: EditorProject): ProjectDoc {
  const doc = v1EditorToV2(project, []);
  const x = project.protocolExtras;
  if (!x) return doc;
  doc.project.createdAt = x.createdAt || doc.project.createdAt;
  doc.project.revision = x.revision || 0;
  doc.manifest = { ...x.manifest, device: doc.manifest.device };
  const pageIds = new Set(doc.pages.map((p) => p.id));
  const compIds = new Set(doc.pages.flatMap((p) => p.components.map((c) => c.id)));
  for (const page of doc.pages) {
    if (x.pageTitles[page.id]) page.title = x.pageTitles[page.id];
    for (const c of page.components) {
      const meta = x.componentMeta[c.id];
      if (meta) {
        c.version = meta.version;
        if (meta.rotation) c.layout.rotation = meta.rotation;
      }
    }
  }
  const keep = <T extends { id: string }>(base: T[], extra: T[]) => {
    const ids = new Set(base.map((i) => i.id));
    return [...base, ...extra.filter((i) => !ids.has(i.id))];
  };
  // 编辑器删掉了组件/页面时，引用它们的保留项也一起去掉，避免悬空引用。
  doc.variables = keep(
    doc.variables,
    x.variables.filter(
      (v) =>
        v.scope === "global" || (v.ownerId && (pageIds.has(v.ownerId) || compIds.has(v.ownerId))),
    ),
  );
  doc.events = keep(
    doc.events,
    x.events.filter((e) =>
      e.trigger.kind === "component"
        ? compIds.has(e.trigger.componentId)
        : e.trigger.kind === "page"
          ? pageIds.has(e.trigger.pageId)
          : true,
    ),
  );
  doc.functions = keep(doc.functions, x.functions);
  doc.timers = keep(doc.timers, x.timers);
  doc.bindings = keep(
    doc.bindings,
    x.bindings.filter((b) => compIds.has(b.componentId)),
  );
  doc.assets = keep(doc.assets, x.assets);
  doc.dependencies = computeDependencies(doc);
  return doc;
}

export function isNative(project: Pick<EditorProject, "protocolExtras">): boolean {
  return project.protocolExtras?.native === true;
}

/** 协议 → 原生模式 Project：外观映射到 Project，全部逻辑原样放进 protocolExtras。 */
export function docToProject(doc: ProjectDoc, revisions: Project["revisions"] = []): EditorProject {
  const extras: ProtocolExtras = {
    native: true,
    templateId: doc.project.templateId ?? null,
    createdAt: doc.project.createdAt,
    revision: doc.project.revision,
    manifest: doc.manifest,
    variables: doc.variables,
    events: doc.events,
    functions: doc.functions,
    timers: doc.timers,
    bindings: doc.bindings,
    assets: doc.assets,
    pageTitles: {},
    componentMeta: {},
  };
  const pages: ScenePage[] = doc.pages.map((page) => {
    if (page.title) extras.pageTitles[page.id] = page.title;
    return {
      id: page.id,
      name: page.name,
      background: page.background,
      nodes: page.components.map((c) => {
        if (c.version !== "1.0.0" || c.layout.rotation)
          extras.componentMeta[c.id] = {
            version: c.version,
            ...(c.layout.rotation ? { rotation: c.layout.rotation } : {}),
          };
        return {
          id: c.id,
          type: c.type,
          name: c.name,
          x: c.layout.x,
          y: c.layout.y,
          w: c.layout.w,
          h: c.layout.h,
          locked: c.locked,
          hidden: c.hidden,
          props: { ...c.props },
          actions: [],
        };
      }),
    };
  });
  return {
    id: doc.project.id,
    name: doc.project.name,
    appName: doc.project.appName,
    packageName: doc.project.packageName,
    device: doc.manifest.device,
    designWidth: 466,
    updatedAt: doc.project.updatedAt,
    startPageId: doc.startPageId,
    nav: {
      kind: doc.navigation.kind,
      items: doc.navigation.items.map((i) => ({ id: i.id, label: i.label, pageId: i.pageId })),
    },
    variables: [],
    functions: [],
    timeBindings: [],
    templateId: (doc.project.templateId as Project["templateId"]) ?? "blank",
    pages,
    revisions,
    protocolExtras: extras,
  };
}

/** Project → 协议。原生模式直接取 protocolExtras 里的逻辑；旧模式走 v1 转换。 */
export function projectToDoc(project: EditorProject): ProjectDoc {
  if (!isNative(project)) return legacyProjectToDoc(project);
  const x = project.protocolExtras!;
  const visual: Project = {
    ...project,
    variables: [],
    functions: [],
    timeBindings: [],
    pages: project.pages.map((page) => ({
      ...page,
      nodes: page.nodes.map((node) => ({ ...node, actions: [] })),
    })),
  };
  const doc = v1EditorToV2(visual, [], { logic: false });
  if (x.templateId === null && project.templateId === "blank") delete doc.project.templateId;
  doc.project.createdAt = x.createdAt || doc.project.createdAt;
  doc.project.revision = x.revision || 0;
  doc.manifest = { ...x.manifest, device: doc.manifest.device };
  for (const page of doc.pages) {
    if (x.pageTitles[page.id]) page.title = x.pageTitles[page.id];
    for (const c of page.components) {
      const meta = x.componentMeta[c.id];
      if (meta) {
        c.version = meta.version;
        if (meta.rotation) c.layout.rotation = meta.rotation;
      }
    }
  }
  const pageIds = new Set(doc.pages.map((p) => p.id));
  const compIds = new Set(doc.pages.flatMap((p) => p.components.map((c) => c.id)));
  // 删掉的组件/页面：挂在它们身上的事件、绑定、局部变量一起去掉；动作里的悬空引用留给校验器报错。
  doc.variables = x.variables.filter(
    (v) =>
      v.scope === "global" || (v.ownerId && (pageIds.has(v.ownerId) || compIds.has(v.ownerId))),
  );
  doc.events = x.events.filter((e) =>
    e.trigger.kind === "component"
      ? compIds.has(e.trigger.componentId)
      : e.trigger.kind === "page"
        ? pageIds.has(e.trigger.pageId)
        : true,
  );
  doc.functions = x.functions;
  doc.timers = x.timers;
  doc.bindings = x.bindings.filter((b) => compIds.has(b.componentId));
  doc.assets = x.assets;
  doc.dependencies = computeDependencies(doc);
  return doc;
}

/** 旧模式工程转成原生模式（打开、导入、同步时调用；已经是原生的原样返回）。 */
export function toNative<T extends EditorProject>(project: T): EditorProject {
  if (isNative(project)) return project;
  const next = docToProject(projectToDoc(project), project.revisions);
  next.updatedAt = project.updatedAt;
  return next;
}

/** 取出工程逻辑（原生模式）。 */
export function logicOf(project: EditorProject): LogicDoc {
  const doc = projectToDoc(project);
  return {
    variables: doc.variables,
    events: doc.events,
    functions: doc.functions,
    timers: doc.timers,
    bindings: doc.bindings,
  };
}
