import assert from "node:assert/strict";
import test from "node:test";
import { formatClock, freeSpot, makeAction, makeProject, normalizeProject, runActions, type AppFunction } from "./model.ts";

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

test("新组件放置：连续加入的组件互不重叠，并且在圆表可见区域内", () => {
  {
    const nodes: { x: number; y: number; w: number; h: number; hidden: boolean }[] = [];
    for (let i = 0; i < 6; i++) {
      const spot = freeSpot(nodes, 220, 48, { round: true });
      for (const n of nodes) {
        const overlap = spot.x < n.x + n.w && n.x < spot.x + 220 && spot.y < n.y + n.h && n.y < spot.y + 48;
        assert.equal(overlap, false, `第 ${i + 1} 个和已有组件重叠`);
      }
      for (const [px, py] of [
        [spot.x, spot.y],
        [spot.x + 220, spot.y + 48],
      ])
        assert.ok(Math.hypot(px - 233, py - 233) <= 233, "超出圆表可见区域");
      nodes.push({ ...spot, w: 220, h: 48, hidden: false });
    }
    // 第一个放在正中间附近。
    assert.ok(Math.abs(nodes[0].x - 123) <= 8 && Math.abs(nodes[0].y - 209) <= 8);
  }
});

test("新组件放置：画面放满时选重叠最少的位置，不会叠在同一个点", () => {
  const nodes: { x: number; y: number; w: number; h: number; hidden: boolean }[] = [];
  const spots = new Set<string>();
  for (let i = 0; i < 12; i++) {
    const spot = freeSpot(nodes, 220, 48, { round: true });
    spots.add(`${spot.x},${spot.y}`);
    nodes.push({ ...spot, w: 220, h: 48, hidden: false });
  }
  assert.equal(spots.size, 12);
});
