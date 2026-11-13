import assert from "node:assert/strict";
import test from "node:test";
import { inRollout, keysCsv, sniffImage } from "./admin-rules.ts";
import { accessReason } from "./policy.ts";

test("资源文件按文件头判断类型，SVG 和伪造扩展名被拒绝", () => {
  assert.equal(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')), null);
  assert.equal(sniffImage(new TextEncoder().encode("GIF89a")), null);
});

test("卡密安全清单不含明文，并防 CSV 公式注入", () => {
  const csv = keysCsv([{ id: "k1", hint: "BH-ABCD****", type: "quota", status: "used", expiresAt: null, usedBy: "=HYPERLINK(1)", usedAt: "2026-01-01T00:00:00.000Z" }]);
  assert.match(csv, /^id,hint,type,status,expires_at,used_by,used_at\n/);
  assert.ok(csv.includes("'=HYPERLINK(1)"));
  assert.ok(!/BH-[A-Z2-9]{4}-[A-Z2-9]{4}/.test(csv));
});

test("灰度：100% 全量，0% 不推；同一用户结果稳定；比例大致符合", () => {
  assert.equal(inRollout("r1", 100, ""), true);
  assert.equal(inRollout("r1", 0, "u1"), false);
  assert.equal(inRollout("r1", 50, ""), false);
  assert.equal(inRollout("r1", 30, "user-a"), inRollout("r1", 30, "user-a"));
  let hit = 0;
  for (let i = 0; i < 2000; i++) if (inRollout("r1", 30, `u${i}`)) hit++;
  assert.ok(hit > 450 && hit < 750, String(hit));
});

test("套餐限定组件分类：其他分类的会员组件不可用，授权组件不受影响", () => {
  const row = { slug: "time", access: "membership", status: "published", name: "时间", category: "数据" };
  assert.equal(accessReason(row, { member: true, granted: false, staff: false }), null);
  assert.equal(accessReason(row, { member: true, granted: false, staff: false, memberCategories: ["数据"] }), null);
  assert.match(accessReason(row, { member: true, granted: false, staff: false, memberCategories: ["交互"] }) ?? "", /不在当前套餐/);
  assert.equal(accessReason(row, { member: true, granted: true, staff: false, memberCategories: ["交互"] }), null);
  assert.match(accessReason(row, { member: false, granted: false, staff: false }) ?? "", /需要有效会员/);
});
