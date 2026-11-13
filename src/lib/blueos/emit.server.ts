import { createHash } from "node:crypto";
import { validateDsl, type Dsl, type DslComponent, type Issue } from "./model.ts";

export type ArtifactFile = { path: string; text?: string; bytes: number };
export type Artifact =
  | {
      ok: true;
      artifactType: "source_zip";
      compiled: false;
      fileName: string;
      sha256: string;
      zipBase64: string;
      files: ArtifactFile[];
      notes: string[];
      issues: Issue[];
    }
  | { ok: false; issues: Issue[] };

export function buildArtifact(input: unknown): Artifact {
  const { dsl, issues } = validateDsl(input);
  if (!dsl) return { ok: false, issues };
  const files = emitFiles(dsl);
  const zip = zipStore(files.map((file) => ({ path: file.path, data: file.data })));
  return {
    ok: true,
    artifactType: "source_zip",
    compiled: false,
    fileName: `${safeFile(dsl.project.packageName)}.zip`,
    sha256: createHash("sha256").update(zip).digest("hex"),
    zipBase64: toBase64(zip),
    files: files.map((file) => ({
      path: file.path,
      bytes: file.data.length,
      text: file.text,
    })),
    notes: [
      "产物类型是 source_zip：可解压的蓝河源工程，不是 RPK，也不是官方工具链编译结果。",
      "此环境没有运行 BlueOS Studio / Toolkit，不能把这次生成显示为构建成功。",
      "请在 BlueOS Studio 中新建或导入后核对目录、安装依赖，再用官方工具编译。",
      "图标是占位图，不是应用商店要求的 114×114 无白边正式图标。",
    ],
    issues,
  };
}

type BinFile = { path: string; data: Uint8Array; text?: string };

function emitFiles(dsl: Dsl): BinFile[] {
  const text = (path: string, body: string): BinFile => ({
    path,
    text: body,
    data: new TextEncoder().encode(body),
  });
  const entry = dsl.project.startPage || dsl.pages[0]?.name || "Home";
  const usesToast = dsl.pages.some((page) => page.components.some((component) => component.actions.some((action) => action.kind === "toast")));
  const pages: Record<string, { component: string }> = {};
  for (const page of dsl.pages) pages[page.name] = { component: "index" };
  const manifest = {
    package: dsl.project.packageName,
    name: dsl.project.appName,
    icon: "/assets/images/logo.png",
    versionName: "1.0",
    versionCode: 1,
    config: { designWidth: 466 },
    deviceTypeList: dsl.project.deviceType === "watch-square" ? ["watch", "watch-square"] : ["watch", "watch-round"],
    appCategory: ["utilities"],
    display: { backgroundColor: dsl.pages[0]?.background || "#000000" },
    router: { entry, pages },
    features: usesToast ? [{ name: "blueos.window.prompt" }] : ([] as { name: string }[]),
  };
  const files: BinFile[] = [
    text("README.md", readme(dsl)),
    text("GENERATION.json", JSON.stringify({ ...dsl, emittedAt: new Date().toISOString(), artifactType: "source_zip", officialBuild: false }, null, 2) + "\n"),
    text(
      "package.json",
      JSON.stringify(
        {
          name: dsl.project.packageName,
          version: "1.0.0",
          private: true,
          description: "由蓝河工坊生成的源工程骨架。依赖请在 BlueOS Studio 内安装，这里不pin未验证的 SDK。",
        },
        null,
        2,
      ) + "\n",
    ),
    text(
      "jsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: "./", paths: { "@/*": ["src/*"] } } }, null, 2) + "\n",
    ),
    text(
      "build.config.js",
      "module.exports = {\n  resolve: {\n    alias: {\n      '@': './src',\n      '~': './src',\n    },\n  },\n}\n",
    ),
    text("src/manifest.json", JSON.stringify(manifest, null, 2) + "\n"),
    text("src/app.ux", appUx()),
    { path: "src/assets/images/logo.png", data: pngMark(48) },
  ];
  for (const page of dsl.pages) {
    files.push(text(`src/pages/${page.name}/index.ux`, pageUx(page, dsl)));
  }
  return files;
}

function appUx(): string {
  return `<script>
  /**
   * 应用级别的配置，供所有页面公用
   */
  /**manifest**/
  export default {
    onCreate() {},
  }
</script>
`;
}

function pageUx(page: Dsl["pages"][number], dsl: Dsl): string {
  const data: string[] = [];
  const methods: string[] = [];
  const needsRouter =
    dsl.navigation.kind !== "none" ||
    page.components.some((component) => component.actions.some((action) => action.kind === "navigate" || action.kind === "back"));
  const needsPrompt = page.components.some((component) => component.actions.some((action) => action.kind === "toast"));
  for (const variable of dsl.variables) {
    if (variable.scope === "page" && variable.pageId !== page.id) continue;
    if (variable.kind === "number") data.push(`      v_${variable.key}: ${Number(variable.value) || 0},`);
    else if (variable.kind === "boolean") data.push(`      v_${variable.key}: ${variable.value === "true"},`);
    else data.push(`      v_${variable.key}: ${jsString(variable.value)},`);
  }
  const nodes = page.components.map((component) => emitNode(component, data, methods, dsl)).join("\n");
  const nav = navMarkup(dsl, data, methods);
  const dataBody = data.length ? data.join("\n") : "";
  const methodBody = methods.length ? "\n" + methods.join("\n") : "";
  const imports = `${needsRouter ? "  import router from '@blueos.app.appmanager.router'\n" : ""}${needsPrompt ? "  import prompt from '@blueos.window.prompt'\n" : ""}`;
  return `<template>
  <!-- template 只有一个根节点。子组件相对页面绝对定位。 -->
  <div class="page">
${nodes}
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
${navCss(dsl)}
</style>
<script>
${imports}  export default {
    data: {
${dataBody}
    },${methodBody}
  }
</script>
`;
}

function emitNode(component: DslComponent, data: string[], methods: string[], dsl: Dsl): string {
  const id = component.id;
  data.push(`      vis_${id}: ${component.hidden ? "false" : "true"},`);
  const clickable = component.events.click && component.type !== "image";
  const click = clickable ? ` onclick="on_${id}"` : "";
  if (clickable) methods.push(actionMethod(component, dsl));
  const show = ` show="{{vis_${id}}}"`;
  if (component.type === "text" || component.type === "number" || component.type === "time") {
    const raw = String(component.props.text || "");
    const bind = raw.match(/^\$([A-Za-z][A-Za-z0-9_]{0,20})$/);
    if (bind) return `    <text class="${id}"${show}${click}>{{v_${bind[1]}}}</text>`;
    data.push(`      t_${id}: ${jsString(raw)},`);
    return `    <text class="${id}"${show}${click}>{{t_${id}}}</text>`;
  }
  if (component.type === "image") {
    data.push(`      s_${id}: ${jsString(String(component.props.src || ""))},`);
    const alt = jsAttr(String(component.props.alt || "blank"));
    return `    <image class="${id}"${show} src="{{s_${id}}}" alt="${alt}"></image>`;
  }
  if (component.type === "button") {
    data.push(`      b_${id}: ${jsString(String(component.props.value || ""))},`);
    return `    <input class="${id}" type="button" value="{{b_${id}}}"${show}${click}></input>`;
  }
  if (component.type === "progress") {
    const percent = Number(component.props.percent) || 0;
    const kind = component.props.progressType === "arc" ? "arc" : "horizontal";
    return `    <progress class="${id}" percent="${percent}" type="${kind}"${show}${click}></progress>`;
  }
  if (component.type === "switch") {
    data.push(`      k_${id}: ${component.props.checked ? "true" : "false"},`);
    return `    <switch class="${id}" checked="{{k_${id}}}"${show}${click}></switch>`;
  }
  return `    <div class="${id}"${show}${click}></div>`;
}

function actionMethod(component: DslComponent, dsl: Dsl): string {
  const lines = component.actions.map((action) => {
    if (action.kind === "navigate" && action.pageName) return `      router.push({ uri: ${jsString(action.pageName)} })`;
    if (action.kind === "back") return `      router.back()`;
    if (action.kind === "toast") return `      prompt.showToast({ message: ${jsString(action.text || "提示")} })`;
    if (action.kind === "show" && action.nodeId) return `      this.vis_${action.nodeId} = true`;
    if (action.kind === "hide" && action.nodeId) return `      this.vis_${action.nodeId} = false`;
    if (action.kind === "setText" && action.nodeId) {
      const target = dsl.pages.flatMap((page) => page.components).find((item) => item.id === action.nodeId);
      const key = target?.type === "button" ? `b_${action.nodeId}` : `t_${action.nodeId}`;
      return `      this.${key} = ${jsString(action.text || "")}`;
    }
    if (action.kind === "setVar" && /^[A-Za-z][A-Za-z0-9_]{0,20}$/.test(action.varKey)) {
      const variable = dsl.variables.find((item) => item.key === action.varKey);
      if (variable?.kind === "number") return `      this.v_${action.varKey} = ${Number(action.varValue) || 0}`;
      if (variable?.kind === "boolean") return `      this.v_${action.varKey} = ${action.varValue === "true"}`;
      return `      this.v_${action.varKey} = ${jsString(action.varValue || "")}`;
    }
    return "";
  }).filter(Boolean);
  if (!lines.length && component.events.click) lines.push(`      console.log('click ${component.id}')`);
  return `    on_${component.id}() {\n${lines.join("\n")}\n    },`;
}

function navMarkup(dsl: Dsl, data: string[], methods: string[]): string {
  if (dsl.navigation.kind === "none" || !dsl.navigation.items.length) return "";
  return dsl.navigation.items
    .map((item, index) => {
      const id = `nav${index}`;
      data.push(`      ${id}: ${jsString(item.label)},`);
      methods.push(`    go_${id}() {\n      router.push({ uri: ${jsString(item.page)} })\n    },`);
      return `    <input class="${id}" type="button" value="{{${id}}}" onclick="go_${id}"></input>`;
    })
    .join("\n");
}

function navCss(dsl: Dsl): string {
  if (dsl.navigation.kind === "none" || !dsl.navigation.items.length) return "";
  const count = dsl.navigation.items.length;
  return dsl.navigation.items
    .map((_, index) => {
      if (dsl.navigation.kind === "side") {
        return `  .nav${index} {\n    position: absolute;\n    left: 12px;\n    top: ${16 + index * 64}px;\n    width: 108px;\n    height: 52px;\n    background-color: #F5F5F7;\n    color: #1D1D1F;\n    font-size: 20px;\n    border-width: 1px;\n    border-color: #E5E5EA;\n    border-radius: 16px;\n  }`;
      }
      const gap = 8;
      const width = Math.floor((466 - 32 - gap * (count - 1)) / count);
      const left = 16 + index * (width + gap);
      const top = dsl.navigation.kind === "top" ? 12 : 398;
      return `  .nav${index} {\n    position: absolute;\n    left: ${left}px;\n    top: ${top}px;\n    width: ${width}px;\n    height: 52px;\n    background-color: #F5F5F7;\n    color: #1D1D1F;\n    font-size: 20px;\n    border-width: 1px;\n    border-color: #E5E5EA;\n    border-radius: 16px;\n  }`;
    })
    .join("\n");
}

function cssRule(component: DslComponent): string {
  const box = layoutCss(component);
  const lines = [`  .${component.id} {`, ...box];
  const props = component.props;
  const radius = num(props.radius);
  if (component.type === "text" || component.type === "number" || component.type === "time") {
    lines.push(`    color: ${props.color};`);
    lines.push(`    font-size: ${num(props.fontSize)}px;`);
    lines.push(`    font-weight: ${props.fontWeight === "bold" ? "bold" : "normal"};`);
    lines.push(`    text-align: ${props.textAlign === "center" || props.textAlign === "right" ? props.textAlign : "left"};`);
    lines.push(`    lines: ${num(props.lines)};`);
  } else if (component.type === "image") {
    const fit = props.objectFit === "contain" || props.objectFit === "fill" ? props.objectFit : "cover";
    lines.push(`    object-fit: ${fit};`);
  } else if (component.type === "button") {
    lines.push(`    color: ${props.color};`);
    lines.push(`    font-size: ${num(props.fontSize)}px;`);
    lines.push(`    background-color: ${props.background};`);
    lines.push(`    border-width: 1px;`);
    lines.push(`    border-color: ${props.background};`);
    lines.push(`    border-radius: ${radius}px;`);
  } else if (component.type === "progress") {
    lines.push(`    color: ${props.color};`);
    lines.push(`    layer-color: ${props.layerColor};`);
  } else if (component.type === "switch") {
    lines.push(`    thumb-color: ${props.thumb};`);
    lines.push(`    track-color: ${props.track};`);
  } else if (component.type === "divider") {
    lines.push(`    background-color: ${props.color};`);
  } else if (component.type === "rect" || component.type === "column" || component.type === "row") {
    lines.push(`    background-color: ${props.background};`);
    if (component.type === "column") lines.push(`    flex-direction: column;`);
    if (component.type === "row") lines.push(`    flex-direction: row;`);
    lines.push(`    border-width: 1px;`);
    lines.push(`    border-color: ${component.type === "rect" ? props.border : props.background};`);
    lines.push(`    border-radius: ${radius}px;`);
  } else if (component.type === "circle") {
    const side = Math.min(num(component.layout.width), num(component.layout.height));
    lines.push(`    width: ${side}px;`);
    lines.push(`    height: ${side}px;`);
    lines.push(`    background-color: ${props.background};`);
    lines.push(`    border-width: 1px;`);
    lines.push(`    border-color: ${props.background};`);
    lines.push(`    border-radius: ${Math.round(side / 2)}px;`);
  }
  lines.push(`  }`);
  return lines.join("\n");
}

function layoutCss(component: DslComponent): string[] {
  const { x, y, width, height } = component.layout;
  return [
    `    position: absolute;`,
    `    left: ${Math.round(x)}px;`,
    `    top: ${Math.round(y)}px;`,
    `    width: ${Math.round(width)}px;`,
    `    height: ${Math.round(height)}px;`,
  ];
}

function readme(dsl: Dsl): string {
  return `# ${dsl.project.appName}

这是蓝河工坊生成的 **source_zip**，不是 RPK，也没有经过官方编译。

## 目录依据

结构对齐蓝河文档中的工程组织：\`src/app.ux\`、\`src/manifest.json\`、\`src/pages/<页面>/index.ux\`。
页面跳转使用文档中的 \`router.push\` / \`router.back\`（\`@blueos.app.appmanager.router\`）。
提示使用 \`prompt.showToast\`，并在 manifest features 声明 \`blueos.window.prompt\`。
显示和隐藏使用通用属性 \`show\`。官方文档没有已核对的 TabBar 组件，导航是一组 \`input type=button\`。

## 还没做的事

- 没有调用 BlueOS Toolkit，因此没有编译日志，不能视为构建成功。
- \`package.json\` 没有写入未验证的 SDK 依赖。请在 BlueOS Studio 里安装依赖后再编译。
- 布局容器没有嵌套子组件。
- 时间、数字是 text。圆形是 div。
- 侧边导航在圆表上会挤占画面，这是编辑器模拟，不是官方导航组件。
- \`src/assets/images/logo.png\` 只是占位，正式图标需要 114×114、正方形、无白边。

设计宽度 ${dsl.project.designWidth}，设备 ${dsl.project.deviceType}，包名 ${dsl.project.packageName}。
`;
}

function jsString(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

function jsAttr(value: string): string {
  return value.replace(/&/g, "\u0026amp;").replace(/"/g, "\u0026quot;");
}

function num(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function safeFile(name: string): string {
  return name.replace(/[^a-z0-9.]+/gi, "-").replace(/^-|-$/g, "") || "blueos-app";
}

function pngMark(size: number): Uint8Array {
  const raw = new Uint8Array((size * 4 + 1) * size);
  let offset = 0;
  const cx = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cx;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const ring = dist > size * 0.28 && dist < size * 0.4;
      const core = dist <= size * 0.12;
      const rgb = ring || core ? [60, 141, 255] : [12, 18, 24];
      raw[offset++] = rgb[0];
      raw[offset++] = rgb[1];
      raw[offset++] = rgb[2];
      raw[offset++] = 255;
    }
  }
  return encodePng(size, size, raw);
}

function encodePng(width: number, height: number, raw: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = [chunk("IHDR", ihdr), chunk("IDAT", zlibStore(raw)), chunk("IEND", new Uint8Array())];
  const total = signature.length + chunks.reduce((sum, item) => sum + item.length, 0);
  const out = new Uint8Array(total);
  out.set(signature, 0);
  let cursor = signature.length;
  for (const item of chunks) {
    out.set(item, cursor);
    cursor += item.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc);
  return out;
}

function zlibStore(data: Uint8Array): Uint8Array {
  const pieces: Uint8Array[] = [Uint8Array.from([0x78, 0x01])];
  let index = 0;
  while (index < data.length || (index === 0 && data.length === 0)) {
    const size = Math.min(65535, data.length - index);
    const last = index + size >= data.length;
    const header = new Uint8Array(5 + size);
    header[0] = last ? 1 : 0;
    header[1] = size & 255;
    header[2] = size >> 8;
    const nlen = (~size) & 0xffff;
    header[3] = nlen & 255;
    header[4] = nlen >> 8;
    header.set(data.subarray(index, index + size), 5);
    pieces.push(header);
    index += size;
    if (data.length === 0) break;
  }
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  const adler = ((b << 16) | a) >>> 0;
  const tail = new Uint8Array(4);
  new DataView(tail.buffer).setUint32(0, adler);
  pieces.push(tail);
  const total = pieces.reduce((sum, item) => sum + item.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const item of pieces) {
    out.set(item, cursor);
    cursor += item.length;
  }
  return out;
}

export function packStoredZip(files: { path: string; data: Uint8Array }[]): Uint8Array {
  return zipStore(files);
}

function zipStore(files: { path: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.path);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, file.data.length, true);
    view.setUint32(22, file.data.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    locals.push(local, file.data);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, file.data.length, true);
    cv.setUint32(24, file.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length + file.data.length;
  }
  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let cursor = 0;
  for (const item of locals) {
    out.set(item, cursor);
    cursor += item.length;
  }
  for (const item of centrals) {
    out.set(item, cursor);
    cursor += item.length;
  }
  out.set(end, cursor);
  return out;
}

function crc32(data: Uint8Array): number {
  let crc = ~0;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function toBase64(data: Uint8Array): string {
  let text = "";
  const step = 0x8000;
  for (let i = 0; i < data.length; i += step) {
    text += String.fromCharCode(...data.subarray(i, i + step));
  }
  return btoa(text);
}
