/** 产物检查：源工程 zip 不能冒充 RPK；路径穿越的 zip 直接拒绝。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { counterDoc } from "../protocol/fixtures.ts";
import { generateNative } from "./native.ts";
import { readZipEntries, verifyRpk } from "../../../worker/rpk.mjs";

type Check = { name: string; ok: boolean };

test("源工程 zip 不能通过 RPK 产物检查", () => {
  const out = generateNative(counterDoc());
  assert.ok(out.ok);
  if (!out.ok) return;
  const result = verifyRpk(Buffer.from(out.zip), { packageName: "com.example.counter", versionCode: 1, versionName: "1.0", mode: "release", routes: ["pages/main"] });
  assert.equal(result.ok, false);
  const failed = (result.checks as Check[]).filter((c) => !c.ok).map((c) => c.name);
  assert.ok(failed.includes("签名证书 META-INF/CERT"), failed.join(","));
  assert.ok(failed.includes("页面代码包 .vru"), failed.join(","));
});

test("条目路径带 .. 的 zip 被拒绝", () => {
  const name = Buffer.from("../evil.txt");
  const data = Buffer.from("x");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(1, 18);
  local.writeUInt32LE(1, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(1, 20);
  central.writeUInt32LE(1, 24);
  central.writeUInt16LE(name.length, 28);
  const cdOffset = 30 + name.length + 1;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + name.length, 12);
  end.writeUInt32LE(cdOffset, 16);
  const zip = Buffer.concat([local, name, data, central, name, end]);
  assert.throws(() => readZipEntries(zip), /路径|path|\.\./i);
});
