/**
 * 生成器测试：协议 v2 → 蓝河源工程。
 * 除了检查文件结构，还把生成的 app.ux / host.js / engine.js / 页面脚本放到临时目录，
 * 用桩模块代替 @blueos.* 系统模块，模拟页面生命周期和点击，验证成品里的逻辑真的会执行
 * （count + 1、变量事件、toast、页面跳转、持久化变量）。这不是真机验证。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { counterDoc } from "../protocol/fixtures.ts";
import { makeSample } from "../blueos/model.ts";
import { projectToDoc, toNative } from "../protocol/editor.ts";
import type { ProjectDoc } from "../protocol/schema.ts";
import { generateNative, GENERATOR_VERSION } from "./native.ts";
import { WATCH_RUNTIME } from "./watch-runtime.generated.ts";

const STUBS: Record<string, string> = {
  "@blueos.app.appmanager.router": "router",
  "@blueos.window.prompt": "prompt",
  "@blueos.storage.storage": "storage",
};

/** 把生成的工程写到临时目录，系统模块换成桩，返回 import 入口。 */
async function materialize(doc: ProjectDoc) {
  const out = generateNative(doc);
  assert.equal(out.ok, true, JSON.stringify(!out.ok && out.issues));
  if (!out.ok) throw new Error();
  const dir = mkdtempSync(join(tmpdir(), "bw-gen-"));
  writeFileSync(join(dir, "package.json"), '{"type":"module"}');
  const sys = join(dir, "sys.js");
  writeFileSync(
    sys,
    `export const calls = []
export const store = globalThis.__bwStore || (globalThis.__bwStore = {})
export const router = { push(o) { calls.push(['push', o.uri]) }, back() { calls.push(['back']) } }
export const prompt = { showToast(o) { calls.push(['toast', o.message]) } }
export const storage = { getSync(o) { return store[o.key] === undefined ? '' : store[o.key] }, set(o) { store[o.key] = o.value } }
`,
  );
  for (const f of out.files) {
    if (!f.text) continue;
    let body = f.text;
    if (f.path.endsWith(".ux")) {
      const script = body.slice(body.indexOf("<script>") + 8, body.lastIndexOf("</script>"));
      body = script;
    }
    for (const [mod, name] of Object.entries(STUBS)) body = body.replace(`import ${name} from '${mod}'`, `import { ${name} } from '${pathToFileURL(sys).href}'`);
    const path = join(dir, f.path.replace(/\.ux$/, ".js"));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }
  const imp = async (p: string) => (await import(pathToFileURL(join(dir, p)).href)).default;
  const sysMod = await import(pathToFileURL(sys).href);
  const app = await imp("src/app.js");
  /** 模拟一个页面实例：方法绑定到 vm，$app.$def 指向 app.ux 导出对象。 */
  async function page(name: string) {
    const def = await imp(`src/pages/${name}/index.js`);
    const vm: Record<string, unknown> & { p: Record<string, Record<string, unknown>> } = { $app: { $def: app }, ...structuredClone(def.data) };
    for (const [k, v] of Object.entries(def)) if (typeof v === "function") vm[k] = (v as (...a: unknown[]) => unknown).bind(vm);
    return vm as typeof vm & { onInit(): void; onShow(): void; onHide(): void; handle(id: string, kind: string, evt?: unknown): void };
  }
  return { out, app, page, calls: sysMod.calls as unknown[][], store: sysMod.store as Record<string, unknown> };
}

test("生成文件结构：manifest、app.ux、页面、引擎、逻辑数据", () => {
  const out = generateNative(counterDoc());
  assert.equal(out.ok, true);
  if (!out.ok) return;
  const paths = out.files.map((f) => f.path);
  for (const p of ["src/manifest.json", "src/app.ux", "src/common/engine.js", "src/common/project.js", "src/common/host.js", "src/pages/Home/index.ux", "src/pages/Two/index.ux", "src/assets/images/logo.png"])
    assert.ok(paths.includes(p), p);
  const manifest = JSON.parse(out.files.find((f) => f.path === "src/manifest.json")!.text!);
  assert.equal(manifest.router.entry, "pages/Home");
  assert.deepEqual(Object.keys(manifest.router.pages), ["pages/Home", "pages/Two"]);
  assert.deepEqual(manifest.features, [{ name: "blueos.window.prompt" }]);
  const project = out.files.find((f) => f.path === "src/common/project.js")!.text!;
  assert.ok(project.includes('"count + 1"'), "表达式赋值原样保留，不再被降级丢弃");
  assert.equal(out.files.find((f) => f.path === "src/common/engine.js")!.text, WATCH_RUNTIME + "\n");
  assert.equal(out.generator, GENERATOR_VERSION);
  assert.match(out.sha256, /^[0-9a-f]{64}$/);
  assert.ok(!/(^|[^.\w])eval\(|new Function/.test(WATCH_RUNTIME), "运行时不使用 eval");
});

test("校验不过的工程不生成", () => {
  const doc = counterDoc();
  doc.events[0].trigger = { kind: "component", componentId: "nope", event: "click" };
  const out = generateNative(doc);
  assert.equal(out.ok, false);
});

test("模拟手表页面：点击 count+1、绑定刷新、变量事件弹 toast 并显示组件", async () => {
  const { page, calls } = await materialize(counterDoc());
  const home = await page("Home");
  home.onInit();
  home.onShow();
  assert.equal(home.p.cText.text, "次数 0");
  assert.equal(home.p.cTip.visible, false);
  home.handle("cBtn", "click");
  home.handle("cBtn", "click");
  assert.equal(home.p.cText.text, "次数 2");
  home.handle("cBtn", "click");
  assert.equal(home.p.cText.text, "次数 3");
  assert.equal(home.p.cTip.visible, true);
  assert.deepEqual(calls.filter((c) => c[0] === "toast"), [["toast", "到 3 了"]]);
  home.onHide();
});

test("模拟手表页面：跳转、系统返回同步、持久化变量重启后恢复", async () => {
  const doc = counterDoc();
  doc.variables[0].persist = true;
  doc.events.push({ id: "eGo", enabled: true, trigger: { kind: "component", componentId: "cText", event: "longPress" }, actions: [{ id: "aGo", kind: "navigate", pageId: "pTwo" }] });
  (globalThis as { __bwStore?: unknown }).__bwStore = {};
  const first = await materialize(doc);
  const manifest = JSON.parse(first.out.ok ? first.out.files.find((f) => f.path === "src/manifest.json")!.text! : "{}");
  assert.ok(manifest.features.some((f: { name: string }) => f.name === "blueos.storage.storage"));
  const home = await first.page("Home");
  home.onInit();
  home.onShow();
  home.handle("cBtn", "click");
  assert.equal(first.store.bw_count, "1");
  home.handle("cText", "longpress");
  assert.deepEqual(first.calls.at(-1), ["push", "pages/Two"]);
  home.onHide();
  const two = await first.page("Two");
  two.onInit();
  two.onShow();
  two.onHide();
  // 系统返回手势：运行时没走 back 动作，Home 再次显示时同步回来。
  home.onShow();
  assert.equal((first.app.ctx.rt as { state: { pageId: string; stack: string[] } }).state.pageId, "pHome");
  assert.equal(home.p.cText.text, "次数 1");
  home.onHide();
  // 「重启」：新的 app 对象、新的运行时，从存储恢复 count。
  const second = await materialize(doc);
  const again = await second.page("Home");
  again.onInit();
  assert.equal(again.p.cText.text, "次数 1");
});

test("编辑器示例工程（原生模式）可以直接生成", () => {
  const out = generateNative(projectToDoc(toNative(makeSample())));
  assert.equal(out.ok, true, JSON.stringify(!out.ok && out.issues));
});
