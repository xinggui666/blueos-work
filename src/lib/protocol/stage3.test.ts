import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeSample, projectToDsl, validateDsl } from "../blueos/model.ts";
import { docToProject, isNative, legacyForGenerator, logicOf, projectToDoc, toNative } from "./editor.ts";
import { identifiersOf, renameIdentifier } from "./expr.ts";
import { counterDoc } from "./fixtures.ts";
import {
  callGraph,
  cloneAction,
  issueTarget,
  locateRef,
  makeActionNode,
  parseDefault,
  referencesOf,
  renameVariable,
  typesInScope,
  updateAction,
} from "./logic-tools.ts";
import { Runtime } from "./runtime.ts";
import { validateDoc } from "./validate.ts";

describe("原生协议编辑模式", () => {
  it("doc → 原生 project → doc 完全一致（ID、顺序、逻辑都不变）", () => {
    const doc = counterDoc();
    const project = docToProject(doc);
    assert.equal(isNative(project), true);
    assert.equal(project.variables.length, 0);
    assert.equal(project.pages[0].nodes.every((n) => n.actions.length === 0), true);
    assert.deepEqual(projectToDoc(project), doc);
  });
  it("旧 v1 工程 toNative 只转换一次，结果通过校验，再往返不变", () => {
    const legacy = makeSample();
    const native = toNative(legacy);
    assert.equal(isNative(native), true);
    const doc = projectToDoc(native);
    assert.equal(validateDoc(doc).doc !== null, true);
    assert.deepEqual(projectToDoc(toNative(native)), doc);
    assert.deepEqual(projectToDoc(docToProject(doc)), doc);
  });
  it("原生模式下文本里的 $变量 不会再自动生成绑定（删除的绑定不会复活）", () => {
    const doc = counterDoc();
    doc.pages[0].components[1].props.text = "$count";
    doc.bindings = [];
    const back = projectToDoc(docToProject(doc));
    assert.equal(back.bindings.length, 0);
  });
  it("旧生成器仍能拿到可表达的点击动作", () => {
    const doc = counterDoc();
    doc.events.push({
      id: "e-cBtn-longPress",
      enabled: true,
      trigger: { kind: "component", componentId: "cBtn", event: "longPress" },
      actions: [{ id: "aNav", kind: "navigate", pageId: "pTwo" }],
    });
    const legacy = legacyForGenerator(docToProject(doc));
    const btn = legacy.pages[0].nodes.find((n) => n.id === "cBtn")!;
    assert.equal(btn.actions.some((a) => a.kind === "navigate" && a.pageName === "Two"), true);
    // 示例工程（编辑器生成的 ID）转成原生模式后，旧生成器的 DSL 仍然有效。
    const sample = legacyForGenerator(toNative(makeSample()));
    assert.equal(validateDsl(projectToDsl(sample)).dsl !== null, true, JSON.stringify(validateDsl(projectToDsl(sample)).issues));
  });
  it("logicOf 只取逻辑部分", () => {
    const logic = logicOf(docToProject(counterDoc()));
    assert.deepEqual(Object.keys(logic).sort(), ["bindings", "events", "functions", "timers", "variables"]);
  });
});

describe("逻辑编辑工具", () => {
  it("表达式标识符识别与改名不碰字符串、函数名和成员名", () => {
    assert.deepEqual(identifiersOf('count + str(count) + "count" + obj.count'), ["count", "count", "obj"]);
    assert.equal(renameIdentifier('count + str(count) + "count" + obj.count', "count", "n"), 'n + str(n) + "count" + obj.count');
    assert.equal(identifiersOf('"未结束'), null);
  });
  it("变量改名同步所有表达式，被参数遮蔽的函数不改", () => {
    const doc = counterDoc();
    doc.functions.push({
      id: "fShadow",
      name: "shadow",
      params: [{ name: "count", type: "int" }],
      returnType: "int",
      locals: [],
      body: [{ id: "rS", kind: "return", value: "count * 2" }],
      version: 1,
    });
    const next = renameVariable(doc, "vCount", "clicks");
    const all = { ...doc, ...next };
    assert.equal(next.variables[0].key, "clicks");
    assert.equal((next.events[0].actions[0] as { value: string }).value, "clicks + 1");
    assert.equal(next.bindings[0].source.kind === "expr" && next.bindings[0].source.expr, '"次数 " + str(clicks)');
    assert.equal((next.functions[0].body[0] as { value: string }).value, "count * 2");
    assert.equal(validateDoc(all).ok, true, JSON.stringify(validateDoc(all).issues));
  });
  it("引用位置：表达式、触发器、setVar、绑定", () => {
    const doc = counterDoc();
    const refs = referencesOf(doc, doc.variables[0]);
    const paths = refs.map((r) => r.path);
    assert.ok(paths.includes("events.0.actions.0"));
    assert.ok(paths.includes("events.0.actions.0.value"));
    assert.ok(paths.includes("events.1.trigger"));
    assert.ok(paths.includes("bindings.0.source.expr"));
  });
  it("问题定位：路径 → 事件里的嵌套动作；调试记录 ID → 位置", () => {
    const doc = counterDoc();
    doc.events[0].actions.push({ id: "aIf", kind: "if", condition: "count >", then: [{ id: "aDeep", kind: "back" }], else: [] });
    const issue = validateDoc(doc).issues.find((i) => i.path.includes("events.0.actions.1"));
    assert.ok(issue, "应报告表达式错误");
    assert.deepEqual(issueTarget(doc, issue!.path), { kind: "event", id: "eClick", actionId: "aIf" });
    assert.deepEqual(issueTarget(doc, "events.0.actions.1.then.0"), { kind: "event", id: "eClick", actionId: "aDeep" });
    assert.deepEqual(locateRef(doc, "aDeep"), { kind: "event", id: "eClick", actionId: "aDeep" });
    assert.deepEqual(locateRef(doc, "vCount"), { kind: "variable", id: "vCount" });
    assert.deepEqual(issueTarget(doc, "pages.0.components.1.props.text"), { kind: "component", id: "cText", pageId: "pHome" });
  });
  it("作用域：页面变量只在本页可见", () => {
    const doc = counterDoc();
    doc.variables.push({ id: "vLocal", key: "local", type: "string", default: "", scope: "page", ownerId: "pTwo", persist: false });
    assert.equal(typesInScope(doc, "pHome").local, undefined);
    assert.equal(typesInScope(doc, "pTwo").local, "string");
  });
  it("新建动作默认值可通过校验，复制动作全部换新 ID，更新嵌套动作", () => {
    const doc = counterDoc();
    for (const kind of ["navigate", "toast", "show", "toggle", "setProp", "setVar", "if", "repeat", "forEach"] as const) {
      const a = makeActionNode(kind, { doc, pageId: "pHome", componentId: "cText" });
      const next = { ...doc, events: [{ ...doc.events[0], actions: [a] }, doc.events[1]] };
      const errors = validateDoc(next).issues.filter((i) => i.level === "error");
      assert.deepEqual(errors, [], `${kind}: ${JSON.stringify(errors)}`);
    }
    const tree = makeActionNode("if", { doc });
    if (tree.kind !== "if") throw new Error();
    tree.then.push(makeActionNode("back", { doc }));
    const copy = cloneAction(tree);
    assert.notEqual(copy.id, tree.id);
    assert.notEqual((copy as typeof tree).then[0].id, tree.then[0].id);
    const updated = updateAction([tree], tree.then[0].id, () => null);
    assert.equal((updated[0] as typeof tree).then.length, 0);
  });
  it("默认值解析按类型", () => {
    assert.equal(parseDefault("int", "12"), 12);
    assert.equal(parseDefault("int", "1.5"), undefined);
    assert.equal(parseDefault("bool", "true"), true);
    assert.deepEqual(parseDefault("array", "[1,2]"), [1, 2]);
    assert.equal(parseDefault("object", "[1]"), undefined);
  });
  it("调用关系", () => {
    const doc = counterDoc();
    doc.functions.push(
      { id: "fA", name: "a", params: [], returnType: "void", locals: [], body: [{ id: "c1", kind: "call", functionId: "fB", args: {} }], version: 1 },
      { id: "fB", name: "b", params: [], returnType: "void", locals: [], body: [], version: 1 },
    );
    doc.events[0].actions.push({ id: "c2", kind: "call", functionId: "fA", args: {} });
    const g = callGraph(doc);
    assert.deepEqual(g.calls.fA, ["fB"]);
    assert.deepEqual(g.callers.fA, ["eClick"]);
  });
});

describe("调试器运行时接口", () => {
  it("手动触发事件、直接改变量（会触发变量事件）、事件用时、导航", () => {
    const rt = new Runtime(counterDoc(), { now: () => 1_000 });
    rt.start();
    rt.fire("eClick");
    assert.equal(rt.varByKey("count"), 1);
    rt.setVariable("vCount", 3);
    assert.equal(rt.state.props.cTip.visible, true);
    assert.match(rt.state.toast, /到 3 了/);
    assert.ok(rt.trace.some((t) => t.kind === "event" && typeof t.ms === "number"));
    rt.openPage("pTwo");
    assert.equal(rt.state.pageId, "pTwo");
    assert.deepEqual(rt.state.stack, ["pHome"]);
  });
  it("停用的事件手动触发也不执行", () => {
    const doc = counterDoc();
    doc.events[0].enabled = false;
    const rt = new Runtime(doc);
    rt.start();
    rt.fire("eClick");
    assert.equal(rt.varByKey("count"), 0);
    assert.ok(rt.trace.some((t) => t.kind === "warn"));
  });
});
