import assert from "node:assert/strict";
import test from "node:test";
import { accessReason, allows, normalizeCode, roleChangeError, submissionIssues } from "./policy.ts";

test("super admin passes every known permission", () => {
  assert.equal(allows(["super_admin"], "config.write"), true);
  assert.equal(allows(["reviewer"], "config.write"), false);
  assert.equal(allows(["operator"], "orders.confirm"), true);
  assert.equal(allows(["reviewer"], "submissions.review"), true);
});

test("last super admin cannot be removed and others cannot mint one", () => {
  assert.equal(
    roleChangeError({
      actorId: "a",
      actorRoles: ["admin"],
      targetId: "b",
      targetRoles: [],
      role: "super_admin",
      grant: true,
      superAdminCount: 1,
    }),
    "只有超级管理员能变更超级管理员",
  );
  assert.equal(
    roleChangeError({
      actorId: "a",
      actorRoles: ["super_admin"],
      targetId: "a",
      targetRoles: ["super_admin"],
      role: "super_admin",
      grant: false,
      superAdminCount: 1,
    }),
    "至少保留一个超级管理员",
  );
});

test("codes normalize without storing a guessable form", () => {
  assert.equal(normalizeCode(" bh-ab12-cd34 "), "BH-AB12-CD34");
});

test("submission machine checks reject scripts", () => {
  const issues = submissionIssues({
    name: "示例",
    slug: "demo-widget",
    category: "装饰",
    summary: "只是一个目录条目",
    version: "1.2.0",
    schemaText: JSON.stringify({ type: "demo", script: "alert(1)" }),
  });
  assert.ok(issues.some((item) => item.includes("脚本")));
});

test("membership and license access stay closed without entitlement", () => {
  assert.equal(accessReason({ slug: "time", access: "membership", status: "published", name: "时间" }, { member: false, granted: false, staff: false }), "时间需要有效会员");
  assert.equal(accessReason({ slug: "hotspot", access: "license_key", status: "published", name: "热区" }, { member: true, granted: true, staff: false }), null);
  assert.equal(accessReason({ slug: "text", access: "public_free", status: "published", name: "文本" }, { member: false, granted: false, staff: false }), null);
});
