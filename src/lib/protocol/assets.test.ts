import { deflateRawSync, inflateRawSync } from "node:zlib";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { iconPng } from "../generator/png.ts";
import { counterDoc } from "./fixtures.ts";
import { packBproj, inspectBproj } from "./bproj.ts";
import { browserInflate, readZip, writeZip } from "./zip.ts";
import { generateNative } from "../generator/native.ts";
import { pngInfo } from "./assets.ts";
function fixture() {
  const data = iconPng(16),
    sha256 = createHash("sha256").update(data).digest("hex"),
    doc = counterDoc();
  const asset = {
    id: "asset1",
    kind: "image" as const,
    path: `assets/${sha256}.png`,
    sha256,
    bytes: data.length,
    mime: "image/png",
  };
  doc.assets = [asset];
  return { data, doc, asset, files: { [asset.path]: data } };
}
test("PNG actual bytes survive bproj pack/inspect with digest", async () => {
  const f = fixture(),
    packed = await packBproj(f.doc, 1, f.files),
    preview = await inspectBproj(packed.bytes);
  assert.equal(preview.ok, true, JSON.stringify(preview.issues));
  assert.deepEqual(preview.assetFiles?.[f.asset.path], f.data);
  assert.equal(packed.manifest.files[f.asset.path].sha256, f.asset.sha256);
});
test("metadata-only and tampered resources must not export", async () => {
  const f = fixture();
  await assert.rejects(packBproj(f.doc), /缺失/);
  const data = f.data.slice();
  data[20] ^= 1;
  await assert.rejects(packBproj(f.doc, 1, { [f.asset.path]: data }), /PNG/);
  f.doc.assets[0].sha256 = "0".repeat(64);
  await assert.rejects(packBproj(f.doc, 1, f.files), /SHA-256/);
});
test("import rejects missing resource even if project digest is valid", async () => {
  const f = fixture(),
    packed = await packBproj(f.doc, 1, f.files),
    files = await readZip(packed.bytes);
  delete files[f.asset.path];
  const result = await inspectBproj(
    writeZip(Object.entries(files).map(([path, data]) => ({ path, data }))),
  );
  assert.equal(result.ok, false);
  assert.match(result.issues[0].message, /缺失/);
});
test("native source must copy real resource bytes and fail without bytes", () => {
  const f = fixture();
  assert.equal(generateNative(f.doc).ok, false);
  const out = generateNative(f.doc, f.files);
  assert.equal(out.ok, true);
  if (out.ok)
    assert.deepEqual(out.files.find((x) => x.path === `src/${f.asset.path}`)?.data, f.data);
});
test("legacy asset-free bproj remains importable", async () => {
  const packed = await packBproj(counterDoc(), 1);
  assert.equal((await inspectBproj(packed.bytes)).ok, true);
});
test("ZIP duplicate files and traversal are rejected", async () => {
  const data = new Uint8Array([1]);
  await assert.rejects(
    readZip(
      writeZip([
        { path: "a", data },
        { path: "a", data },
      ]),
    ),
    /重复/,
  );
  await assert.rejects(readZip(writeZip([{ path: "../escape", data }])), /不安全/);
});
test("PNG headers, CRC, truncation and active SVG rejected", () => {
  assert.throws(() => pngInfo(new TextEncoder().encode('<svg onload="bad()"/>')), /PNG/);
  const f = fixture();
  assert.throws(() => pngInfo(f.data.subarray(0, f.data.length - 1)), /PNG/);
  const corrupt = f.data.slice();
  corrupt[30] ^= 1;
  assert.throws(() => pngInfo(corrupt), /PNG/);
});

test("lying ZIP size cannot bypass bounded server or browser decompression",async()=>{
 const compressed=deflateRawSync(new Uint8Array(5*1024*1024));
 const zip=writeZip([{path:"bomb",data:compressed}]),view=new DataView(zip.buffer);
 let central=-1;for(let p=0;p<zip.length-4;p++)if(view.getUint32(p,true)===0x02014b50){central=p;break;}
 view.setUint16(central+10,8,true);view.setUint32(central+24,1,true);
 await assert.rejects(readZip(zip,data=>new Uint8Array(inflateRawSync(data,{maxOutputLength:4*1024*1024}))));
 await assert.rejects(readZip(zip,browserInflate),/限制/);
});
test("bproj rejects future manifest version, malformed checksum records and hidden scripts",async()=>{
 const packed=await packBproj(counterDoc(),1),files=await readZip(packed.bytes);
 const rewrite=async(manifest:unknown)=>inspectBproj(writeZip(Object.entries({...files,"manifest.json":new TextEncoder().encode(JSON.stringify(manifest))}).map(([path,data])=>({path,data}))));
 const manifest=JSON.parse(new TextDecoder().decode(files["manifest.json"]));
 assert.equal((await rewrite({...manifest,version:99})).ok,false);
 assert.equal((await rewrite({...manifest,files:{"project.json":null}})).ok,false);
 const extra=await inspectBproj(writeZip([...Object.entries(files).map(([path,data])=>({path,data})),{path:"script.js",data:new Uint8Array([1])}]));assert.equal(extra.ok,false);
});
