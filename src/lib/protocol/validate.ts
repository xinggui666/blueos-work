import { PROJECT_ASSET_MAX_BYTES } from "./assets.ts";
/**
 * 工程协议校验器：结构（zod）+ 语义（引用、类型、表达式、循环依赖、依赖清单）。
 * 网页、服务端、导入 .bproj、构建前都调用同一个函数。
 */
import { CATALOG_MAP } from "../blueos/model.ts";
import { assignable, checkExpr, type ValueType } from "./expr.ts";
import {
  BINDABLE_PROPS,
  PROTOCOL_LIMITS,
  ProjectDocSchema,
  VISIBLE_PROP,
  type ActionNode,
  type ComponentInstance,
  type DependencyDoc,
  type FunctionDoc,
  type ProjectDoc,
  type Trigger,
  type VarType,
} from "./schema.ts";

export type ProtocolIssue = { path: string; message: string; level: "error" | "warn" };
export type ValidationResult = { ok: boolean; doc: ProjectDoc | null; issues: ProtocolIssue[] };

export const PACKAGE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,5}$/;
export const PAGE_NAME_RE = /^[A-Za-z][A-Za-z0-9]{0,23}$/;

/** 需要真机验证才能承诺的组件事件（规格 7.2 / 11.3）。 */
const UNVERIFIED_COMPONENT_EVENTS = new Set([
  "longPress",
  "doubleClick",
  "swipeStart",
  "swiping",
  "swipeLeft",
  "swipeRight",
  "swipeUp",
  "swipeDown",
  "touchStart",
  "touchEnd",
]);

export function validateDoc(input: unknown): ValidationResult {
  const parsed = ProjectDocSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      doc: null,
      issues: parsed.error.issues
        .slice(0, 50)
        .map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
          level: "error" as const,
        })),
    };
  }
  const doc = parsed.data;
  const issues = semanticIssues(doc);
  return { ok: !issues.some((issue) => issue.level === "error"), doc, issues };
}

export function semanticIssues(doc: ProjectDoc): ProtocolIssue[] {
  const issues: ProtocolIssue[] = [];
  const err = (path: string, message: string) => issues.push({ path, message, level: "error" });
  const warn = (path: string, message: string) => issues.push({ path, message, level: "warn" });

  // ---- 唯一 ID ----
  const seen = new Map<string, string>();
  const claim = (id: string, path: string) => {
    const prev = seen.get(id);
    if (prev) err(path, `ID "${id}" 与 ${prev} 重复`);
    else seen.set(id, path);
  };

  const pages = new Map(doc.pages.map((page) => [page.id, page]));
  const components = new Map<string, { comp: ComponentInstance; pageId: string }>();
  const pageNames = new Set<string>();
  if (!PACKAGE_RE.test(doc.project.packageName))
    err("project.packageName", "包名格式如 com.example.app（小写字母、数字、下划线，用点分隔）");
  doc.pages.forEach((page, pi) => {
    claim(page.id, `pages.${pi}`);
    if (!PAGE_NAME_RE.test(page.name))
      err(`pages.${pi}.name`, "页面名只能用英文字母和数字，字母开头（会成为 RPK 的页面目录名）");
    if (pageNames.has(page.name)) err(`pages.${pi}.name`, `页面名 "${page.name}" 重复`);
    pageNames.add(page.name);
    page.components.forEach((comp, ci) => {
      const path = `pages.${pi}.components.${ci}`;
      claim(comp.id, path);
      components.set(comp.id, { comp, pageId: page.id });
      checkProps(comp, path, err, warn);
    });
  });
  if (!pages.has(doc.startPageId)) err("startPageId", "启动页不存在");
  doc.navigation.items.forEach((item, i) => {
    claim(item.id, `navigation.items.${i}`);
    if (!pages.has(item.pageId)) err(`navigation.items.${i}.pageId`, "导航指向的页面不存在");
  });

  // ---- 变量 ----
  const variables = new Map(doc.variables.map((v) => [v.id, v]));
  const globalKeys = new Set<string>();
  const scopedKeys = new Set<string>();
  doc.variables.forEach((v, i) => {
    const path = `variables.${i}`;
    claim(v.id, path);
    if (v.key.startsWith("_")) err(`${path}.key`, "下划线开头的变量名是系统保留的");
    if (v.scope === "global") {
      if (globalKeys.has(v.key)) err(`${path}.key`, `全局变量 "${v.key}" 重名`);
      globalKeys.add(v.key);
    } else {
      if (!v.ownerId)
        err(
          `${path}.ownerId`,
          v.scope === "page" ? "页面变量需要指定页面" : "组件变量需要指定组件",
        );
      else if (v.scope === "page" && !pages.has(v.ownerId))
        err(`${path}.ownerId`, "变量所属页面不存在");
      else if (v.scope === "component" && !components.has(v.ownerId))
        err(`${path}.ownerId`, "变量所属组件不存在");
      const k = `${v.ownerId}:${v.key}`;
      if (scopedKeys.has(k)) err(`${path}.key`, `变量 "${v.key}" 在同一作用域重名`);
      scopedKeys.add(k);
    }
    if (!defaultMatches(v.default, v.type)) err(`${path}.default`, `默认值不是 ${v.type} 类型`);
  });
  doc.variables.forEach((v, i) => {
    if (v.scope !== "global" && globalKeys.has(v.key))
      warn(`variables.${i}.key`, `"${v.key}" 遮蔽了同名全局变量`);
  });

  const pageOfOwner = (ownerId: string | undefined) =>
    ownerId ? (pages.has(ownerId) ? ownerId : components.get(ownerId)?.pageId) : undefined;
  const typesFor = (
    pageId?: string,
    extra: Record<string, ValueType> = {},
  ): Record<string, ValueType> => {
    const types: Record<string, ValueType> = {};
    for (const v of doc.variables) if (v.scope === "global") types[v.key] = v.type;
    if (pageId)
      for (const v of doc.variables)
        if (v.scope !== "global" && pageOfOwner(v.ownerId) === pageId) types[v.key] = v.type;
    return { ...types, ...extra };
  };
  const varVisible = (variableId: string, pageId?: string) => {
    const v = variables.get(variableId);
    if (!v) return false;
    return v.scope === "global" || !pageId || pageOfOwner(v.ownerId) === pageId;
  };

  // ---- 计时器 ----
  const timers = new Map(doc.timers.map((t) => [t.id, t]));
  doc.timers.forEach((t, i) => claim(t.id, `timers.${i}`));

  // ---- 函数 ----
  const functions = new Map(doc.functions.map((f) => [f.id, f]));
  const fnNames = new Set<string>();
  doc.functions.forEach((f, i) => {
    claim(f.id, `functions.${i}`);
    if (fnNames.has(f.name)) err(`functions.${i}.name`, `函数名 "${f.name}" 重复`);
    fnNames.add(f.name);
    const names = new Set<string>();
    [...f.params.map((p) => p.name), ...f.locals.map((l) => l.name)].forEach((name) => {
      if (names.has(name)) err(`functions.${i}`, `参数/局部变量 "${name}" 重复`);
      names.add(name);
    });
    f.params.forEach((p, pi) => {
      if (p.default !== undefined)
        checkTyped(p.default, typesFor(), p.type, `functions.${i}.params.${pi}.default`);
    });
  });

  // ---- 动作（递归） ----
  type Ctx = {
    pageId?: string;
    fn?: FunctionDoc;
    locals: Record<string, ValueType>;
    types: Record<string, ValueType>;
  };
  function checkTyped(
    src: string,
    types: Record<string, ValueType>,
    want: ValueType | null,
    path: string,
  ): ValueType | null {
    const res = checkExpr(src, { types });
    if (!res.ok) {
      err(path, `表达式错误：${res.error}`);
      return null;
    }
    if (want && !assignable(res.type, want))
      err(path, `表达式结果是 ${res.type}，这里需要 ${want}`);
    return res.type;
  }
  const calls = new Map<string, Set<string>>();
  function checkActions(list: ActionNode[], path: string, ctx: Ctx, depth: number) {
    if (depth > PROTOCOL_LIMITS.actionDepth) {
      err(path, `动作嵌套超过 ${PROTOCOL_LIMITS.actionDepth} 层`);
      return;
    }
    list.forEach((a, i) => {
      const p = `${path}.${i}`;
      claim(a.id, p);
      const types = { ...ctx.types, ...ctx.locals };
      switch (a.kind) {
        case "navigate":
          if (!pages.has(a.pageId)) err(`${p}.pageId`, "跳转的页面不存在");
          break;
        case "toast":
        case "log":
          checkTyped(a.text, types, "string", `${p}.text`);
          break;
        case "show":
        case "hide":
        case "toggle":
          if (!components.has(a.componentId)) err(`${p}.componentId`, "目标组件不存在");
          break;
        case "setProp": {
          const target = components.get(a.componentId);
          if (!target) {
            err(`${p}.componentId`, "目标组件不存在");
            break;
          }
          const want = propType(target.comp.type, a.prop);
          if (!want) err(`${p}.prop`, `组件 ${target.comp.type} 不允许修改属性 "${a.prop}"`);
          checkTyped(a.value, types, want, `${p}.value`);
          break;
        }
        case "setVar": {
          const v = variables.get(a.variableId);
          if (!v) err(`${p}.variableId`, "变量不存在");
          else if (!varVisible(a.variableId, ctx.pageId))
            err(`${p}.variableId`, "这个页面看不到该变量");
          checkTyped(a.value, types, v?.type ?? null, `${p}.value`);
          break;
        }
        case "setLocal":
          if (!Object.hasOwn(ctx.locals, a.name))
            err(`${p}.name`, `"${a.name}" 不是函数参数或局部变量`);
          checkTyped(
            a.value,
            types,
            Object.hasOwn(ctx.locals, a.name) ? ctx.locals[a.name] : null,
            `${p}.value`,
          );
          break;
        case "call": {
          const f = functions.get(a.functionId);
          if (!f) {
            err(`${p}.functionId`, "函数不存在");
            break;
          }
          if (ctx.fn) calls.get(ctx.fn.id)?.add(f.id);
          for (const name of Object.keys(a.args))
            if (!f.params.some((x) => x.name === name))
              err(`${p}.args.${name}`, `函数 ${f.name} 没有参数 "${name}"`);
          for (const param of f.params) {
            const src = a.args[param.name];
            if (src === undefined) {
              if (param.default === undefined) err(`${p}.args`, `缺少参数 "${param.name}"`);
            } else checkTyped(src, types, param.type, `${p}.args.${param.name}`);
          }
          if (a.resultVariableId || a.resultLocal) {
            if (f.returnType === "void") err(p, `函数 ${f.name} 没有返回值`);
            if (a.resultVariableId) {
              const v = variables.get(a.resultVariableId);
              if (!v) err(`${p}.resultVariableId`, "接收结果的变量不存在");
              else if (f.returnType !== "void" && !assignable(f.returnType, v.type))
                err(`${p}.resultVariableId`, `返回值 ${f.returnType} 不能赋给 ${v.type}`);
            }
            if (a.resultLocal && !Object.hasOwn(ctx.locals, a.resultLocal))
              err(`${p}.resultLocal`, `"${a.resultLocal}" 不是局部变量`);
          }
          break;
        }
        case "if":
          checkTyped(a.condition, types, null, `${p}.condition`);
          checkActions(a.then, `${p}.then`, ctx, depth + 1);
          checkActions(a.else, `${p}.else`, ctx, depth + 1);
          break;
        case "repeat": {
          checkTyped(a.times, types, "int", `${p}.times`);
          const literal = Number(a.times);
          if (Number.isFinite(literal) && literal > PROTOCOL_LIMITS.repeatMax)
            err(`${p}.times`, `循环次数不能超过 ${PROTOCOL_LIMITS.repeatMax}`);
          checkActions(a.body, `${p}.body`, ctx, depth + 1);
          break;
        }
        case "forEach":
          checkTyped(a.list, types, "array", `${p}.list`);
          checkActions(
            a.body,
            `${p}.body`,
            { ...ctx, locals: { ...ctx.locals, [a.item]: "any" } },
            depth + 1,
          );
          break;
        case "return":
          if (!ctx.fn) err(p, "只有函数里可以使用返回");
          else if (ctx.fn.returnType === "void") {
            if (a.value) err(`${p}.value`, "函数声明为无返回值");
          } else if (!a.value) err(`${p}.value`, `函数需要返回 ${ctx.fn.returnType}`);
          else checkTyped(a.value, types, ctx.fn.returnType, `${p}.value`);
          break;
        case "startTimer":
        case "stopTimer":
        case "resetTimer":
          if (!timers.has(a.timerId)) err(`${p}.timerId`, "计时器不存在");
          break;
        case "back":
          break;
      }
    });
  }

  doc.functions.forEach((f, i) => {
    calls.set(f.id, new Set());
    const locals: Record<string, ValueType> = {};
    for (const x of f.params) locals[x.name] = x.type;
    for (const x of f.locals) locals[x.name] = x.type;
    checkActions(f.body, `functions.${i}.body`, { fn: f, locals, types: typesFor() }, 1);
    if (f.returnType !== "void" && !containsReturn(f.body))
      warn(`functions.${i}`, `函数 ${f.name} 声明了返回值但没有"返回"动作`);
  });

  // 函数调用环（递归）在静态阶段直接拒绝（规格第十章：检查循环依赖）。
  const cycle = findCycle(calls);
  if (cycle)
    err(
      "functions",
      `函数之间存在循环调用：${cycle.map((id) => functions.get(id)?.name ?? id).join(" → ")}`,
    );

  // ---- 事件 ----
  doc.events.forEach((ev, i) => {
    const path = `events.${i}`;
    claim(ev.id, path);
    const pageId = triggerPage(ev.trigger, components);
    checkTrigger(ev.trigger, `${path}.trigger`);
    const extra: Record<string, ValueType> = {};
    if (
      (ev.trigger.kind === "component" && ev.trigger.event === "change") ||
      ev.trigger.kind === "variable"
    )
      extra._value = "any";
    const types = typesFor(pageId, extra);
    if (ev.condition) checkTyped(ev.condition, types, null, `${path}.condition`);
    checkActions(ev.actions, `${path}.actions`, { pageId, locals: {}, types }, 1);
    if (
      ev.trigger.kind === "variable" &&
      writesVariable(ev.actions, ev.trigger.variableId, functions)
    ) {
      warn(path, "这个事件在变量变化时又修改同一个变量，可能形成循环（运行时会限制连锁次数）");
    }
    if (ev.trigger.kind === "time" && ev.trigger.event === "everySecond" && !ev.trigger.pageId) {
      warn(`${path}.trigger`, "每秒触发会耗电，建议限定在某个页面可见时运行");
    }
  });

  function checkTrigger(t: Trigger, path: string) {
    if (t.kind === "component") {
      if (!components.has(t.componentId)) err(`${path}.componentId`, "触发组件不存在");
      if (UNVERIFIED_COMPONENT_EVENTS.has(t.event))
        warn(`${path}.event`, `"${t.event}" 事件需要在目标手表上真机验证后才能承诺可用`);
    } else if (t.kind === "page") {
      if (!pages.has(t.pageId)) err(`${path}.pageId`, "触发页面不存在");
    } else if (t.kind === "time") {
      if (t.event === "at" && !t.at) err(`${path}.at`, "指定时刻触发需要填写 HH:mm");
      if (t.event === "timerEnd" && (!t.timerId || !timers.has(t.timerId)))
        err(`${path}.timerId`, "计时器不存在");
      if (t.pageId && !pages.has(t.pageId)) err(`${path}.pageId`, "限定页面不存在");
    } else if (t.kind === "variable") {
      const v = variables.get(t.variableId);
      if (!v) err(`${path}.variableId`, "变量不存在");
      if ((t.event === "equals" || t.event === "condition") && !t.value)
        err(`${path}.value`, t.event === "equals" ? "需要填写目标值" : "需要填写条件表达式");
      if (t.value)
        checkTyped(
          t.value,
          typesFor(undefined, { _value: v?.type ?? "any" }),
          null,
          `${path}.value`,
        );
      if (
        (t.event === "enterRange" || t.event === "leaveRange") &&
        (t.min === undefined || t.max === undefined || t.min > t.max)
      )
        err(path, "范围需要有效的最小值和最大值");
    }
  }

  // ---- 绑定 ----
  const bound = new Set<string>();
  doc.bindings.forEach((b, i) => {
    const path = `bindings.${i}`;
    claim(b.id, path);
    const target = components.get(b.componentId);
    if (!target) {
      err(`${path}.componentId`, "绑定的组件不存在");
      return;
    }
    const key = `${b.componentId}.${b.prop}`;
    if (bound.has(key)) err(path, `属性 ${key} 已经有绑定`);
    bound.add(key);
    const want = propType(target.comp.type, b.prop);
    if (!want) {
      err(`${path}.prop`, `组件 ${target.comp.type} 的 "${b.prop}" 不能绑定`);
      return;
    }
    let have: ValueType | null = null;
    if (b.source.kind === "variable") {
      const v = variables.get(b.source.variableId);
      if (!v) err(`${path}.source.variableId`, "绑定的变量不存在");
      else if (!varVisible(v.id, target.pageId))
        err(`${path}.source.variableId`, "组件所在页面看不到该变量");
      else have = v.type;
    } else if (b.source.kind === "time") {
      const f = b.source.field;
      if (f.startsWith("timer")) {
        if (!b.source.timerId || !timers.has(b.source.timerId))
          err(`${path}.source.timerId`, "计时器不存在");
      }
      have = b.format ? "string" : f === "now" || f === "timestamp" ? "datetime" : "int";
    } else {
      have = checkTyped(b.source.expr, typesFor(target.pageId), null, `${path}.source.expr`);
    }
    if (have && !assignable(have, want))
      err(path, `绑定类型不匹配：${have} 不能绑定到 ${want} 属性 ${b.prop}`);
    if (b.format && b.source.kind !== "time") warn(`${path}.format`, "格式只对时间数据源生效");
    if (b.refresh === "second")
      warn(`${path}.refresh`, "每秒刷新会耗电，手表息屏和后台时不保证运行");
  });

  // ---- 资源 ----
  if (doc.assets.reduce((n, a) => n + a.bytes, 0) > PROJECT_ASSET_MAX_BYTES)
    err("assets", "工程资源总量超过 6MiB，无法保证工程包可恢复");
  const assetPaths = new Set<string>();
  doc.assets.forEach((a, i) => {
    claim(a.id, `assets.${i}`);
    if (assetPaths.has(a.path)) err(`assets.${i}.path`, "资源路径重复");
    assetPaths.add(a.path);
  });

  for (const [pi, page] of doc.pages.entries())
    for (const [ci, component] of page.components.entries()) {
      if (component.type !== "image") continue;
      const src = String(component.props.src ?? "/assets/images/logo.png");
      if (
        src &&
        src !== "/assets/images/logo.png" &&
        !assetPaths.has(src.startsWith("/") ? src.slice(1) : "")
      )
        err(
          `pages.${pi}.components.${ci}.props.src`,
          "图片必须引用已声明的 /assets/ 本地资源；不支持网络 URL 或任意文件路径",
        );
    }
  // ---- 依赖 ----
  const expected = computeDependencies(doc);
  const declared = new Map(doc.dependencies.map((d) => [`${d.type}@${d.componentId}`, d.version]));
  for (const dep of expected) {
    const have = declared.get(`${dep.type}@${dep.componentId}`);
    if (!have) err("dependencies", `缺少组件依赖 ${dep.type}（${dep.componentId}）`);
    else if (have !== dep.version)
      err("dependencies", `组件 ${dep.type} 依赖版本 ${have} 与实例版本 ${dep.version} 不一致`);
  }
  return issues;
}

function checkProps(
  comp: ComponentInstance,
  path: string,
  err: (p: string, m: string) => void,
  warn: (p: string, m: string) => void,
) {
  const item = CATALOG_MAP[comp.type];
  if (!item) {
    err(`${path}.type`, `未知组件类型 ${comp.type}`);
    return;
  }
  for (const [key, value] of Object.entries(comp.props)) {
    const field = item.fields.find((f) => f.key === key);
    if (!field) {
      warn(`${path}.props.${key}`, `组件 ${comp.type} 没有属性 "${key}"，生成时会忽略`);
      continue;
    }
    const p = `${path}.props.${key}`;
    if (
      field.kind === "number" &&
      (typeof value !== "number" || value < field.min || value > field.max)
    )
      err(p, `${field.label}需要 ${field.min}-${field.max} 的数字`);
    if (field.kind === "color" && (typeof value !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(value)))
      err(p, `${field.label}需要 #RRGGBB`);
    if (field.kind === "bool" && typeof value !== "boolean") err(p, `${field.label}需要布尔值`);
    if (field.kind === "select" && !field.options.some((o) => o.value === value))
      err(p, `${field.label}取值无效`);
    if (field.kind === "text") {
      if (typeof value !== "string") err(p, `${field.label}需要文本`);
      else if (/[<>{}]/.test(value)) err(p, `${field.label}不能包含 < > { }`);
    }
  }
}

export function propType(type: ComponentInstance["type"], prop: string): VarType | null {
  if (prop === VISIBLE_PROP) return "bool";
  return BINDABLE_PROPS[type]?.[prop] ?? null;
}

function defaultMatches(value: unknown, type: VarType): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "int":
      return typeof value === "number" && Number.isInteger(value);
    case "float":
    case "datetime":
      return typeof value === "number" && Number.isFinite(value);
    case "bool":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return !!value && typeof value === "object" && !Array.isArray(value);
  }
}

function triggerPage(t: Trigger, components: Map<string, { pageId: string }>): string | undefined {
  if (t.kind === "component") return components.get(t.componentId)?.pageId;
  if (t.kind === "page") return t.pageId;
  if (t.kind === "time") return t.pageId;
  return undefined;
}

function containsReturn(list: ActionNode[]): boolean {
  return list.some(
    (a) =>
      a.kind === "return" ||
      (a.kind === "if" && (containsReturn(a.then) || containsReturn(a.else))) ||
      ((a.kind === "repeat" || a.kind === "forEach") && containsReturn(a.body)),
  );
}

export function walkActions(list: ActionNode[], visit: (a: ActionNode) => void) {
  for (const a of list) {
    visit(a);
    if (a.kind === "if") {
      walkActions(a.then, visit);
      walkActions(a.else, visit);
    } else if (a.kind === "repeat" || a.kind === "forEach") walkActions(a.body, visit);
  }
}

function writesVariable(
  list: ActionNode[],
  variableId: string,
  functions: Map<string, FunctionDoc>,
  seen = new Set<string>(),
): boolean {
  let hit = false;
  walkActions(list, (a) => {
    if (a.kind === "setVar" && a.variableId === variableId) hit = true;
    if (a.kind === "call" && a.resultVariableId === variableId) hit = true;
    if (a.kind === "call" && !seen.has(a.functionId)) {
      seen.add(a.functionId);
      const f = functions.get(a.functionId);
      if (f && writesVariable(f.body, variableId, functions, seen)) hit = true;
    }
  });
  return hit;
}

export function findCycle(graph: Map<string, Set<string>>): string[] | null {
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    state.set(id, 1);
    stack.push(id);
    for (const next of graph.get(id) ?? []) {
      if (state.get(next) === 1) return [...stack.slice(stack.indexOf(next)), next];
      if (!state.has(next)) {
        const found = visit(next);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const id of graph.keys()) {
    if (!state.has(id)) {
      const found = visit(id);
      if (found) return found;
    }
  }
  return null;
}

/** 根据组件实例算出依赖清单（内置组件 componentId=builtin）。 */
export function computeDependencies(doc: Pick<ProjectDoc, "pages">): DependencyDoc[] {
  const map = new Map<string, DependencyDoc>();
  for (const page of doc.pages) {
    for (const comp of page.components) {
      const key = `${comp.type}@builtin`;
      if (!map.has(key))
        map.set(key, { type: comp.type, componentId: "builtin", version: comp.version });
    }
  }
  return [...map.values()].sort((a, b) => a.type.localeCompare(b.type));
}
