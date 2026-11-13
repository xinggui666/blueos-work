import assert from "node:assert/strict";
import test from "node:test";
import { formatClock, makeAction, makeProject, normalizeProject, runActions, type AppFunction } from "./model.ts";

test("old projects gain function and time fields", () => {
  const project = normalizeProject({ name: "旧工程", functions: undefined, timeBindings: undefined });
  assert.deepEqual(project.functions, []);
  assert.deepEqual(project.timeBindings, []);
  assert.equal(project.pages[0].nodes.length >= 0, true);
});

test("condition skips an action and call runs structured steps", () => {
  const project = makeProject({ name: "逻辑" });
  const fn: AppFunction = {
    id: "fopen",
    name: "openHome",
    steps: [makeAction("toast", { text: "到了" })],
  };
  project.functions = [fn];
  project.variables = [{ id: "v1", key: "flag", kind: "string", value: "no", scope: "app", pageId: "" }];
  const skipped = runActions(project, { pageId: project.startPageId, stack: [], hidden: {}, text: {}, vars: { flag: "no" }, toast: "" }, [
    makeAction("toast", { text: "不应出现", whenKey: "flag", whenValue: "yes" }),
    makeAction("call", { varKey: "openHome" }),
  ]);
  assert.equal(skipped.toast, "到了");
});

test("clock formats stay separate", () => {
  const date = new Date(2026, 0, 4, 9, 5, 7);
  assert.equal(formatClock("time", date), "09:05");
  assert.equal(formatClock("timeSeconds", date), "09:05:07");
  assert.equal(formatClock("date", date), "2026-01-04");
  assert.equal(formatClock("weekday", date), "日");
});
