import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deflateRawSync } from "node:zlib";
import { makeSample, projectToDsl, makeProject, makeNode, makeAction } from "../blueos/model.ts";
import { checkExpr, evalExpr, parseExpr, formatTime, EXPR_LIMITS } from "./expr.ts";
import { validateDoc } from "./validate.ts";
import { migrateToCurrent, detectVersion } from "./migrate.ts";
import { docToProject, projectToDoc } from "./editor.ts";
import { inspectBproj, packBproj, contentDigest } from "./bproj.ts";
import { readZip, writeZip, crc32 } from "./zip.ts";
import { Runtime } from "./runtime.ts";
import type { ProjectDoc } from "./schema.ts";
import { counterDoc } from "./fixtures.ts";

const env = (vars: Record<string, unknown> = {}) => ({
  get: (k: string) => vars[k] as never,
  now: () => Date.UTC(2026, 0, 2, 3, 4, 5),
});

function baseDoc(): ProjectDoc {
  const doc = migrateToCurrent(makeSample()).doc;
  assert.ok(doc);
  return structuredClone(doc);
}


describe("表达式", () => {
  it("运算优先级、字符串拼接、比较和条件", () => {
    assert.equal(evalExpr(parseExpr("1 + 2 * 3"), env()), 7);
    assert.equal(evalExpr(parseExpr('"a" + 1'), env()), "a1");
    assert.equal(evalExpr(parseExpr("x > 2 && !(y == 1) ? 10 : 20"), env({ x: 3, y: 2 })), 10);
    assert.equal(evalExpr(parseExpr("round(10 / 4, 1)"), env()), 2.5);
    assert.equal(evalExpr(parseExpr("percent(30, 120)"), env()), 25);
    assert.equal(evalExpr(parseExpr("len([1, 2, 3])"), env()), 3);
  });
  it("时间函数与格式", () => {
    const ts = new Date(2026, 4, 6, 7, 8, 9).getTime();
    assert.equal(formatTime(ts, "YYYY-MM-DD HH:mm:ss"), "2026-05-06 07:08:09");
    assert.equal(formatTime(new Date(2026, 0, 1, 15, 5).getTime(), "A hh:mm"), "下午 03:05");
    assert.equal(evalExpr(parseExpr('formatTime(t, "HH:mm")'), env({ t: ts })), "07:08");
  });
  it("语法错误、未知函数、未知变量、类型错误都能检查出来", () => {
    assert.equal(checkExpr("1 +", { types: {} }).ok, false);
    const unknownFn = checkExpr("eval('1')", { types: {} });
    assert.equal(unknownFn.ok, false);
    assert.match((unknownFn as { error: string }).error, /不支持函数/);
    assert.equal(checkExpr("constructor", { types: {} }).ok, false);
    assert.equal(checkExpr("flag - 1", { types: { flag: "bool" } }).ok, false);
    const ok = checkExpr("count + 1", { types: { count: "int" } });
    assert.equal(ok.ok && ok.type, "int");
  });
  it("复杂度和运行限制", () => {
    assert.throws(() => parseExpr("1+".repeat(300) + "1"), /超过|复杂|嵌套/);
    assert.throws(() => evalExpr(parseExpr("1 / 0"), env()), /除数/);
    assert.throws(() => parseExpr("(".repeat(40) + "1" + ")".repeat(40)), /嵌套|复杂/);
    assert.equal(EXPR_LIMITS.maxLength, 500);
  });
});

describe("Schema 与语义校验", () => {
  it("示例工程迁移后通过校验", () => {
    const res = validateDoc(baseDoc());
    assert.equal(res.ok, true, JSON.stringify(res.issues.filter((i) => i.level === "error")));
  });
  it("计数器工程通过校验", () => {
    const res = validateDoc(counterDoc());
    assert.equal(res.ok, true, JSON.stringify(res.issues));
  });
  it("悬空引用、重复 ID、类型不匹配、依赖缺失会报错", () => {
    const doc = counterDoc();
    doc.events[0].actions.push({ id: "aBad", kind: "navigate", pageId: "pNone" });
    doc.events[0].actions.push({ id: "aInc", kind: "back" });
    doc.bindings.push({
      id: "bBad",
      componentId: "cTip",
      prop: "text",
      source: { kind: "variable", variableId: "vNope" },
    });
    doc.events.push({
      id: "eSet",
      enabled: true,
      trigger: { kind: "page", pageId: "pHome", event: "show" },
      actions: [{ id: "aStr", kind: "setVar", variableId: "vCount", value: '"abc"' }],
    });
    doc.dependencies = [];
    const res = validateDoc(doc);
    assert.equal(res.ok, false);
    const text = res.issues.map((i) => i.message).join("\n");
    assert.match(text, /跳转的页面不存在/);
    assert.match(text, /重复/);
    assert.match(text, /绑定的变量不存在/);
    assert.match(text, /string，这里需要 int/);
    assert.match(text, /缺少组件依赖/);
  });
  it("函数循环调用被拒绝，返回值类型检查", () => {
    const doc = counterDoc();
    doc.functions = [
      {
        id: "fA",
        name: "a",
        params: [],
        returnType: "void",
        locals: [],
        body: [{ id: "c1", kind: "call", functionId: "fB", args: {} }],
        version: 1,
      },
      {
        id: "fB",
        name: "b",
        params: [],
        returnType: "void",
        locals: [],
        body: [{ id: "c2", kind: "call", functionId: "fA", args: {} }],
        version: 1,
      },
      {
        id: "fC",
        name: "c",
        params: [{ name: "n", type: "int" }],
        returnType: "int",
        locals: [],
        body: [{ id: "r1", kind: "return", value: '"x"' }],
        version: 1,
      },
    ];
    const text = validateDoc(doc)
      .issues.map((i) => i.message)
      .join("\n");
    assert.match(text, /循环调用：a → b → a|循环调用：b → a → b/);
    assert.match(text, /string，这里需要 int/);
  });
  it("绑定只允许明确的属性，类型要匹配", () => {
    const doc = counterDoc();
    doc.bindings.push({
      id: "bVis",
      componentId: "cTip",
      prop: "visible",
      source: { kind: "expr", expr: "count > 2" },
    });
    assert.equal(validateDoc(doc).ok, true);
    doc.bindings.push({
      id: "bX",
      componentId: "cTip",
      prop: "onclick",
      source: { kind: "expr", expr: "1" },
    });
    assert.match(
      validateDoc(doc)
        .issues.map((i) => i.message)
        .join(),
      /不能绑定/,
    );
  });
  it("循环次数超过上限报错", () => {
    const doc = counterDoc();
    doc.events[0].actions.push({ id: "aLoop", kind: "repeat", times: "1000", body: [] });
    assert.match(
      validateDoc(doc)
        .issues.map((i) => i.message)
        .join(),
      /循环次数不能超过/,
    );
  });
  it("结构错误给出路径", () => {
    const res = validateDoc({ ...counterDoc(), project: { id: "j1" } });
    assert.equal(res.ok, false);
    assert.ok(res.issues.some((i) => i.path.startsWith("project.")));
  });
});

describe("版本迁移", () => {
  it("识别版本", () => {
    assert.equal(detectVersion(makeSample()), "v1-editor");
    assert.equal(detectVersion(projectToDsl(makeSample())), "v1-dsl");
    assert.equal(detectVersion(counterDoc()), 2);
    assert.equal(detectVersion({ ...counterDoc(), schemaVersion: 99 }), "future");
    assert.equal(detectVersion({ hello: 1 }), "unknown");
  });
  it("v1 编辑器工程：动作转事件、条件转 if、时间绑定和 $变量 文本转绑定", () => {
    const p = makeProject({ name: "旧工程", packageName: "com.old.app" });
    const page = p.pages[0];
    const btn = makeNode("button", 10, 10);
    const label = makeNode("text", 10, 100);
    label.props.text = "第 $n 次";
    btn.actions = [
      makeAction("setVar", { varKey: "n", varValue: "2", whenKey: "n", whenValue: "1" }),
      makeAction("toast", { text: "好 $n" }),
    ];
    page.nodes.push(btn, label);
    p.variables.push({
      id: "vn1234567",
      key: "n",
      kind: "number",
      value: "1",
      scope: "app",
      pageId: "",
    });
    p.timeBindings.push({ id: "tb123456", nodeId: label.id, format: "timeSeconds" });
    const res = migrateToCurrent(p);
    assert.equal(res.ok, true, JSON.stringify(res.issues));
    const doc = res.doc!;
    assert.deepEqual(res.steps, ["v1-editor → v2"]);
    const ev = doc.events.find((e) => e.trigger.kind === "component");
    assert.equal(ev?.actions[0].kind, "if");
    assert.equal(doc.variables[0].type, "int");
    assert.ok(doc.bindings.some((b) => b.source.kind === "time" && b.format === "HH:mm:ss"));
    // 时间绑定优先于文本模板
    assert.equal(doc.bindings.filter((b) => b.componentId === label.id).length, 1);
  });
  it("v1 DSL 迁移", () => {
    const res = migrateToCurrent(projectToDsl(makeSample()));
    assert.equal(res.ok, true, JSON.stringify(res.issues));
    assert.deepEqual(res.steps, ["v1-dsl → v1-editor", "v1-editor → v2"]);
  });
  it("更新版本的工程拒绝打开且不抛异常", () => {
    const res = migrateToCurrent({ ...counterDoc(), schemaVersion: 3 });
    assert.equal(res.ok, false);
    assert.match(res.issues[0].message, /更新版本/);
  });
});

describe("编辑器适配往返", () => {
  it("示例工程 project → doc → project → doc 不变", () => {
    const doc1 = projectToDoc(makeSample());
    const doc2 = projectToDoc(docToProject(doc1));
    assert.deepEqual(doc2, doc1);
  });
  it("编辑器还不能表达的内容（带参函数、计时器、条件事件）往返不丢", () => {
    const doc = counterDoc();
    doc.timers.push({ id: "tCd", name: "倒计时", kind: "countdown", durationSec: 60 });
    doc.functions.push({
      id: "fAdd",
      name: "add",
      params: [
        { name: "a", type: "int" },
        { name: "b", type: "int", default: "1" },
      ],
      returnType: "int",
      locals: [],
      body: [{ id: "rAdd", kind: "return", value: "a + b" }],
      version: 1,
    });
    doc.events[0].condition = "count < 10";
    const back = projectToDoc(docToProject(doc));
    assert.equal(validateDoc(back).ok, true, JSON.stringify(validateDoc(back).issues));
    assert.deepEqual(back.timers, doc.timers);
    assert.deepEqual(back.functions, doc.functions);
    assert.deepEqual(back.events.find((e) => e.id === "eClick")?.condition, "count < 10");
    assert.deepEqual(
      back.events.find((e) => e.id === "eThree"),
      doc.events[1],
    );
    assert.deepEqual(back.bindings, doc.bindings);
  });
  it("编辑器删除组件后，引用它的保留事件和绑定一起移除", () => {
    const doc = counterDoc();
    const project = docToProject(doc);
    project.pages[0].nodes = project.pages[0].nodes.filter((n) => n.id !== "cText");
    const back = projectToDoc(project);
    assert.equal(back.bindings.length, 0);
    assert.equal(validateDoc(back).ok, true);
  });
});

describe(".bproj", () => {
  it("打包、校验、预览", async () => {
    const doc = counterDoc();
    const { bytes, manifest } = await packBproj(doc);
    const preview = await inspectBproj(bytes);
    assert.equal(preview.ok, true, JSON.stringify(preview.issues));
    assert.equal(preview.integrity, "verified");
    assert.equal(preview.contentSha256, manifest.contentSha256);
    assert.equal(preview.summary?.components, 3);
    assert.equal(preview.contentSha256, await contentDigest(doc));
  });
  it("内容被篡改时拒绝导入", async () => {
    const { bytes } = await packBproj(counterDoc());
    const files = await readZip(bytes);
    const project = JSON.parse(new TextDecoder().decode(files["project.json"]));
    project.project.name = "被改了";
    const tampered = writeZip([
      { path: "manifest.json", data: files["manifest.json"] },
      { path: "project.json", data: new TextEncoder().encode(JSON.stringify(project, null, 2)) },
      { path: "README.txt", data: files["README.txt"] },
    ]);
    const preview = await inspectBproj(tampered);
    assert.equal(preview.ok, false);
    assert.equal(preview.integrity, "failed");
  });
  it("旧版工程包（只有 project.json）按旧格式迁移导入", async () => {
    const legacy = writeZip([
      { path: "project.json", data: new TextEncoder().encode(JSON.stringify(makeSample())) },
    ]);
    const preview = await inspectBproj(legacy);
    assert.equal(preview.ok, true, JSON.stringify(preview.issues));
    assert.equal(preview.integrity, "legacy");
    assert.equal(preview.from, "v1-editor");
  });
  it("拒绝路径穿越、损坏文件和非 ZIP", async () => {
    const evil = writeZip([{ path: "../evil.json", data: new Uint8Array([1]) }]);
    assert.match((await inspectBproj(evil)).issues[0].message, /路径不安全/);
    assert.equal((await inspectBproj(new Uint8Array([1, 2, 3]))).ok, false);
    const { bytes } = await packBproj(counterDoc());
    const broken = bytes.slice();
    broken[200] ^= 0xff;
    assert.equal((await inspectBproj(broken)).ok, false);
  });
  it("支持 deflate 压缩的 ZIP（注入解压函数）", async () => {
    const data = new TextEncoder().encode(JSON.stringify(makeSample()));
    const comp = deflateRawSync(data);
    // 手工构造一个 deflate 条目
    const stored = writeZip([{ path: "project.json", data }]);
    const v = new DataView(stored.buffer);
    const out = new Uint8Array(stored.length - data.length + comp.length);
    const head = 30 + "project.json".length;
    out.set(stored.subarray(0, head), 0);
    out.set(comp, head);
    out.set(stored.subarray(head + data.length), head + comp.length);
    const ov = new DataView(out.buffer);
    ov.setUint16(8, 8, true);
    ov.setUint32(18, comp.length, true);
    const cen = head + comp.length;
    ov.setUint16(cen + 10, 8, true);
    ov.setUint32(cen + 20, comp.length, true);
    ov.setUint32(out.length - 22 + 16, cen, true);
    assert.equal(v.getUint32(0, true), 0x04034b50);
    await assert.rejects(readZip(out), /不支持解压/);
    const files = await readZip(out, (x) => new Uint8Array(require_inflate(x)));
    assert.equal(crc32(files["project.json"]), crc32(data));
  });
});

import { inflateRawSync } from "node:zlib";
function require_inflate(x: Uint8Array) {
  return inflateRawSync(x);
}

describe("执行语义（运行时）", () => {
  it("点击 → 变量 → 绑定刷新 → 变量事件 → 显示组件和提示", () => {
    const rt = new Runtime(counterDoc(), { now: () => 0 });
    rt.start();
    assert.equal(rt.resolvedProps("cText").text, "次数 0");
    rt.interact("cBtn", "click");
    rt.interact("cBtn", "click");
    assert.equal(rt.resolvedProps("cText").text, "次数 2");
    assert.equal(rt.visible("cTip"), false);
    rt.interact("cBtn", "click");
    assert.equal(rt.visible("cTip"), true);
    assert.equal(rt.state.toast, "到 3 了");
    assert.ok(rt.trace.some((t) => t.kind === "var" && t.message === "count = 3"));
  });
  it("隐藏的组件和其他页面的组件不响应点击", () => {
    const doc = counterDoc();
    doc.events.push({
      id: "eTip",
      enabled: true,
      trigger: { kind: "component", componentId: "cTip", event: "click" },
      actions: [{ id: "aT", kind: "toast", text: '"x"' }],
    });
    const rt = new Runtime(doc);
    rt.start();
    rt.interact("cTip", "click");
    assert.equal(rt.state.toast, "");
  });
  it("动作出错时停止该事件的后续动作并记录错误", () => {
    const doc = counterDoc();
    doc.events[0].actions = [
      { id: "aDiv", kind: "setVar", variableId: "vCount", value: "count / 0" },
      { id: "aAfter", kind: "toast", text: '"不应执行"' },
    ];
    const rt = new Runtime(doc);
    rt.start();
    rt.interact("cBtn", "click");
    assert.equal(rt.state.toast, "");
    assert.ok(
      rt.trace.some((t) => t.kind === "error" && t.ref === "aDiv" && /除数/.test(t.message)),
    );
  });
  it("函数参数、默认值、返回值和条件分支", () => {
    const doc = counterDoc();
    doc.functions.push({
      id: "fClamp",
      name: "step",
      params: [
        { name: "x", type: "int" },
        { name: "d", type: "int", default: "5" },
      ],
      returnType: "int",
      locals: [{ name: "r", type: "int" }],
      body: [
        { id: "s1", kind: "setLocal", name: "r", value: "x + d" },
        {
          id: "i1",
          kind: "if",
          condition: "r > 12",
          then: [{ id: "r1", kind: "return", value: "12" }],
          else: [],
        },
        { id: "r2", kind: "return", value: "r" },
      ],
      version: 1,
    });
    doc.events[0].actions = [
      {
        id: "cStep",
        kind: "call",
        functionId: "fClamp",
        args: { x: "count" },
        resultVariableId: "vCount",
      },
    ];
    assert.equal(validateDoc(doc).ok, true, JSON.stringify(validateDoc(doc).issues));
    const rt = new Runtime(doc);
    rt.start();
    rt.interact("cBtn", "click");
    rt.interact("cBtn", "click");
    assert.equal(rt.varByKey("count"), 10);
    rt.interact("cBtn", "click");
    assert.equal(rt.varByKey("count"), 12);
    assert.equal(rt.call("fClamp", { x: "1", d: "1" }), 2);
  });
  it("变量连锁循环被限制，不会卡死", () => {
    const doc = counterDoc();
    doc.events.push({
      id: "eLoop",
      enabled: true,
      trigger: { kind: "variable", variableId: "vCount", event: "change" },
      actions: [{ id: "aLoopInc", kind: "setVar", variableId: "vCount", value: "count + 1" }],
    });
    assert.ok(validateDoc(doc).issues.some((i) => i.level === "warn" && /循环/.test(i.message)));
    const rt = new Runtime(doc);
    rt.start();
    rt.interact("cBtn", "click");
    assert.ok((rt.varByKey("count") as number) <= 10);
    assert.ok(rt.trace.some((t) => t.kind === "warn" && /连锁/.test(t.message)));
  });
  it("运行时也限制函数递归深度（防御绕过校验的数据）", () => {
    const doc = counterDoc();
    doc.functions.push({
      id: "fR",
      name: "r",
      params: [],
      returnType: "void",
      locals: [],
      body: [{ id: "cR", kind: "call", functionId: "fR", args: {} }],
      version: 1,
    });
    doc.events[0].actions = [{ id: "cTop", kind: "call", functionId: "fR", args: {} }];
    const rt = new Runtime(doc);
    rt.start();
    rt.interact("cBtn", "click");
    assert.ok(rt.trace.some((t) => t.kind === "error" && /超过 8 层/.test(t.message)));
  });
  it("防重复触发", () => {
    let now = 1000;
    const doc = counterDoc();
    doc.events[0].throttleMs = 500;
    const rt = new Runtime(doc, { now: () => now });
    rt.start();
    rt.interact("cBtn", "click");
    rt.interact("cBtn", "click");
    now += 600;
    rt.interact("cBtn", "click");
    assert.equal(rt.varByKey("count"), 2);
  });
  it("倒计时结束触发事件，计时器绑定显示剩余时间和百分比", () => {
    let now = 0;
    const doc = counterDoc();
    doc.timers.push({ id: "tCd", name: "倒计时", kind: "countdown", durationSec: 90 });
    doc.bindings.push({
      id: "bLeft",
      componentId: "cTip",
      prop: "text",
      source: { kind: "time", field: "timerRemaining", timerId: "tCd" },
      format: "mm:ss",
    });
    doc.events[0].actions = [{ id: "aStart", kind: "startTimer", timerId: "tCd" }];
    doc.events.push({
      id: "eEnd",
      enabled: true,
      trigger: { kind: "time", event: "timerEnd", timerId: "tCd" },
      actions: [{ id: "aEnd", kind: "toast", text: '"时间到"' }],
    });
    assert.equal(validateDoc(doc).ok, true, JSON.stringify(validateDoc(doc).issues));
    const rt = new Runtime(doc, { now: () => now });
    rt.start();
    rt.interact("cBtn", "click");
    now = 30_000;
    rt.tick(now);
    assert.equal(rt.resolvedProps("cTip").text, "01:00");
    now = 91_000;
    rt.tick(now);
    assert.equal(rt.state.toast, "时间到");
    assert.equal(rt.resolvedProps("cTip").text, "00:00");
  });
  it("每分钟时间事件和指定时刻触发；时间绑定格式化", () => {
    const start = new Date(2026, 0, 1, 8, 59, 30).getTime();
    let now = start;
    const doc = counterDoc();
    doc.events.push({
      id: "eMin",
      enabled: true,
      trigger: { kind: "time", event: "everyMinute" },
      actions: [{ id: "aM", kind: "setVar", variableId: "vCount", value: "count + 1" }],
    });
    doc.events.push({
      id: "eAt",
      enabled: true,
      trigger: { kind: "time", event: "at", at: "09:00" },
      actions: [{ id: "aAt", kind: "toast", text: '"九点"' }],
    });
    doc.bindings[0] = {
      id: "bText",
      componentId: "cText",
      prop: "text",
      source: { kind: "time", field: "now" },
      format: "HH:mm",
    };
    const rt = new Runtime(doc, { now: () => now });
    rt.start();
    now = start + 40_000;
    rt.tick(now);
    assert.equal(rt.varByKey("count"), 1);
    assert.equal(rt.state.toast, "九点");
    assert.equal(rt.resolvedProps("cText").text, "09:00");
  });
  it("页面事件顺序：load/show，跳转 hide，返回 exit", () => {
    const doc = counterDoc();
    const log = (id: string, text: string) => ({
      id,
      kind: "log" as const,
      text: JSON.stringify(text),
    });
    doc.events.push(
      {
        id: "eL",
        enabled: true,
        trigger: { kind: "page", pageId: "pTwo", event: "load" },
        actions: [log("l1", "load")],
      },
      {
        id: "eS",
        enabled: true,
        trigger: { kind: "page", pageId: "pTwo", event: "show" },
        actions: [log("l2", "show")],
      },
      {
        id: "eH",
        enabled: true,
        trigger: { kind: "page", pageId: "pTwo", event: "hide" },
        actions: [log("l3", "hide")],
      },
      {
        id: "eX",
        enabled: true,
        trigger: { kind: "page", pageId: "pTwo", event: "exit" },
        actions: [log("l4", "exit")],
      },
    );
    doc.events[0].actions = [{ id: "aGo", kind: "navigate", pageId: "pTwo" }];
    doc.events.push({
      id: "eBack",
      enabled: true,
      trigger: { kind: "system", event: "appResume" },
      actions: [{ id: "aB", kind: "back" }],
    });
    const rt = new Runtime(doc);
    rt.start();
    rt.interact("cBtn", "click");
    assert.equal(rt.state.pageId, "pTwo");
    rt.system("appResume");
    assert.equal(rt.state.pageId, "pHome");
    const logs = rt.trace
      .filter((t) => t.message.startsWith("日志"))
      .map((t) => t.message.slice(3));
    assert.deepEqual(logs, ["load", "show", "hide", "exit"]);
  });
});
