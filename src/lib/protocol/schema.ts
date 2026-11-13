/**
 * 蓝河工坊统一工程协议 v2（规格第四章 4.1/4.2）。
 * 网页、Android、桌面端、预览器、生成器和 .bproj 都使用这一份结构。
 * 结构校验用 zod；语义校验（引用、表达式、循环依赖）见 validate.ts。
 * JSON Schema 由 scripts/gen-protocol-schema.ts 生成到 docs/protocol/project.schema.json。
 */
import { z } from "zod";

export const PROTOCOL_FORMAT = "blueos-workshop-project" as const;
export const SCHEMA_VERSION = 2 as const;
export { PROTOCOL_LIMITS, VISIBLE_PROP } from "./limits.ts";
import { PROTOCOL_LIMITS } from "./limits.ts";

const Id = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{1,47}$/, "ID 需要 2-48 位字母数字，字母开头");
const Name = z.string().trim().min(1).max(40);
const VarKey = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,31}$/, "变量名只能用字母、数字和下划线，不能以数字开头");
const ExprSrc = z.string().max(500);
const Color = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const Scalar = z.union([z.string().max(2000), z.number(), z.boolean()]);

export const ValueTypeSchema = z.enum([
  "string",
  "int",
  "float",
  "bool",
  "array",
  "object",
  "datetime",
]);
const JsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string().max(2000),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValue).max(500),
    z.record(z.string(), JsonValue),
  ]),
);

export const DEVICE_SHAPES = ["watch-round", "watch-square"] as const;
export const COMPONENT_TYPES = [
  "text",
  "image",
  "button",
  "column",
  "row",
  "spacer",
  "divider",
  "rect",
  "circle",
  "progress",
  "switch",
  "number",
  "time",
  "hotspot",
] as const;

export const ComponentInstanceSchema = z.object({
  id: Id,
  type: z.enum(COMPONENT_TYPES),
  /** 组件版本固定在工程里，构建时按此版本生成（规格 6.4）。 */
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  name: z.string().max(40),
  layout: z.object({
    x: z.number(),
    y: z.number(),
    w: z.number().min(1).max(2000),
    h: z.number().min(1).max(2000),
    rotation: z.number().min(-360).max(360).optional(),
  }),
  locked: z.boolean(),
  hidden: z.boolean(),
  props: z.record(z.string().max(32), Scalar),
});

export const PageSchema = z.object({
  id: Id,
  /** 页面名会成为 RPK 路由目录名，格式在语义校验里检查。 */
  name: z.string().min(1).max(24),
  title: z.string().max(40).optional(),
  background: Color,
  /** 数组顺序就是图层顺序：越靠后越在上层。 */
  components: z.array(ComponentInstanceSchema).max(PROTOCOL_LIMITS.componentsPerPage),
});

export const VariableSchema = z.object({
  id: Id,
  key: VarKey,
  type: ValueTypeSchema,
  default: JsonValue,
  scope: z.enum(["global", "page", "component"]),
  /** scope=page 时为页面 ID，scope=component 时为组件 ID。 */
  ownerId: z.string().max(48).optional(),
  persist: z.boolean(),
  description: z.string().max(80).optional(),
});

export const COMPONENT_EVENTS = [
  "click",
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
  "change",
] as const;
export const PAGE_EVENTS = ["load", "show", "hide", "exit"] as const;
export const TIME_EVENTS = [
  "everySecond",
  "everyMinute",
  "everyHour",
  "at",
  "dateChange",
  "weekChange",
  "timerEnd",
] as const;
export const VARIABLE_EVENTS = [
  "change",
  "equals",
  "condition",
  "enterRange",
  "leaveRange",
] as const;
export const SYSTEM_EVENTS = ["appStart", "appResume", "appBackground"] as const;

export const TriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("component"), componentId: Id, event: z.enum(COMPONENT_EVENTS) }),
  z.object({ kind: z.literal("page"), pageId: Id, event: z.enum(PAGE_EVENTS) }),
  z.object({
    kind: z.literal("time"),
    event: z.enum(TIME_EVENTS),
    /** event=at 时的 HH:mm。 */
    at: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    /** event=timerEnd 时的计时器 ID。 */
    timerId: z.string().max(48).optional(),
    /** 只在指定页面可见时运行，省电（规格 9.3）。 */
    pageId: z.string().max(48).optional(),
  }),
  z.object({
    kind: z.literal("variable"),
    variableId: Id,
    event: z.enum(VARIABLE_EVENTS),
    value: ExprSrc.optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  z.object({ kind: z.literal("system"), event: z.enum(SYSTEM_EVENTS) }),
]);

export type ActionNode =
  | { id: string; kind: "navigate"; pageId: string }
  | { id: string; kind: "back" }
  | { id: string; kind: "toast"; text: string }
  | { id: string; kind: "show" | "hide" | "toggle"; componentId: string }
  | { id: string; kind: "setProp"; componentId: string; prop: string; value: string }
  | { id: string; kind: "setVar"; variableId: string; value: string }
  | { id: string; kind: "setLocal"; name: string; value: string }
  | {
      id: string;
      kind: "call";
      functionId: string;
      args: Record<string, string>;
      resultVariableId?: string;
      resultLocal?: string;
    }
  | { id: string; kind: "if"; condition: string; then: ActionNode[]; else: ActionNode[] }
  | { id: string; kind: "repeat"; times: string; body: ActionNode[] }
  | { id: string; kind: "forEach"; list: string; item: string; body: ActionNode[] }
  | { id: string; kind: "return"; value?: string }
  | { id: string; kind: "startTimer" | "stopTimer" | "resetTimer"; timerId: string }
  | { id: string; kind: "log"; text: string };

export const ActionSchema: z.ZodType<ActionNode> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ id: Id, kind: z.literal("navigate"), pageId: Id }),
    z.object({ id: Id, kind: z.literal("back") }),
    z.object({ id: Id, kind: z.literal("toast"), text: ExprSrc }),
    z.object({ id: Id, kind: z.enum(["show", "hide", "toggle"]), componentId: Id }),
    z.object({
      id: Id,
      kind: z.literal("setProp"),
      componentId: Id,
      prop: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,31}$/),
      value: ExprSrc,
    }),
    z.object({ id: Id, kind: z.literal("setVar"), variableId: Id, value: ExprSrc }),
    z.object({ id: Id, kind: z.literal("setLocal"), name: VarKey, value: ExprSrc }),
    z.object({
      id: Id,
      kind: z.literal("call"),
      functionId: Id,
      args: z.record(VarKey, ExprSrc),
      resultVariableId: Id.optional(),
      resultLocal: VarKey.optional(),
    }),
    z.object({
      id: Id,
      kind: z.literal("if"),
      condition: ExprSrc,
      then: z.array(ActionSchema).max(PROTOCOL_LIMITS.actionsPerList),
      else: z.array(ActionSchema).max(PROTOCOL_LIMITS.actionsPerList),
    }),
    z.object({
      id: Id,
      kind: z.literal("repeat"),
      times: ExprSrc,
      body: z.array(ActionSchema).max(PROTOCOL_LIMITS.actionsPerList),
    }),
    z.object({
      id: Id,
      kind: z.literal("forEach"),
      list: ExprSrc,
      item: VarKey,
      body: z.array(ActionSchema).max(PROTOCOL_LIMITS.actionsPerList),
    }),
    z.object({ id: Id, kind: z.literal("return"), value: ExprSrc.optional() }),
    z.object({ id: Id, kind: z.enum(["startTimer", "stopTimer", "resetTimer"]), timerId: Id }),
    z.object({ id: Id, kind: z.literal("log"), text: ExprSrc }),
  ]),
) as z.ZodType<ActionNode>;

export const EventSchema = z.object({
  id: Id,
  name: z.string().max(40).optional(),
  enabled: z.boolean(),
  trigger: TriggerSchema,
  /** 可选条件表达式，为假时不执行动作。 */
  condition: ExprSrc.optional(),
  /** 防重复触发：两次触发的最小间隔。 */
  throttleMs: z.number().int().min(0).max(60_000).optional(),
  actions: z.array(ActionSchema).max(PROTOCOL_LIMITS.actionsPerList),
});

export const FunctionSchema = z.object({
  id: Id,
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,23}$/, "函数名只能用字母、数字和下划线"),
  description: z.string().max(120).optional(),
  params: z
    .array(z.object({ name: VarKey, type: ValueTypeSchema, default: ExprSrc.optional() }))
    .max(PROTOCOL_LIMITS.params),
  returnType: z.union([ValueTypeSchema, z.literal("void")]),
  locals: z.array(z.object({ name: VarKey, type: ValueTypeSchema })).max(16),
  body: z.array(ActionSchema).max(PROTOCOL_LIMITS.actionsPerList),
  version: z.number().int().min(1),
});

export const TimerSchema = z.object({
  id: Id,
  name: z.string().max(40),
  kind: z.enum(["countdown", "stopwatch"]),
  /** 倒计时总时长（秒）；秒表忽略。 */
  durationSec: z
    .number()
    .int()
    .min(1)
    .max(86_400 * 7),
});

export const TIME_FIELDS = [
  "now",
  "year",
  "month",
  "day",
  "hour",
  "minute",
  "second",
  "weekday",
  "timestamp",
  "timerRemaining",
  "timerElapsed",
  "timerPercent",
] as const;

export const BindingSchema = z.object({
  id: Id,
  componentId: Id,
  prop: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,31}$/),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("variable"), variableId: Id }),
    z.object({
      kind: z.literal("time"),
      field: z.enum(TIME_FIELDS),
      timerId: z.string().max(48).optional(),
    }),
    z.object({ kind: z.literal("expr"), expr: ExprSrc }),
  ]),
  /** 时间格式（YYYY MM DD HH hh mm ss A W）或时长格式（HH mm ss）。 */
  format: z.string().max(40).optional(),
  /** 刷新频率；time 源默认每分钟，省电。 */
  refresh: z.enum(["change", "second", "minute"]).optional(),
});

export const AssetSchema = z.object({
  id: Id,
  kind: z.enum(["image", "font", "audio"]),
  path: z
    .string()
    .regex(/^assets\/[A-Za-z0-9_./-]{1,120}$/)
    .refine((p) => !p.includes(".."), "资源路径不能包含 .."),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z
    .number()
    .int()
    .min(0)
    .max(2 * 1024 * 1024),
  mime: z.string().max(40),
});

export const DependencySchema = z.object({
  type: z.enum(COMPONENT_TYPES),
  /** 平台组件编号（商城组件）或 builtin。 */
  componentId: z.string().max(48),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
});

export const ProjectDocSchema = z.object({
  format: z.literal(PROTOCOL_FORMAT),
  schemaVersion: z.literal(SCHEMA_VERSION),
  project: z.object({
    id: Id,
    name: Name,
    appName: Name,
    /** 格式（com.example.app）在语义校验里检查，草稿允许暂时不合规。 */
    packageName: z.string().min(1).max(80),
    createdAt: z.number().int().min(0),
    updatedAt: z.number().int().min(0),
    /** 服务端修订号；本地新建为 0。 */
    revision: z.number().int().min(0),
    templateId: z.string().max(24).optional(),
  }),
  manifest: z.object({
    device: z.enum(DEVICE_SHAPES),
    designWidth: z.literal(466),
    canvas: z.object({
      width: z.number().int().min(100).max(2000),
      height: z.number().int().min(100).max(2000),
    }),
    versionName: z.string().regex(/^\d+(\.\d+){0,3}$/),
    versionCode: z.number().int().min(1),
    /** 目标 SDK；verified 只有真机验证过才为 true。 */
    sdk: z.object({ toolkit: z.string().max(40), verified: z.boolean() }),
  }),
  startPageId: Id,
  navigation: z.object({
    kind: z.enum(["none", "bottom", "top", "side"]),
    items: z.array(z.object({ id: Id, label: z.string().max(12), pageId: Id })).max(5),
  }),
  pages: z.array(PageSchema).min(1).max(PROTOCOL_LIMITS.pages),
  variables: z.array(VariableSchema).max(PROTOCOL_LIMITS.variables),
  events: z.array(EventSchema).max(PROTOCOL_LIMITS.events),
  functions: z.array(FunctionSchema).max(PROTOCOL_LIMITS.functions),
  timers: z.array(TimerSchema).max(PROTOCOL_LIMITS.timers),
  bindings: z.array(BindingSchema).max(PROTOCOL_LIMITS.bindings),
  assets: z.array(AssetSchema).max(PROTOCOL_LIMITS.assets),
  dependencies: z.array(DependencySchema).max(64),
});

export type ProjectDoc = z.infer<typeof ProjectDocSchema>;
export type PageDoc = z.infer<typeof PageSchema>;
export type ComponentInstance = z.infer<typeof ComponentInstanceSchema>;
export type VariableDoc = z.infer<typeof VariableSchema>;
export type EventDoc = z.infer<typeof EventSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;
export type FunctionDoc = z.infer<typeof FunctionSchema>;
export type TimerDoc = z.infer<typeof TimerSchema>;
export type BindingDoc = z.infer<typeof BindingSchema>;
export type AssetDoc = z.infer<typeof AssetSchema>;
export type DependencyDoc = z.infer<typeof DependencySchema>;
export type VarType = z.infer<typeof ValueTypeSchema>;

/** 每种组件可以绑定/修改的属性及其类型（规格 8.3：只允许明确的属性）。 */
export const BINDABLE_PROPS: Record<(typeof COMPONENT_TYPES)[number], Record<string, VarType>> = {
  text: { text: "string", color: "string", fontSize: "int" },
  number: { text: "string", color: "string", fontSize: "int" },
  time: { text: "string", color: "string", fontSize: "int" },
  button: { value: "string", color: "string", background: "string" },
  progress: { percent: "int", color: "string", layerColor: "string" },
  switch: { checked: "bool", track: "string" },
  image: { src: "string" },
  column: { background: "string" },
  row: { background: "string" },
  rect: { background: "string", border: "string" },
  circle: { background: "string" },
  divider: { color: "string" },
  spacer: {},
  hotspot: {},
};

