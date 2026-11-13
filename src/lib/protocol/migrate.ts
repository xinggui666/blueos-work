/**
 * 版本迁移（规格 4.3）：任何旧版本工程都能迁移到当前协议，旧工程不会因升级打不开。
 *
 * 已知版本：
 *   v1-editor  网页工坊早期本地/云端存储的 Project（pages[].nodes[].actions）
 *   v1-dsl     生成器 DSL（schemaVersion "1.0"，pages[].components）
 *   v2         统一工程协议（format=blueos-workshop-project, schemaVersion=2）
 * 新版本时：在 STEPS 里追加 n → n+1 的纯函数，并保留旧步骤。
 */
import { dslToProject, type AppAction, type Dsl, type Project } from "../blueos/model.ts";
import {
  PROTOCOL_FORMAT,
  SCHEMA_VERSION,
  type ActionNode,
  type BindingDoc,
  type EventDoc,
  type ProjectDoc,
  type VarType,
} from "./schema.ts";
import { computeDependencies, validateDoc, type ProtocolIssue } from "./validate.ts";

export const TOOLKIT_TARGET = "blueos-toolkit@1.9.45-beta.44";

export type DetectedVersion = "v1-editor" | "v1-dsl" | 2 | "unknown" | "future";

export function detectVersion(input: unknown): DetectedVersion {
  if (!input || typeof input !== "object") return "unknown";
  const value = input as Record<string, unknown>;
  if (value.format === PROTOCOL_FORMAT) {
    const v = Number(value.schemaVersion);
    if (v === SCHEMA_VERSION) return 2;
    if (v > SCHEMA_VERSION) return "future";
    return "unknown";
  }
  if (value.schemaVersion === "1.0" && value.project && Array.isArray(value.pages)) return "v1-dsl";
  if (
    Array.isArray(value.pages) &&
    (value.pages as unknown[]).every(
      (p) => p && typeof p === "object" && Array.isArray((p as { nodes?: unknown }).nodes),
    )
  )
    return "v1-editor";
  return "unknown";
}

export type MigrationResult = {
  ok: boolean;
  doc: ProjectDoc | null;
  from: DetectedVersion;
  steps: string[];
  issues: ProtocolIssue[];
};

/** 迁移到当前版本并校验。迁移失败不会抛异常，返回 ok=false 和原因。 */
export function migrateToCurrent(input: unknown): MigrationResult {
  const from = detectVersion(input);
  const steps: string[] = [];
  const notes: ProtocolIssue[] = [];
  let doc: unknown = input;
  try {
    if (from === "future")
      return {
        ok: false,
        doc: null,
        from,
        steps,
        issues: [
          {
            path: "schemaVersion",
            level: "error",
            message: "这个工程来自更新版本的工坊，请先升级客户端",
          },
        ],
      };
    if (from === "unknown")
      return {
        ok: false,
        doc: null,
        from,
        steps,
        issues: [{ path: "", level: "error", message: "无法识别的工程格式" }],
      };
    if (from === "v1-dsl") {
      doc = dslToProject(input as Dsl);
      steps.push("v1-dsl → v1-editor");
    }
    if (from === "v1-dsl" || from === "v1-editor") {
      doc = v1EditorToV2(doc as Project, notes);
      steps.push("v1-editor → v2");
    }
  } catch (error) {
    return {
      ok: false,
      doc: null,
      from,
      steps,
      issues: [{ path: "", level: "error", message: `迁移失败：${(error as Error).message}` }],
    };
  }
  const checked = validateDoc(doc);
  return { ok: checked.ok, doc: checked.doc, from, steps, issues: [...notes, ...checked.issues] };
}

/* ---------------- v1 → v2 ---------------- */

const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{1,47}$/;
let seq = 0;
function freshId(prefix: string): string {
  const bytes = new Uint8Array(4);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  seq = (seq + 1) % 1_000_000;
  return (
    prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") + seq.toString(36)
  );
}

/** 把 "$name 你好" 这样的 v1 文本模板转成表达式。 */
export function templateToExpr(raw: string, knownKeys: Set<string>): string {
  const parts: string[] = [];
  let last = 0;
  const re = /\$([A-Za-z][A-Za-z0-9_]{0,20})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    if (!knownKeys.has(m[1])) continue;
    if (m.index > last) parts.push(JSON.stringify(raw.slice(last, m.index)));
    parts.push(`str(${m[1]})`);
    last = m.index + m[0].length;
  }
  if (last < raw.length) parts.push(JSON.stringify(raw.slice(last)));
  if (!parts.length) return '""';
  return parts.join(" + ");
}

export function literalFor(value: string, type: VarType): string {
  if (type === "int" || type === "float")
    return Number.isFinite(Number(value)) && value.trim() !== "" ? String(Number(value)) : "0";
  if (type === "bool") return value === "true" ? "true" : "false";
  return JSON.stringify(value);
}

function v1VarType(kind: string, value: string): VarType {
  if (kind === "boolean") return "bool";
  if (kind === "number") return /^-?\d+$/.test(value.trim() || "0") ? "int" : "float";
  return "string";
}

function v1Default(type: VarType, value: string): unknown {
  if (type === "bool") return value === "true";
  if (type === "int") return Number.parseInt(value || "0", 10) || 0;
  if (type === "float") return Number(value) || 0;
  return value;
}

const TRIGGER_V1: Record<string, Extract<EventDoc["trigger"], { kind: "component" }>["event"]> = {
  click: "click",
  longpress: "longPress",
  double: "doubleClick",
  swipe: "swipeLeft",
};

const TEXT_PROP: Record<string, string> = {
  text: "text",
  number: "text",
  time: "text",
  button: "value",
};

export function v1EditorToV2(p: Project, notes: ProtocolIssue[]): ProjectDoc {
  const ids = new Map<string, string>();
  const fix = (id: unknown, prefix: string): string => {
    const raw = typeof id === "string" ? id : "";
    if (ID_RE.test(raw)) return raw;
    const known = ids.get(raw);
    if (known) return known;
    const next = freshId(prefix);
    if (raw) ids.set(raw, next);
    return next;
  };
  const pages = (p.pages ?? []).map((page) => ({
    id: fix(page.id, "p"),
    name: String(page.name || "Page").slice(0, 24),
    background: /^#[0-9A-Fa-f]{6}$/.test(page.background)
      ? page.background.toUpperCase()
      : "#000000",
    components: (page.nodes ?? []).map((node) => ({
      id: fix(node.id, "n"),
      type: node.type,
      version: "1.0.0",
      name: String(node.name ?? "").slice(0, 40),
      layout: {
        x: Number(node.x) || 0,
        y: Number(node.y) || 0,
        w: Math.max(1, Number(node.w) || 1),
        h: Math.max(1, Number(node.h) || 1),
      },
      locked: Boolean(node.locked),
      hidden: Boolean(node.hidden),
      props: { ...(node.props ?? {}) },
    })),
  }));
  const pageByName = new Map(pages.map((page) => [page.name, page.id]));
  (p.pages ?? []).forEach((page, i) => pageByName.set(page.name, pages[i].id));
  const compType = new Map<string, string>();
  pages.forEach((page) => page.components.forEach((c) => compType.set(c.id, c.type)));

  const variables = (p.variables ?? []).map((v) => {
    const type = v1VarType(v.kind, String(v.value ?? ""));
    const scope = v.scope === "page" && v.pageId ? ("page" as const) : ("global" as const);
    return {
      id: fix(v.id, "v"),
      key: v.key,
      type,
      default: v1Default(type, String(v.value ?? "")) as never,
      scope,
      ...(scope === "page" ? { ownerId: fix(v.pageId, "p") } : {}),
      persist: false,
    };
  });
  const varByKey = new Map(variables.map((v) => [v.key, v]));
  const keys = new Set(variables.map((v) => v.key));
  const fnByName = new Map((p.functions ?? []).map((f) => [f.name, fix(f.id, "f")]));

  const convert = (a: AppAction, where: string): ActionNode | null => {
    const id = fix(a.id, "a");
    let node: ActionNode | null = null;
    switch (a.kind) {
      case "navigate": {
        const pageId = pageByName.get(a.pageName);
        if (pageId) node = { id, kind: "navigate", pageId };
        else
          notes.push({
            path: where,
            level: "warn",
            message: `跳转目标页面 "${a.pageName}" 不存在，已移除该动作`,
          });
        break;
      }
      case "back":
        node = { id, kind: "back" };
        break;
      case "toast":
        node = { id, kind: "toast", text: templateToExpr(a.text || "提示", keys) };
        break;
      case "show":
      case "hide":
        if (a.nodeId) node = { id, kind: a.kind, componentId: fix(a.nodeId, "n") };
        break;
      case "setText": {
        const target = fix(a.nodeId, "n");
        const prop = TEXT_PROP[compType.get(target) ?? ""];
        if (prop)
          node = {
            id,
            kind: "setProp",
            componentId: target,
            prop,
            value: templateToExpr(a.text, keys),
          };
        else
          notes.push({
            path: where,
            level: "warn",
            message: "改文字的目标组件不支持文字，已移除该动作",
          });
        break;
      }
      case "setVar": {
        const v = varByKey.get(a.varKey);
        if (v)
          node = { id, kind: "setVar", variableId: v.id, value: literalFor(a.varValue, v.type) };
        else
          notes.push({
            path: where,
            level: "warn",
            message: `变量 "${a.varKey}" 不存在，已移除该动作`,
          });
        break;
      }
      case "call": {
        const fid = fnByName.get(a.varKey);
        if (fid) node = { id, kind: "call", functionId: fid, args: {} };
        else
          notes.push({
            path: where,
            level: "warn",
            message: `函数 "${a.varKey}" 不存在，已移除该动作`,
          });
        break;
      }
    }
    if (node && a.whenKey) {
      const v = varByKey.get(a.whenKey);
      if (v)
        return {
          id: fix(`${a.id}_if`, "c"),
          kind: "if",
          condition: `${v.key} == ${literalFor(a.whenValue, v.type)}`,
          then: [node],
          else: [],
        };
    }
    return node;
  };

  const events: EventDoc[] = [];
  pages.forEach((page, pi) => {
    page.components.forEach((comp, ci) => {
      const node = p.pages[pi].nodes[ci];
      const groups = new Map<string, ActionNode[]>();
      (node.actions ?? []).forEach((a, ai) => {
        const event = TRIGGER_V1[a.trigger] ?? "click";
        const converted = convert(a, `pages.${pi}.nodes.${ci}.actions.${ai}`);
        if (!converted) return;
        groups.set(event, [...(groups.get(event) ?? []), converted]);
      });
      for (const [event, actions] of groups) {
        events.push({
          id: `e-${comp.id}-${event}`.slice(0, 48),
          enabled: true,
          trigger: {
            kind: "component",
            componentId: comp.id,
            event: event as Extract<EventDoc["trigger"], { kind: "component" }>["event"],
          },
          actions,
        });
      }
    });
  });

  const functions = (p.functions ?? []).map((f, fi) => ({
    id: fnByName.get(f.name) ?? fix(f.id, "f"),
    name: f.name,
    params: [],
    returnType: "void" as const,
    locals: [],
    body: (f.steps ?? [])
      .map((a, ai) => convert(a, `functions.${fi}.steps.${ai}`))
      .filter((a): a is ActionNode => !!a),
    version: 1,
  }));

  const bindings: BindingDoc[] = [];
  const FORMAT: Record<string, { format: string; refresh: "minute" | "second" }> = {
    time: { format: "HH:mm", refresh: "minute" },
    timeSeconds: { format: "HH:mm:ss", refresh: "second" },
    date: { format: "YYYY-MM-DD", refresh: "minute" },
    weekday: { format: "W", refresh: "minute" },
  };
  for (const tb of p.timeBindings ?? []) {
    const componentId = fix(tb.nodeId, "n");
    const prop = TEXT_PROP[compType.get(componentId) ?? ""];
    if (!prop) continue;
    const f = FORMAT[tb.format] ?? FORMAT.time;
    bindings.push({
      id: fix(tb.id, "b"),
      componentId,
      prop,
      source: { kind: "time", field: "now" },
      format: f.format,
      refresh: f.refresh,
    });
  }
  // v1 文本里的 $变量 在预览时会被替换，迁移成表达式绑定，保持行为一致。
  for (const page of pages) {
    for (const comp of page.components) {
      const prop = TEXT_PROP[comp.type];
      const raw = prop ? comp.props[prop] : undefined;
      if (typeof raw !== "string" || !/\$[A-Za-z]/.test(raw)) continue;
      if (bindings.some((b) => b.componentId === comp.id && b.prop === prop)) continue;
      const expr = templateToExpr(raw, keys);
      if (expr === JSON.stringify(raw)) continue;
      bindings.push({
        id: `b-${comp.id}-${prop}`.slice(0, 48),
        componentId: comp.id,
        prop,
        source: { kind: "expr", expr },
        refresh: "change",
      });
    }
  }

  const start = p.startPageId ? fix(p.startPageId, "p") : pages[0]?.id;
  const updatedAt = Number(p.updatedAt) || Date.now();
  const doc: ProjectDoc = {
    format: PROTOCOL_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    project: {
      id: fix(p.id, "j"),
      name: String(p.name || "未命名工程").slice(0, 40),
      appName: String(p.appName || "新应用").slice(0, 40),
      packageName: String(p.packageName || "com.example.app"),
      createdAt: updatedAt,
      updatedAt,
      revision: 0,
      ...(p.templateId ? { templateId: p.templateId } : {}),
    },
    manifest: {
      device: p.device === "watch-square" ? "watch-square" : "watch-round",
      designWidth: 466,
      canvas: { width: 466, height: 466 },
      versionName: "1.0",
      versionCode: 1,
      sdk: { toolkit: TOOLKIT_TARGET, verified: false },
    },
    startPageId: pages.some((page) => page.id === start) ? start : pages[0]?.id,
    navigation: {
      kind: p.nav?.kind ?? "none",
      items: (p.nav?.items ?? []).map((item) => ({
        id: fix(item.id, "i"),
        label: String(item.label ?? "").slice(0, 12),
        pageId: fix(item.pageId, "p"),
      })),
    },
    pages,
    variables: variables as ProjectDoc["variables"],
    events,
    functions,
    timers: [],
    bindings,
    assets: [],
    dependencies: [],
  } as ProjectDoc;
  doc.dependencies = computeDependencies(doc);
  return doc;
}
