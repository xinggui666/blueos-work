import { inflateSync } from "node:zlib";
import { checkAsset, pngInfo, type AssetFiles } from "../protocol/assets.ts";
/**
 * 原生工程生成器（阶段 4）：直接消费统一工程协议 v2，生成 BlueOS 源工程（src/app.ux、manifest、页面 .ux）。
 *
 * 逻辑不再降级成 v1：事件、变量、函数、计时器、绑定原样写入 src/common/project.js，
 * 由与网页预览同一份解释器（src/common/engine.js，见 watch-entry.ts）在手表上执行，
 * 所以 `count + 1`、条件、循环、函数、时间绑定都和预览一致。
 *
 * 只在服务端运行（构建任务、源工程生成），不随网页前端下发。
 */
import { createHash } from "node:crypto";
import { CATALOG_MAP } from "../blueos/model.ts";
import { BINDABLE_PROPS, type ActionNode, type ComponentInstance, type PageDoc, type ProjectDoc } from "../protocol/schema.ts";
import { validateDoc } from "../protocol/validate.ts";
import { writeZip } from "../protocol/zip.ts";
import { HOST_TEMPLATE } from "./host-template.ts";
import { iconPng } from "./png.ts";
import { WATCH_RUNTIME, WATCH_RUNTIME_SHA256 } from "./watch-runtime.generated.ts";

export const GENERATOR_VERSION = "native-2.1.0-assets1";
export const DESIGN_WIDTH = 466;

export type NativeFile = { path: string; data: Uint8Array; text?: string };
export type NativeSource = {
  ok: true;
  files: NativeFile[];
  zip: Uint8Array;
  sha256: string;
  fileName: string;
  generator: string;
  runtimeSha256: string;
  notes: string[];
};
export type NativeFailure = { ok: false; issues: { path: string; message: string; level: "error" | "warn" }[] };

const enc = new TextEncoder();
const textFile = (path: string, body: string): NativeFile => ({ path, text: body, data: enc.encode(body) });

/** 页面路由键（相对 src 的目录），蓝河 toolkit 要求如 pages/Home。 */
export function pageUri(page: Pick<PageDoc, "name">): string {
  return `pages/${page.name}`;
}

/** 校验后生成源工程 zip。校验不过时不生成。 */
export function generateNative(input: unknown, assetFiles: AssetFiles = {}): NativeSource | NativeFailure {
  const checked = validateDoc(input);
  const errors = checked.issues.filter((i) => i.level === "error");
  if (!checked.doc || errors.length) return { ok: false, issues: checked.issues.slice(0, 100) };
  const doc = checked.doc;
  for (const [index, asset] of doc.assets.entries()) {
    try {
      const data = assetFiles[asset.path];
      if (!data) throw new Error(`资源 ${asset.path} 缺失`);
      checkAsset(asset, data);
      if (createHash("sha256").update(data).digest("hex") !== asset.sha256)
        throw new Error(`资源 ${asset.path} SHA-256 不符`);
      const info = pngInfo(data),
        raw = inflateSync(info.compressed, { maxOutputLength: info.decodedBytes });
      if (raw.length !== info.decodedBytes) throw new Error("PNG 像素数据长度不符");
      for (let p = 0; p < raw.length; p += info.rowBytes)
        if (raw[p] > 4) throw new Error("PNG 行过滤器无效");
    } catch (error) {
      return {
        ok: false,
        issues: [{ path: `assets.${index}`, level: "error", message: (error as Error).message }],
      };
    }
  }
  const files = emitFiles(doc);
  for (const asset of doc.assets)
    files.push({ path: `src/${asset.path}`, data: assetFiles[asset.path].slice() });
  const zip = writeZip(files.map((f) => ({ path: f.path, data: f.data })));
  return {
    ok: true,
    files,
    zip,
    sha256: createHash("sha256").update(zip).digest("hex"),
    fileName: `${safeFile(doc.project.packageName)}-${doc.manifest.versionName}-src.zip`,
    generator: GENERATOR_VERSION,
    runtimeSha256: WATCH_RUNTIME_SHA256,
    notes: [
      "产物是蓝河源工程（source_zip），不是 RPK。RPK 需要在构建任务里用官方工具链编译。",
      "事件、变量、函数、计时器和绑定由内置解释器执行，和网页预览同一套语义。",
      "双击、滑动由触摸事件推算；应用切到后台/回到前台用 app.ux 的 onHide/onShow。这些还没有在真机验证。",
      "图标是占位图，正式上架需要替换为 114×114、无白边的图标。",
    ],
  };
}

function emitFiles(doc: ProjectDoc): NativeFile[] {
  const usesToast = anyAction(doc, (a) => a.kind === "toast");
  const persisted = doc.variables.filter((v) => v.persist);
  const features: { name: string }[] = [];
  if (usesToast) features.push({ name: "blueos.window.prompt" });
  if (persisted.length) features.push({ name: "blueos.storage.storage" });
  const start = doc.pages.find((p) => p.id === doc.startPageId) ?? doc.pages[0];
  const pages: Record<string, { component: string }> = {};
  for (const page of doc.pages) pages[pageUri(page)] = { component: "index" };
  const manifest = {
    package: doc.project.packageName,
    name: doc.project.appName,
    icon: "/assets/images/logo.png",
    versionName: doc.manifest.versionName,
    versionCode: doc.manifest.versionCode,
    config: { designWidth: DESIGN_WIDTH },
    deviceTypeList: doc.manifest.device === "watch-square" ? ["watch", "watch-square"] : ["watch", "watch-round"],
    appCategory: ["utilities"],
    display: { backgroundColor: start.background },
    router: { entry: pageUri(start), pages },
    features,
  };
  const files: NativeFile[] = [
    textFile("README.md", readme(doc)),
    textFile("blueos-assets.json", JSON.stringify({version:1, assets:doc.assets.map(({path,sha256,bytes}) => ({path,sha256,bytes}))}, null, 2)),
    textFile(
      "package.json",
      JSON.stringify({ name: doc.project.packageName, version: `${doc.manifest.versionName}.0`.split(".").slice(0, 3).join("."), private: true }, null, 2) + "\n",
    ),
    textFile("jsconfig.json", JSON.stringify({ compilerOptions: { baseUrl: "./", paths: { "@/*": ["src/*"] } } }, null, 2) + "\n"),
    textFile("build.config.js", "module.exports = {\n  resolve: {\n    alias: {\n      '@': './src',\n      '~': './src',\n    },\n  },\n}\n"),
    textFile("src/manifest.json", JSON.stringify(manifest, null, 2) + "\n"),
    textFile("src/app.ux", appUx()),
    textFile("src/common/engine.js", WATCH_RUNTIME + "\n"),
    textFile("src/common/project.js", `// 由蓝河工坊生成：工程逻辑数据（协议 v2）\nexport default ${JSON.stringify(runtimeDoc(doc))}\n`),
    textFile("src/common/host.js", hostJs(doc, usesToast, persisted)),
    { path: "src/assets/images/logo.png", data: iconPng(114) },
  ];
  for (const page of doc.pages) files.push(textFile(`src/${pageUri(page)}/index.ux`, pageUx(doc, page)));
  return files;
}

/** 手表端只需要运行时用到的字段。 */
function runtimeDoc(doc: ProjectDoc) {
  return {
    assetPaths: ["/assets/images/logo.png", ...doc.assets.map(a => `/${a.path}`)],
    startPageId: doc.startPageId,
    pages: doc.pages.map((p) => ({
      id: p.id,
      name: p.name,
      components: p.components.map((c) => ({ id: c.id, type: c.type, hidden: c.hidden, props: propsOf(c) })),
    })),
    variables: doc.variables,
    events: doc.events,
    functions: doc.functions,
    timers: doc.timers,
    bindings: doc.bindings,
  };
}

function appUx(): string {
  return `<script>
  /**
   * 应用级别的配置，供所有页面公用。ctx 保存运行时，页面通过 this.$app.$def.ctx 访问。
   */
  /**manifest**/
  export default {
    ctx: { rt: null },
    onCreate() {},
    onShow() {
      var ctx = this.ctx
      if (ctx && ctx.rt && ctx.hidden) {
        ctx.hidden = false
        ctx.rt.system('appResume')
      }
    },
    onHide() {
      var ctx = this.ctx
      if (ctx && ctx.rt) {
        ctx.hidden = true
        ctx.rt.system('appBackground')
      }
    },
  }
</script>
`;
}

function hostJs(doc: ProjectDoc, usesToast: boolean, persisted: ProjectDoc["variables"]): string {
  const imports = [usesToast ? "import prompt from '@blueos.window.prompt'" : "", persisted.length ? "import storage from '@blueos.storage.storage'" : ""]
    .filter(Boolean)
    .join("\n");
  const persist = Object.fromEntries(persisted.map((v) => [v.id, `bw_${v.key}`]));
  const needsSecond =
    doc.timers.length > 0 ||
    doc.events.some((e) => e.trigger.kind === "time" && e.trigger.event === "everySecond") ||
    doc.bindings.some((b) => b.source.kind === "time" && (b.refresh === "second" || /s/.test(b.format ?? "") || b.source.field === "second" || b.source.field.startsWith("timer")));
  const loadVars = persisted.length
    ? `  for (var id in PERSIST) {
    try {
      var raw = storage.getSync({ key: PERSIST[id] })
      if (typeof raw === 'string' && raw !== '') out[id] = JSON.parse(raw)
    } catch (e) {
      console.log('读取保存的变量失败 ' + id)
    }
  }`
    : "";
  const saveVar = persisted.length
    ? `  if (!PERSIST[id]) return
  storage.set({
    key: PERSIST[id],
    value: JSON.stringify(value),
    fail: function (data, code) {
      console.log('保存变量失败 ' + code)
    },
  })`
    : "";
  return HOST_TEMPLATE.replace("__IMPORTS__", imports)
    .replace("__PAGE_URI__", JSON.stringify(Object.fromEntries(doc.pages.map((p) => [p.id, pageUri(p)]))))
    .replace("__PERSIST__", JSON.stringify(persist))
    .replace("__TICK_MS__", String(needsSecond ? 1000 : 10000))
    .replace("__LOAD_VARS__", loadVars)
    .replace("__SAVE_VAR__", saveVar)
    .replace("__TOAST__", usesToast ? "  prompt.showToast({ message: text })" : "  console.log(text)");
}

/** 组件属性 = 组件默认值 + 工程里的值。 */
function propsOf(c: ComponentInstance): Record<string, string | number | boolean> {
  const defaults = (CATALOG_MAP as Record<string, { defaults: Record<string, unknown> } | undefined>)[c.type]?.defaults ?? {};
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(defaults)) if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
  return { ...out, ...c.props };
}

function walk(list: ActionNode[], visit: (a: ActionNode) => void) {
  for (const a of list) {
    visit(a);
    if (a.kind === "if") {
      walk(a.then, visit);
      walk(a.else, visit);
    } else if (a.kind === "repeat" || a.kind === "forEach") walk(a.body, visit);
  }
}

function anyAction(doc: ProjectDoc, test: (a: ActionNode) => boolean): boolean {
  let hit = false;
  const visit = (a: ActionNode) => {
    if (test(a)) hit = true;
  };
  for (const e of doc.events) walk(e.actions, visit);
  for (const f of doc.functions) walk(f.body, visit);
  return hit;
}

/** 运行中可能变化的属性（被绑定或被 setProp 修改），这些属性用数据绑定输出，其余输出为静态样式。 */
function dynamicProps(doc: ProjectDoc): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const add = (id: string, prop: string) => {
    if (!map.has(id)) map.set(id, new Set());
    map.get(id)!.add(prop);
  };
  for (const b of doc.bindings) add(b.componentId, b.prop);
  const visit = (a: ActionNode) => {
    if (a.kind === "setProp") add(a.componentId, a.prop);
  };
  for (const e of doc.events) walk(e.actions, visit);
  for (const f of doc.functions) walk(f.body, visit);
  return map;
}

/** 每个组件需要监听哪些原生事件。 */
function listeners(doc: ProjectDoc, id: string): string[] {
  const events = new Set(doc.events.filter((e) => e.trigger.kind === "component" && e.trigger.componentId === id).map((e) => (e.trigger as { event: string }).event));
  const out: string[] = [];
  if (events.has("click") || events.has("doubleClick")) out.push("click");
  if (events.has("longPress")) out.push("longpress");
  if (events.has("change")) out.push("change");
  const touch = ["touchStart", "touchEnd", "swipeStart", "swiping", "swipeLeft", "swipeRight", "swipeUp", "swipeDown"].some((e) => events.has(e));
  if (touch) out.push("touchstart", "touchmove", "touchend");
  return out;
}

const STYLE_OF: Record<string, (v: string) => string> = {
  color: (v) => `color: ${v}`,
  background: (v) => `background-color: ${v}`,
  fontSize: (v) => `font-size: ${v}px`,
  layerColor: (v) => `layer-color: ${v}`,
  track: (v) => `track-color: ${v}`,
  border: (v) => `border-color: ${v}`,
};

function pageUx(doc: ProjectDoc, page: PageDoc): string {
  const dyn = dynamicProps(doc);
  const initial: Record<string, Record<string, string | number | boolean>> = {};
  const nodes = page.components.map((c) => {
    const props = propsOf(c);
    initial[c.id] = { ...props, visible: !c.hidden };
    const changing = dyn.get(c.id) ?? new Set<string>();
    const bindable = BINDABLE_PROPS[c.type] ?? {};
    const style = [...changing].filter((p) => p in bindable && STYLE_OF[p]).map((p) => STYLE_OF[p](`{{p.${c.id}.${p}}}`));
    const attrs = [`class="${c.id}"`, `show="{{p.${c.id}.visible}}"`];
    if (style.length) attrs.push(`style="${style.join("; ")}"`);
    for (const ev of listeners(doc, c.id)) attrs.push(`on${ev}="handle('${c.id}', '${ev}')"`);
    const a = attrs.join(" ");
    const bind = (prop: string) => `{{p.${c.id}.${prop}}}`;
    switch (c.type) {
      case "text":
      case "number":
      case "time":
        return `    <text ${a}>${bind("text")}</text>`;
      case "button":
        return `    <input ${a} type="button" value="${bind("value")}"></input>`;
      case "image":
        return `    <image ${a} src="${bind("src")}" alt="${attr(String(props.alt ?? "blank"))}"></image>`;
      case "progress":
        return `    <progress ${a} percent="${bind("percent")}" type="${props.progressType === "arc" ? "arc" : "horizontal"}"></progress>`;
      case "switch":
        return `    <switch ${a} checked="${bind("checked")}"></switch>`;
      default:
        return `    <div ${a}></div>`;
    }
  });
  const nav = navMarkup(doc);
  return `<template>
  <!-- 由蓝河工坊生成。组件相对页面绝对定位；显示内容来自运行时（common/host.js）。 -->
  <div class="page">
${nodes.join("\n")}
${nav}
  </div>
</template>

<style>
  .page {
    position: absolute;
    top: 0px;
    left: 0px;
    right: 0px;
    bottom: 0px;
    flex-direction: column;
    background-color: ${page.background};
  }
${page.components.map(cssRule).join("\n")}
${navCss(doc)}
</style>

<script>
  import { runtimeOf, render, pageShow, pageHide, gesture, openPage } from '../../common/host.js'
  var PAGE_ID = ${JSON.stringify(page.id)}

  export default {
    data: {
      p: ${JSON.stringify(initial)},
    },
    onInit() {
      this.p = render(runtimeOf(this), PAGE_ID)
    },
    onShow() {
      pageShow(this, PAGE_ID)
    },
    onHide() {
      pageHide(this, PAGE_ID)
    },
    onDestroy() {
      pageHide(this, PAGE_ID)
    },
    handle(id, kind, evt) {
      gesture(this, PAGE_ID, id, kind, evt)
    },
    goNav(target) {
      openPage(this, PAGE_ID, target)
    },
  }
</script>
`;
}

function navMarkup(doc: ProjectDoc): string {
  if (doc.navigation.kind === "none") return "";
  return doc.navigation.items
    .map((item, i) => `    <input class="nav${i}" type="button" value="${attr(item.label)}" onclick="goNav('${item.pageId}')"></input>`)
    .join("\n");
}

function navCss(doc: ProjectDoc): string {
  if (doc.navigation.kind === "none" || !doc.navigation.items.length) return "";
  const count = doc.navigation.items.length;
  const base = "    height: 52px;\n    background-color: #F5F5F7;\n    color: #1D1D1F;\n    font-size: 20px;\n    border-width: 1px;\n    border-color: #E5E5EA;\n    border-radius: 16px;";
  return doc.navigation.items
    .map((_, i) => {
      if (doc.navigation.kind === "side") return `  .nav${i} {\n    position: absolute;\n    left: 12px;\n    top: ${16 + i * 64}px;\n    width: 108px;\n${base}\n  }`;
      const gap = 8;
      const width = Math.floor((DESIGN_WIDTH - 32 - gap * (count - 1)) / count);
      const top = doc.navigation.kind === "top" ? 12 : 398;
      return `  .nav${i} {\n    position: absolute;\n    left: ${16 + i * (width + gap)}px;\n    top: ${top}px;\n    width: ${width}px;\n${base}\n  }`;
    })
    .join("\n");
}

function cssRule(c: ComponentInstance): string {
  const p = propsOf(c);
  const { x, y, w, h } = c.layout;
  const lines = [`  .${c.id} {`, "    position: absolute;", `    left: ${num(x)}px;`, `    top: ${num(y)}px;`, `    width: ${num(w)}px;`, `    height: ${num(h)}px;`];
  const color = (v: unknown, fallback: string) => (typeof v === "string" && /^#[0-9A-Fa-f]{6}$/.test(v) ? v : fallback);
  switch (c.type) {
    case "text":
    case "number":
    case "time":
      lines.push(`    color: ${color(p.color, "#FFFFFF")};`, `    font-size: ${num(p.fontSize) || 28}px;`);
      lines.push(`    font-weight: ${p.fontWeight === "bold" ? "bold" : "normal"};`);
      lines.push(`    text-align: ${p.textAlign === "center" || p.textAlign === "right" ? p.textAlign : "left"};`);
      if (num(p.lines) > 0) lines.push(`    lines: ${num(p.lines)};`);
      break;
    case "image":
      lines.push(`    object-fit: ${p.objectFit === "contain" || p.objectFit === "fill" ? p.objectFit : "cover"};`);
      break;
    case "button":
      lines.push(`    color: ${color(p.color, "#FFFFFF")};`, `    font-size: ${num(p.fontSize) || 28}px;`, `    background-color: ${color(p.background, "#0071E3")};`);
      lines.push("    border-width: 1px;", `    border-color: ${color(p.background, "#0071E3")};`, `    border-radius: ${num(p.radius)}px;`);
      break;
    case "progress":
      lines.push(`    color: ${color(p.color, "#0071E3")};`, `    layer-color: ${color(p.layerColor, "#E5E5EA")};`);
      break;
    case "switch":
      lines.push(`    thumb-color: ${color(p.thumb, "#FFFFFF")};`, `    track-color: ${color(p.track, "#0071E3")};`);
      break;
    case "divider":
      lines.push(`    background-color: ${color(p.color, "#E5E5EA")};`);
      break;
    case "rect":
    case "column":
    case "row":
      lines.push(`    background-color: ${color(p.background, "#1C1C1E")};`);
      if (c.type !== "rect") lines.push(`    flex-direction: ${c.type === "column" ? "column" : "row"};`);
      lines.push("    border-width: 1px;", `    border-color: ${color(c.type === "rect" ? p.border : p.background, "#1C1C1E")};`, `    border-radius: ${num(p.radius)}px;`);
      break;
    case "circle": {
      const side = Math.min(num(w), num(h));
      lines.push(`    width: ${side}px;`, `    height: ${side}px;`, `    background-color: ${color(p.background, "#0071E3")};`, `    border-radius: ${Math.round(side / 2)}px;`);
      break;
    }
  }
  lines.push("  }");
  return lines.join("\n");
}

function readme(doc: ProjectDoc): string {
  return `# ${doc.project.appName}

由蓝河工坊生成器 ${GENERATOR_VERSION} 从统一工程协议 v2 生成的蓝河源工程。

- \`src/manifest.json\`、\`src/app.ux\`、\`src/pages/<页面>/index.ux\`：官方工程结构。
- \`src/common/project.js\`：工程逻辑（事件、变量、函数、计时器、绑定）。
- \`src/common/engine.js\`：工坊解释器（与网页预览同一份），只解释协议里声明的动作，不执行任意脚本。
- \`src/common/host.js\`：页面与解释器之间的胶水代码（渲染、跳转、计时、手势、持久化变量）。

编译：在工程目录执行官方工具链 \`bot build\`（调试包）或配置签名后 \`bot release\`。

包名 ${doc.project.packageName}，版本 ${doc.manifest.versionName}（${doc.manifest.versionCode}），设备 ${doc.manifest.device}。
`;
}

function attr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function safeFile(name: string): string {
  return name.replace(/[^a-z0-9.]+/gi, "-").replace(/^-|-$/g, "") || "blueos-app";
}
