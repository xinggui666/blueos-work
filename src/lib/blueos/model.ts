export const SCHEMA_VERSION = "1.0" as const;
export const DESIGN = 466;
export const GENERATOR = "blueos-ui-builder@0.1.0";

export type DeviceShape = "watch-round" | "watch-square";

export type CompType =
  | "text"
  | "image"
  | "button"
  | "column"
  | "row"
  | "spacer"
  | "divider"
  | "rect"
  | "circle"
  | "progress"
  | "switch"
  | "number"
  | "time"
  | "hotspot";

export type PropMap = Record<string, string | number | boolean>;

export type SceneNode = {
  id: string;
  type: CompType;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  locked: boolean;
  hidden: boolean;
  props: PropMap;
  actions: AppAction[];
};

export type ActionKind = "navigate" | "back" | "toast" | "show" | "hide" | "setText" | "setVar" | "call";
export type ActionTrigger = "click" | "longpress" | "double" | "swipe";

export type AppAction = {
  id: string;
  kind: ActionKind;
  trigger: ActionTrigger;
  pageName: string;
  nodeId: string;
  text: string;
  varKey: string;
  varValue: string;
  whenKey: string;
  whenValue: string;
};

export type AppVariable = {
  id: string;
  key: string;
  kind: "string" | "number" | "boolean";
  value: string;
  scope: "app" | "page";
  pageId: string;
};

export type AppFunction = {
  id: string;
  name: string;
  steps: AppAction[];
};

export type TimeFormat = "time" | "timeSeconds" | "date" | "weekday";
export type TimeBinding = {
  id: string;
  nodeId: string;
  format: TimeFormat;
};

export type NavKind = "none" | "bottom" | "top" | "side";
export type NavItem = { id: string; label: string; pageId: string };
export type TemplateId = "blank" | "tabs" | "settings" | "data";
export const MAX_PAGES = 12;

export type ScenePage = {
  id: string;
  name: string;
  background: string;
  nodes: SceneNode[];
};

export type Revision = {
  id: string;
  at: number;
  note: string;
  snapshot: string;
};

export type Project = {
  id: string;
  name: string;
  appName: string;
  packageName: string;
  device: DeviceShape;
  designWidth: 466;
  updatedAt: number;
  startPageId: string;
  nav: { kind: NavKind; items: NavItem[] };
  variables: AppVariable[];
  functions: AppFunction[];
  timeBindings: TimeBinding[];
  templateId: TemplateId;
  pages: ScenePage[];
  revisions: Revision[];
  /** 统一协议里编辑器暂时不能直接编辑的部分，原样保留（见 src/lib/protocol/editor.ts）。 */
  protocolExtras?: import("../protocol/editor").ProtocolExtras;
};

export type Field =
  | { key: string; kind: "text"; label: string; max?: number }
  | { key: string; kind: "color"; label: string }
  | { key: string; kind: "number"; label: string; min: number; max: number; step?: number }
  | { key: string; kind: "select"; label: string; options: { value: string; label: string }[] }
  | { key: string; kind: "bool"; label: string };

export type CatalogItem = {
  type: CompType;
  group: string;
  label: string;
  tag: string;
  blurb: string;
  limit: string;
  w: number;
  h: number;
  defaults: PropMap;
  fields: Field[];
};

const align: Field = {
  key: "textAlign",
  kind: "select",
  label: "对齐",
  options: [
    { value: "left", label: "左" },
    { value: "center", label: "中" },
    { value: "right", label: "右" },
  ],
};

const weight: Field = {
  key: "fontWeight",
  kind: "select",
  label: "字重",
  options: [
    { value: "normal", label: "常规" },
    { value: "bold", label: "粗体" },
  ],
};

function textFields(_sample: string): Field[] {
  return [
    { key: "text", kind: "text", label: "内容", max: 80 },
    { key: "color", kind: "color", label: "颜色" },
    { key: "fontSize", kind: "number", label: "字号", min: 12, max: 96 },
    weight,
    align,
    { key: "lines", kind: "number", label: "行数", min: -1, max: 8, step: 1 },
    { key: "click", kind: "bool", label: "点击日志" },
  ];
}

export const CATALOG: CatalogItem[] = [
  {
    type: "text",
    group: "基础",
    label: "文本",
    tag: "text",
    blurb: "官方 text。文字放在数据绑定里，样式使用 color、font-size、text-align。",
    limit: "font-weight 只输出 normal / bold。",
    w: 220,
    h: 48,
    defaults: { text: "文本", color: "#1D1D1F", fontSize: 32, fontWeight: "normal", textAlign: "left", lines: -1, click: false },
    fields: textFields("文本"),
  },
  {
    type: "image",
    group: "基础",
    label: "图片",
    tag: "image",
    blurb: "官方 image。src 可以是本地路径或网络地址。",
    limit: "官方说明不支持子组件和事件，生成时不会写 onclick。",
    w: 96,
    h: 96,
    defaults: { src: "/assets/images/logo.png", objectFit: "cover", alt: "blank" },
    fields: [
      { key: "src", kind: "text", label: "src", max: 180 },
      {
        key: "objectFit",
        kind: "select",
        label: "缩放",
        options: [
          { value: "cover", label: "cover" },
          { value: "contain", label: "contain" },
          { value: "fill", label: "fill" },
        ],
      },
      { key: "alt", kind: "text", label: "alt", max: 40 },
    ],
  },
  {
    type: "button",
    group: "基础",
    label: "按钮",
    tag: "input",
    blurb: "官方 input，type 固定为 button。对应快速开始里的按钮写法。",
    limit: "不是独立的 button 标签。",
    w: 180,
    h: 64,
    defaults: { value: "开始", color: "#FFFFFF", fontSize: 28, background: "#0071E3", radius: 32, click: true },
    fields: [
      { key: "value", kind: "text", label: "文案", max: 24 },
      { key: "color", kind: "color", label: "文字" },
      { key: "background", kind: "color", label: "底色" },
      { key: "fontSize", kind: "number", label: "字号", min: 12, max: 64 },
      { key: "radius", kind: "number", label: "圆角", min: 0, max: 80 },
      { key: "click", kind: "bool", label: "点击日志" },
    ],
  },
  {
    type: "column",
    group: "布局",
    label: "纵向",
    tag: "div",
    blurb: "div，flex-direction: column。",
    limit: "本阶段子组件仍是页面绝对定位，不会嵌进这个容器。",
    w: 280,
    h: 140,
    defaults: { background: "#122033", radius: 24, click: false },
    fields: [
      { key: "background", kind: "color", label: "底色" },
      { key: "radius", kind: "number", label: "圆角", min: 0, max: 80 },
      { key: "click", kind: "bool", label: "点击日志" },
    ],
  },
  {
    type: "row",
    group: "布局",
    label: "横向",
    tag: "div",
    blurb: "div，flex-direction: row。",
    limit: "本阶段不把子组件排进横排，只输出容器本身。",
    w: 300,
    h: 72,
    defaults: { background: "#122033", radius: 20, click: false },
    fields: [
      { key: "background", kind: "color", label: "底色" },
      { key: "radius", kind: "number", label: "圆角", min: 0, max: 80 },
      { key: "click", kind: "bool", label: "点击日志" },
    ],
  },
  {
    type: "spacer",
    group: "布局",
    label: "间距",
    tag: "div",
    blurb: "透明 div，用来占位。",
    limit: "预览里的虚线只在编辑器显示，不会写进源工程。",
    w: 80,
    h: 28,
    defaults: { click: false },
    fields: [{ key: "click", kind: "bool", label: "点击日志" }],
  },
  {
    type: "divider",
    group: "布局",
    label: "分隔线",
    tag: "div",
    blurb: "一条细 div。",
    limit: "用 background-color 画线，不是官方 line 组件。",
    w: 220,
    h: 2,
    defaults: { color: "#314256", click: false },
    fields: [
      { key: "color", kind: "color", label: "颜色" },
      { key: "click", kind: "bool", label: "点击日志" },
    ],
  },
  {
    type: "rect",
    group: "图形",
    label: "矩形",
    tag: "div",
    blurb: "div。圆角会同时写 border-width 和 border-color。",
    limit: "官方说明只设圆角、不设边框时圆角无效。",
    w: 160,
    h: 96,
    defaults: { background: "#16324C", radius: 18, border: "#16324C", click: false },
    fields: [
      { key: "background", kind: "color", label: "底色" },
      { key: "border", kind: "color", label: "描边" },
      { key: "radius", kind: "number", label: "圆角", min: 0, max: 80 },
      { key: "click", kind: "bool", label: "点击日志" },
    ],
  },
  {
    type: "circle",
    group: "图形",
    label: "圆形",
    tag: "div",
    blurb: "div，宽高取较短边，圆角为边长的一半。",
    limit: "不是官方 circle 标签。文档里的圆形能力在 SVG，这里用 div 近似。",
    w: 120,
    h: 120,
    defaults: { background: "#3C8DFF", click: false },
    fields: [
      { key: "background", kind: "color", label: "底色" },
      { key: "click", kind: "bool", label: "点击日志" },
    ],
  },
  {
    type: "progress",
    group: "数据",
    label: "进度",
    tag: "progress",
    blurb: "官方 progress。颜色用 color，底色用 layer-color。",
    limit: "background-color 在进度条上已废弃，所以不输出它。",
    w: 260,
    h: 16,
    defaults: { percent: 64, color: "#0071E3", layerColor: "#E5E5EA", progressType: "horizontal", click: false },
    fields: [
      { key: "percent", kind: "number", label: "进度", min: 0, max: 100 },
      { key: "color", kind: "color", label: "颜色" },
      { key: "layerColor", kind: "color", label: "底色" },
      {
        key: "progressType",
        kind: "select",
        label: "类型",
        options: [
          { value: "horizontal", label: "横向" },
          { value: "arc", label: "弧形" },
        ],
      },
      { key: "click", kind: "bool", label: "点击日志" },
    ],
  },
  {
    type: "switch",
    group: "交互",
    label: "开关",
    tag: "switch",
    blurb: "官方 switch。",
    limit: "变更事件是 change。点击日志仍用通用 click。",
    w: 84,
    h: 48,
    defaults: { checked: true, thumb: "#FFFFFF", track: "#0071E3", click: false },
    fields: [
      { key: "checked", kind: "bool", label: "打开" },
      { key: "thumb", kind: "color", label: "滑块" },
      { key: "track", kind: "color", label: "轨道" },
      { key: "click", kind: "bool", label: "点击日志" },
    ],
  },
  {
    type: "number",
    group: "数据",
    label: "数字",
    tag: "text",
    blurb: "映射成 text。",
    limit: "没有单独的官方数字组件，不会假装有。",
    w: 180,
    h: 72,
    defaults: { text: "128", color: "#1D1D1F", fontSize: 52, fontWeight: "bold", textAlign: "center", lines: 1, click: false },
    fields: textFields("128"),
  },
  {
    type: "time",
    group: "数据",
    label: "时间",
    tag: "text",
    blurb: "映射成 text，内容就是你写下的字符串。",
    limit: "不调用系统时钟。未核对到可直接映射的时间组件。",
    w: 240,
    h: 78,
    defaults: { text: "09:41", color: "#1D1D1F", fontSize: 64, fontWeight: "bold", textAlign: "center", lines: 1, click: false },
    fields: textFields("09:41"),
  },
  {
    type: "hotspot",
    group: "交互",
    label: "点击区",
    tag: "div",
    blurb: "透明 div，用于点击热区。",
    limit: "预览虚线不会进入源工程。",
    w: 160,
    h: 72,
    defaults: { click: true },
    fields: [{ key: "click", kind: "bool", label: "点击日志" }],
  },
];

export const CATALOG_MAP: Record<CompType, CatalogItem> = Object.fromEntries(
  CATALOG.map((item) => [item.type, item]),
) as Record<CompType, CatalogItem>;

export type DslComponent = {
  id: string;
  type: CompType;
  componentVersion: "1.0.0";
  name: string;
  props: PropMap;
  layout: { x: number; y: number; width: number; height: number };
  events: { click: boolean };
  actions: AppAction[];
  hidden: boolean;
  locked: boolean;
};

export type Dsl = {
  schemaVersion: "1.0";
  project: {
    id: string;
    name: string;
    appName: string;
    packageName: string;
    target: "blueos";
    deviceType: DeviceShape;
    designWidth: 466;
    startPage: string;
  };
  navigation: { kind: NavKind; items: { label: string; page: string }[] };
  variables: { key: string; kind: AppVariable["kind"]; value: string; scope: "app" | "page"; pageId: string }[];
  sdk: { version: "unverified"; note: string };
  generator: { name: string };
  pages: {
    id: string;
    name: string;
    background: string;
    components: DslComponent[];
  }[];
};

export type Issue = { path: string; message: string; level: "error" | "warn" };

export function uid(prefix = "n"): string {
  const bytes = new Uint8Array(4);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function catalogOf(type: string): CatalogItem | undefined {
  return CATALOG.find((item) => item.type === type);
}

export function makeNode(type: CompType, x: number, y: number): SceneNode {
  const item = CATALOG_MAP[type];
  return {
    id: uid("n"),
    type,
    name: item.label,
    x: Math.round(x),
    y: Math.round(y),
    w: item.w,
    h: item.h,
    locked: false,
    hidden: false,
    props: { ...item.defaults },
    actions: [],
  };
}

export function makeAction(kind: ActionKind, patch: Partial<AppAction> = {}): AppAction {
  return {
    id: uid("a"),
    kind,
    trigger: patch.trigger || "click",
    pageName: patch.pageName || "",
    nodeId: patch.nodeId || "",
    text: patch.text || "",
    varKey: patch.varKey || "",
    varValue: patch.varValue || "",
    whenKey: patch.whenKey || "",
    whenValue: patch.whenValue || "",
  };
}

export function makePage(name = "Home"): ScenePage {
  return { id: uid("p"), name, background: "#F5F5F7", nodes: [] };
}

export function makeProject(partial?: Partial<Pick<Project, "name" | "appName" | "packageName" | "device">>): Project {
  const page = makePage("Home");
  return {
    id: uid("j"),
    name: partial?.name?.trim() || "未命名工程",
    appName: partial?.appName?.trim() || "新应用",
    packageName: partial?.packageName?.trim() || "com.example.app",
    device: partial?.device || "watch-round",
    designWidth: 466,
    updatedAt: Date.now(),
    startPageId: page.id,
    nav: { kind: "none", items: [] },
    variables: [],
    functions: [],
    timeBindings: [],
    templateId: "blank",
    pages: [page],
    revisions: [],
  };
}

function paint(
  page: ScenePage,
  type: CompType,
  x: number,
  y: number,
  props: PropMap,
  w?: number,
  h?: number,
  name?: string,
  actions: AppAction[] = [],
) {
  const node = makeNode(type, x, y);
  node.props = { ...node.props, ...props };
  if (w) node.w = w;
  if (h) node.h = h;
  if (name) node.name = name;
  node.actions = actions;
  page.nodes.push(node);
}

export function makeFromTemplate(
  template: TemplateId,
  partial?: Partial<Pick<Project, "name" | "appName" | "packageName" | "device">>,
): Project {
  const project = makeProject(partial);
  project.templateId = template;
  if (template === "blank") return project;
  if (template === "settings") {
    const page = makePage("Settings");
    paint(page, "text", 36, 36, { text: "设置", color: "#1D1D1F", fontSize: 36, fontWeight: "bold", textAlign: "left", lines: 1 }, 280, 48, "标题");
    paint(page, "text", 36, 120, { text: "通知", color: "#1D1D1F", fontSize: 28, textAlign: "left", lines: 1 }, 220, 40, "通知");
    paint(page, "switch", 330, 112, { checked: true, thumb: "#FFFFFF", track: "#0071E3" }, 84, 48, "开关");
    paint(page, "button", 83, 200, { value: "保存提示", color: "#FFFFFF", fontSize: 26, background: "#0071E3", radius: 28, click: true }, 300, 64, "提示", [
      makeAction("toast", { text: "已保存" }),
    ]);
    project.pages = [page];
    project.startPageId = page.id;
    if (!partial?.name?.trim()) project.name = "设置中心";
    return project;
  }
  if (template === "data") {
    const page = makePage("Board");
    paint(page, "text", 40, 48, { text: "今日", color: "#6E6E73", fontSize: 22, textAlign: "center", lines: 1 }, 386, 32, "标签");
    paint(page, "number", 40, 88, { text: "6420", color: "#1D1D1F", fontSize: 64, fontWeight: "bold", textAlign: "center", lines: 1 }, 386, 80, "数字");
    paint(page, "progress", 60, 190, { percent: 72, color: "#0071E3", layerColor: "#E5E5EA", progressType: "horizontal" }, 346, 16, "进度");
    paint(page, "text", 40, 220, { text: "完成 72%", color: "#6E6E73", fontSize: 22, textAlign: "center", lines: 1 }, 386, 32, "说明");
    project.pages = [page];
    project.startPageId = page.id;
    if (!partial?.name?.trim()) project.name = "数据看板";
    return project;
  }
  const home = makePage("Home");
  const detail = makePage("Detail");
  const settings = makePage("Settings");
  paint(home, "text", 40, 48, { text: "首页", color: "#1D1D1F", fontSize: 40, fontWeight: "bold", textAlign: "center", lines: 1 }, 386, 52, "标题");
  paint(home, "text", 40, 108, { text: "进入下一页", color: "#6E6E73", fontSize: 22, textAlign: "center", lines: 1 }, 386, 36, "说明");
  paint(home, "progress", 70, 160, { percent: 64, color: "#0071E3", layerColor: "#E5E5EA", progressType: "horizontal" }, 326, 16, "进度");
  paint(home, "button", 83, 206, { value: "查看详情", color: "#FFFFFF", fontSize: 26, background: "#0071E3", radius: 28, click: true }, 300, 64, "跳转", [
    makeAction("navigate", { pageName: "Detail" }),
  ]);
  paint(detail, "text", 40, 56, { text: "详情", color: "#1D1D1F", fontSize: 40, fontWeight: "bold", textAlign: "center", lines: 1 }, 386, 52, "标题");
  paint(detail, "button", 83, 180, { value: "返回", color: "#1D1D1F", fontSize: 26, background: "#E5E5EA", radius: 28, click: true }, 300, 64, "返回", [
    makeAction("back"),
  ]);
  paint(settings, "text", 36, 48, { text: "设置", color: "#1D1D1F", fontSize: 36, fontWeight: "bold", textAlign: "left", lines: 1 }, 280, 48, "标题");
  paint(settings, "text", 36, 130, { text: "通知", color: "#1D1D1F", fontSize: 26, textAlign: "left", lines: 1 }, 200, 40, "通知");
  paint(settings, "switch", 330, 122, { checked: true, thumb: "#FFFFFF", track: "#0071E3" }, 84, 48, "开关");
  paint(settings, "button", 83, 210, { value: "提示", color: "#FFFFFF", fontSize: 26, background: "#0071E3", radius: 28, click: true }, 300, 64, "提示", [
    makeAction("toast", { text: "已保存" }),
  ]);
  project.pages = [home, detail, settings];
  project.startPageId = home.id;
  project.nav = {
    kind: "bottom",
    items: [
      { id: uid("b"), label: "首页", pageId: home.id },
      { id: uid("b"), label: "详情", pageId: detail.id },
      { id: uid("b"), label: "设置", pageId: settings.id },
    ],
  };
  if (!partial?.name?.trim()) project.name = "底部导航应用";
  return project;
}

export function makeSample(): Project {
  return makeFromTemplate("tabs", {
    name: "示例应用",
    appName: "示例",
    packageName: "com.example.hello",
    device: "watch-round",
  });
}

export function projectToDsl(project: Project): Dsl {
  const start = project.pages.find((page) => page.id === project.startPageId) || project.pages[0];
  return {
    schemaVersion: SCHEMA_VERSION,
    project: {
      id: project.id,
      name: project.name,
      appName: project.appName,
      packageName: project.packageName,
      target: "blueos",
      deviceType: project.device,
      designWidth: 466,
      startPage: start?.name || "Home",
    },
    navigation: {
      kind: project.nav?.kind || "none",
      items: (project.nav?.items || []).flatMap((item) => {
        const page = project.pages.find((entry) => entry.id === item.pageId);
        if (!page) return [];
        return [{ label: item.label || page.name, page: page.name }];
      }),
    },
    variables: (project.variables || []).map((item) => ({
      key: item.key,
      kind: item.kind,
      value: item.value,
      scope: item.scope === "page" ? "page" : "app",
      pageId: item.pageId || "",
    })),
    sdk: {
      version: "unverified",
      note: "未在此环境核对可安装的 BlueOS SDK 版本号，生成器不写死一个假装已验证的版本。",
    },
    generator: { name: GENERATOR },
    pages: project.pages.map((page) => ({
      id: page.id,
      name: page.name,
      background: page.background,
      components: page.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        componentVersion: "1.0.0" as const,
        name: node.name,
        props: { ...node.props },
        layout: { x: node.x, y: node.y, width: node.w, height: node.h },
        events: { click: (Boolean(node.props.click) || (node.actions || []).length > 0) && node.type !== "image" },
        actions: node.type === "image" ? [] : (node.actions || []).slice(0, 8),
        hidden: node.hidden,
        locked: node.locked,
      })),
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function validateDsl(input: unknown): { dsl: Dsl | null; issues: Issue[] } {
  const issues: Issue[] = [];
  if (!isRecord(input)) return { dsl: null, issues: [{ path: "", message: "DSL 必须是对象", level: "error" }] };
  const project = isRecord(input.project) ? input.project : null;
  const pagesIn = Array.isArray(input.pages) ? input.pages : null;
  if (!project) issues.push({ path: "project", message: "缺少 project", level: "error" });
  if (!pagesIn) issues.push({ path: "pages", message: "缺少 pages", level: "error" });
  if (!project || !pagesIn) return { dsl: null, issues };

  const name = asText(project.name, 40);
  const appName = asText(project.appName, 12);
  const packageName = asText(project.packageName, 80);
  const deviceType = project.deviceType === "watch-square" ? "watch-square" : project.deviceType === "watch-round" ? "watch-round" : "";
  if (!name) issues.push({ path: "project.name", message: "工程名不能为空", level: "error" });
  if (!appName) issues.push({ path: "project.appName", message: "应用名不能为空", level: "error" });
  if (appName.length > 6) issues.push({ path: "project.appName", message: "官方要求应用名 6 个汉字以内，当前更长", level: "warn" });
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(packageName)) {
    issues.push({ path: "project.packageName", message: "包名需类似 com.example.app，全小写", level: "error" });
  }
  if (!deviceType) issues.push({ path: "project.deviceType", message: "设备只支持 watch-round 或 watch-square", level: "error" });
  if (project.designWidth !== 466) issues.push({ path: "project.designWidth", message: "本阶段设计宽度固定 466", level: "error" });
  if (pagesIn.length < 1 || pagesIn.length > MAX_PAGES) issues.push({ path: "pages", message: "页面数量需在 1 到 12 之间", level: "error" });

  const noted = new Set<string>();
  const warnOnce = (key: string, path: string, message: string) => {
    if (noted.has(key)) return;
    noted.add(key);
    issues.push({ path, message, level: "warn" });
  };
  const pages: Dsl["pages"] = [];
  const seenPage = new Set<string>();
  pagesIn.forEach((pageRaw, pageIndex) => {
    if (!isRecord(pageRaw)) {
      issues.push({ path: `pages[${pageIndex}]`, message: "页面格式错误", level: "error" });
      return;
    }
    const pageName = asText(pageRaw.name, 40);
    if (!/^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(pageName)) {
      issues.push({ path: `pages[${pageIndex}].name`, message: "页面名需以字母开头，只含字母数字下划线", level: "error" });
    }
    if (seenPage.has(pageName)) issues.push({ path: `pages[${pageIndex}].name`, message: "页面名重复", level: "error" });
    seenPage.add(pageName);
    const background = asColor(pageRaw.background) || "";
    if (!background) issues.push({ path: `pages[${pageIndex}].background`, message: "页面背景需要 #RRGGBB", level: "error" });
    const componentsIn = Array.isArray(pageRaw.components) ? pageRaw.components : [];
    if (componentsIn.length > 80) issues.push({ path: `pages[${pageIndex}].components`, message: "单页最多 80 个组件", level: "error" });
    const components: DslComponent[] = [];
    const seenId = new Set<string>();
    componentsIn.forEach((raw, index) => {
      const path = `pages[${pageIndex}].components[${index}]`;
      if (!isRecord(raw)) {
        issues.push({ path, message: "组件格式错误", level: "error" });
        return;
      }
      const item = catalogOf(String(raw.type || ""));
      if (!item) {
        issues.push({ path: `${path}.type`, message: `不支持的组件 ${String(raw.type || "")}`, level: "error" });
        return;
      }
      const id = asText(raw.id, 24);
      if (!/^[a-z][a-z0-9]{3,20}$/.test(id)) issues.push({ path: `${path}.id`, message: "组件 id 不合法", level: "error" });
      if (seenId.has(id)) issues.push({ path: `${path}.id`, message: "组件 id 重复", level: "error" });
      seenId.add(id);
      const layout = isRecord(raw.layout) ? raw.layout : {};
      const x = asNum(layout.x);
      const y = asNum(layout.y);
      const width = asNum(layout.width);
      const height = asNum(layout.height);
      if (x === null || y === null || x < -40 || y < -40 || x > DESIGN || y > DESIGN) {
        issues.push({ path: `${path}.layout`, message: "坐标超出画布范围", level: "error" });
      }
      if (width === null || height === null || width < 1 || height < 1 || width > DESIGN || height > DESIGN) {
        issues.push({ path: `${path}.layout`, message: "宽高不合法", level: "error" });
      }
      const props = sanitizeProps(item, isRecord(raw.props) ? raw.props : {}, `${path}.props`, issues);
      const actions = item.type === "image" ? [] : readActions(raw.actions);
      if (item.type === "image" && Array.isArray(raw.actions) && raw.actions.length) {
        warnOnce("image-click", `${path}.events`, "image 不支持事件，已忽略动作");
      }
      if (item.type === "time") warnOnce("time-static", `${path}.type`, "时间组件只输出静态文本，不接系统时钟");
      if (item.type === "column" || item.type === "row") {
        warnOnce("layout-flat", `${path}.type`, "纵向/横向容器本阶段不嵌套子组件，按绝对定位的 div 输出");
      }
      if (item.type === "number") warnOnce("number-text", `${path}.type`, "数字映射为 text，不是独立官方组件");
      if (item.type === "circle") warnOnce("circle-div", `${path}.type`, "圆形用 div 近似，不是官方 circle 标签");
      components.push({
        id,
        type: item.type,
        componentVersion: "1.0.0",
        name: asText(raw.name, 24) || item.label,
        props,
        layout: { x: x ?? 0, y: y ?? 0, width: width ?? item.w, height: height ?? item.h },
        events: { click: (Boolean(props.click) || actions.length > 0) && item.type !== "image" },
        actions,
        hidden: Boolean(raw.hidden),
        locked: Boolean(raw.locked),
      });
    });
    pages.push({
      id: asText(pageRaw.id, 24) || uid("p"),
      name: pageName,
      background: background || "#000000",
      components,
    });
  });

  const navigation = readNavigation(input.navigation, pages.map((page) => page.name));
  const variables = readVariables(input.variables);
  const requestedStart = asText(project.startPage, 31);
  const startPage = pages.some((page) => page.name === requestedStart) ? requestedStart : pages[0]?.name || "Home";
  pages.forEach((page, pageIndex) => {
    page.components.forEach((component, index) => {
      component.actions.forEach((action, actionIndex) => {
        if (action.kind === "navigate" && !pages.some((entry) => entry.name === action.pageName)) {
          issues.push({
            path: `pages[${pageIndex}].components[${index}].actions[${actionIndex}]`,
            message: `跳转目标 ${action.pageName || "空"} 不存在`,
            level: "error",
          });
        }
      });
    });
  });

  const dsl: Dsl = {
    schemaVersion: "1.0",
    project: {
      id: asText(project.id, 24) || uid("j"),
      name,
      appName,
      packageName,
      target: "blueos",
      deviceType: deviceType || "watch-round",
      designWidth: 466,
      startPage,
    },
    navigation,
    variables,
    sdk: { version: "unverified", note: "SDK 版本未在此环境验证" },
    generator: { name: GENERATOR },
    pages,
  };
  if (issues.some((issue) => issue.level === "error")) return { dsl: null, issues };
  return { dsl, issues };
}

export function dslToProject(dsl: Dsl, revisions: Revision[] = []): Project {
  const pages = dsl.pages.map((page) => ({
    id: page.id,
    name: page.name,
    background: page.background,
    nodes: page.components.map((component) => ({
      id: component.id,
      type: component.type,
      name: component.name,
      x: component.layout.x,
      y: component.layout.y,
      w: component.layout.width,
      h: component.layout.height,
      hidden: component.hidden,
      locked: component.locked,
      props: { ...component.props },
      actions: component.actions || [],
    })),
  }));
  const start = pages.find((page) => page.name === dsl.project.startPage) || pages[0];
  return normalizeProject({
    id: dsl.project.id,
    name: dsl.project.name,
    appName: dsl.project.appName,
    packageName: dsl.project.packageName,
    device: dsl.project.deviceType,
    designWidth: 466,
    updatedAt: Date.now(),
    startPageId: start?.id,
    nav: {
      kind: dsl.navigation?.kind || "none",
      items: (dsl.navigation?.items || []).flatMap((item) => {
        const page = pages.find((entry) => entry.name === item.page);
        if (!page) return [];
        return [{ id: uid("b"), label: item.label, pageId: page.id }];
      }),
    },
    variables: (dsl.variables || []).map((item) => ({
      id: uid("v"),
      key: item.key,
      kind: item.kind,
      value: item.value,
      scope: item.scope,
      pageId: item.pageId,
    })),
    revisions,
    pages,
  });
}

const ACTION_KINDS: ActionKind[] = ["navigate", "back", "toast", "show", "hide", "setText", "setVar", "call"];
const TRIGGERS: ActionTrigger[] = ["click", "longpress", "double", "swipe"];

function readOneAction(item: unknown): AppAction {
  const raw = isRecord(item) ? item : {};
  const kind = ACTION_KINDS.includes(raw.kind as ActionKind) ? (raw.kind as ActionKind) : "toast";
  const trigger = TRIGGERS.includes(raw.trigger as ActionTrigger) ? (raw.trigger as ActionTrigger) : "click";
  return {
    id: /^[a-z][a-z0-9]{3,20}$/.test(String(raw.id || "")) ? String(raw.id) : uid("a"),
    kind,
    trigger,
    pageName: asText(raw.pageName, 31),
    nodeId: asText(raw.nodeId, 24),
    text: asText(raw.text, 40),
    varKey: asText(raw.varKey, 21),
    varValue: asText(raw.varValue, 40),
    whenKey: asText(raw.whenKey, 21),
    whenValue: asText(raw.whenValue, 40),
  };
}

function readActions(value: unknown): AppAction[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map((item) => readOneAction(item));
}

function readNavigation(value: unknown, names: string[]): Dsl["navigation"] {
  const raw = isRecord(value) ? value : {};
  const kind = raw.kind === "bottom" || raw.kind === "top" || raw.kind === "side" ? raw.kind : "none";
  const items = Array.isArray(raw.items) ? raw.items : [];
  return {
    kind,
    items: items.slice(0, 4).flatMap((item) => {
      if (!isRecord(item)) return [];
      const page = asText(item.page, 31);
      if (!names.includes(page)) return [];
      return [{ label: asText(item.label, 8) || page, page }];
    }),
  };
}

function readVariables(value: unknown): Dsl["variables"] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 24).flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const key = asText(item.key, 21);
    if (!/^[A-Za-z][A-Za-z0-9_]{0,20}$/.test(key)) return [];
    const kind = item.kind === "number" || item.kind === "boolean" ? item.kind : "string";
    return [{ key: key || `value${index + 1}`, kind, value: asText(item.value, 40), scope: item.scope === "page" ? "page" as const : "app" as const, pageId: asText(item.pageId, 40) }];
  });
}

export function normalizeProject(input: Partial<Project>): Project {
  const pages = (input.pages?.length ? input.pages : [makePage("Home")]).slice(0, MAX_PAGES).map((page, index) => ({
    id: page.id || uid("p"),
    name: /^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(page.name || "") ? page.name : `Page${index + 1}`,
    background: asColor(page.background) || "#F5F5F7",
    nodes: (page.nodes || []).map((node) => ({
      ...node,
      actions: Array.isArray(node.actions) ? node.actions.map((action) => readOneAction(action)) : [],
    })),
  }));
  const startPageId = pages.some((page) => page.id === input.startPageId) ? input.startPageId! : pages[0].id;
  const kind = input.nav?.kind === "bottom" || input.nav?.kind === "top" || input.nav?.kind === "side" ? input.nav.kind : "none";
  return {
    id: input.id || uid("j"),
    name: input.name || "未命名工程",
    appName: input.appName || "新应用",
    packageName: input.packageName || "com.example.app",
    device: input.device === "watch-square" ? "watch-square" : "watch-round",
    designWidth: 466,
    updatedAt: input.updatedAt || Date.now(),
    startPageId,
    nav: {
      kind,
      items: (input.nav?.items || [])
        .filter((item) => pages.some((page) => page.id === item.pageId))
        .slice(0, 4)
        .map((item) => ({ id: item.id || uid("b"), label: (item.label || "页面").slice(0, 8), pageId: item.pageId })),
    },
    variables: (input.variables || []).slice(0, 24).map((item, index) => ({
      id: item.id || uid("v"),
      key: /^[A-Za-z][A-Za-z0-9_]{0,20}$/.test(item.key || "") ? item.key : `value${index + 1}`,
      kind: item.kind === "number" || item.kind === "boolean" ? item.kind : "string",
      value: String(item.value ?? "").slice(0, 40),
      scope: item.scope === "page" ? "page" : "app",
      pageId: item.pageId || "",
    })),
    functions: readFunctions(input.functions),
    timeBindings: readTimeBindings(input.timeBindings),
    templateId: input.templateId === "tabs" || input.templateId === "settings" || input.templateId === "data" ? input.templateId : "blank",
    pages,
    revisions: input.revisions || [],
    ...(input.protocolExtras && typeof input.protocolExtras === "object" ? { protocolExtras: input.protocolExtras } : {}),
  };
}

export type PreviewState = {
  pageId: string;
  stack: string[];
  hidden: Record<string, boolean>;
  text: Record<string, string>;
  vars: Record<string, string>;
  toast: string;
};

export function initialPreview(project: Project): PreviewState {
  return {
    pageId: project.startPageId || project.pages[0]?.id || "",
    stack: [],
    hidden: {},
    text: {},
    vars: Object.fromEntries((project.variables || []).map((item) => [item.key, item.value])),
    toast: "",
  };
}

export function runActions(project: Project, state: PreviewState, actions: AppAction[], depth = 0): PreviewState {
  const next: PreviewState = {
    pageId: state.pageId,
    stack: state.stack.slice(),
    hidden: { ...state.hidden },
    text: { ...state.text },
    vars: { ...state.vars },
    toast: "",
  };
  for (const action of actions) {
    if (action.whenKey && (next.vars[action.whenKey] ?? "") !== action.whenValue) continue;
    if (action.kind === "navigate") {
      const page = project.pages.find((item) => item.name === action.pageName);
      if (page && page.id !== next.pageId) {
        next.stack.push(next.pageId);
        next.pageId = page.id;
      }
    } else if (action.kind === "back") {
      const prev = next.stack.pop();
      if (prev) next.pageId = prev;
    } else if (action.kind === "toast") {
      next.toast = action.text || "提示";
    } else if (action.kind === "show" && action.nodeId) {
      next.hidden[action.nodeId] = false;
    } else if (action.kind === "hide" && action.nodeId) {
      next.hidden[action.nodeId] = true;
    } else if (action.kind === "setText" && action.nodeId) {
      next.text[action.nodeId] = action.text;
    } else if (action.kind === "setVar" && action.varKey) {
      next.vars[action.varKey] = action.varValue;
    } else if (action.kind === "call" && action.varKey) {
      if (depth >= 3) {
        next.toast = "函数调用过深，已停止";
        continue;
      }
      const fn = (project.functions || []).find((item) => item.name === action.varKey);
      if (!fn) {
        next.toast = "没有这个函数";
        continue;
      }
      const nested = runActions(project, next, fn.steps, depth + 1);
      next.pageId = nested.pageId;
      next.stack = nested.stack;
      next.hidden = nested.hidden;
      next.text = nested.text;
      next.vars = nested.vars;
      if (nested.toast) next.toast = nested.toast;
    }
  }
  return next;
}

export function formatClock(format: TimeFormat, date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  if (format === "date") return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (format === "weekday") return "日一二三四五六"[date.getDay()] || "";
  if (format === "timeSeconds") return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function readFunctions(value: unknown): AppFunction[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((item) => {
    if (!isRecord(item)) return [];
    const name = asText(item.name, 21);
    if (!/^[A-Za-z][A-Za-z0-9_]{0,20}$/.test(name)) return [];
    return [{ id: asText(item.id, 24) || uid("f"), name, steps: readActions(item.steps) }];
  });
}

function readTimeBindings(value: unknown): TimeBinding[] {
  if (!Array.isArray(value)) return [];
  const formats: TimeFormat[] = ["time", "timeSeconds", "date", "weekday"];
  return value.slice(0, 24).flatMap((item) => {
    if (!isRecord(item)) return [];
    const nodeId = asText(item.nodeId, 24);
    if (!nodeId) return [];
    const format = formats.includes(item.format as TimeFormat) ? (item.format as TimeFormat) : "time";
    return [{ id: asText(item.id, 24) || uid("t"), nodeId, format }];
  });
}

export function shownText(raw: string, vars: Record<string, string>): string {
  return raw.replace(/\$([A-Za-z][A-Za-z0-9_]{0,20})/g, (_, key: string) => vars[key] ?? "");
}

function sanitizeProps(item: CatalogItem, raw: Record<string, unknown>, path: string, issues: Issue[]): PropMap {
  const props: PropMap = { ...item.defaults };
  for (const field of item.fields) {
    const value = raw[field.key];
    if (value === undefined) continue;
    if (field.kind === "text") {
      const text = asText(value, field.max ?? 80);
      if (!text && field.key !== "alt") issues.push({ path: `${path}.${field.key}`, message: `${field.label}不能为空`, level: "error" });
      if (/[{}<>]/.test(text)) issues.push({ path: `${path}.${field.key}`, message: `${field.label}不能包含 < > { }`, level: "error" });
      props[field.key] = text;
    } else if (field.kind === "color") {
      const color = asColor(value);
      if (!color) issues.push({ path: `${path}.${field.key}`, message: `${field.label}需要 #RRGGBB`, level: "error" });
      else props[field.key] = color;
    } else if (field.kind === "number") {
      const num = asNum(value);
      if (num === null || num < field.min || num > field.max) {
        issues.push({ path: `${path}.${field.key}`, message: `${field.label}超出范围`, level: "error" });
      } else props[field.key] = Math.round(num);
    } else if (field.kind === "bool") {
      props[field.key] = Boolean(value);
    } else if (field.kind === "select") {
      const text = String(value);
      if (!field.options.some((option) => option.value === text)) {
        issues.push({ path: `${path}.${field.key}`, message: `${field.label}取值无效`, level: "error" });
      } else props[field.key] = text;
    }
  }
  return props;
}

function asText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function asNum(value: unknown): number | null {
  const num = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(num)) return null;
  return num;
}

export function asColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(text)) return null;
  return text.toUpperCase();
}

export function snapshotOf(project: Project): string {
  return JSON.stringify({
    name: project.name,
    appName: project.appName,
    packageName: project.packageName,
    device: project.device,
    startPageId: project.startPageId,
    nav: project.nav,
    variables: project.variables,
    pages: project.pages,
  });
}
