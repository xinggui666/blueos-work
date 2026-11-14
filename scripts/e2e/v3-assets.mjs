#!/usr/bin/env node
/** Local PostgreSQL + real HTTP + Chromium acceptance; no APK/watch claims. */
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import pg from "pg";
import { chromium } from "playwright";
import { iconPng } from "../../src/lib/generator/png.ts";
import { counterDoc } from "../../src/lib/protocol/fixtures.ts";
import { computeDependencies } from "../../src/lib/protocol/validate.ts";
import {packBproj} from "../../src/lib/protocol/bproj.ts";
import { crc32, readZip, writeZip } from "../../src/lib/protocol/zip.ts";
const OUT=process.env.ASSET_EVIDENCE_DIR||"docs/v3/evidence-assets";mkdirSync(`${OUT}/rpk`,{recursive:true});
const BASE = process.env.API_BASE || "http://localhost:4020",
  DATABASE_URL = process.env.DATABASE_URL;
if (
  !DATABASE_URL ||
  !["localhost", "127.0.0.1"].includes(new URL(BASE).hostname) ||
  !new URL(DATABASE_URL).pathname.startsWith("/blueos_v3_assets")
)
  throw Error("disposable local resource database only");
const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
const tag = Date.now().toString(36),
  password = randomBytes(24).toString("hex");
let passed = 0;
async function step(name, fn) {
  await fn();
  console.log("PASS", name);
  passed++;
}
async function req(path, body, token) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    status: r.status,
    body: await r.json(),
    cookies: r.headers.getSetCookie(),
    token: r.headers.get("set-auth-token"),
  };
}
async function account(label) {
  const email = `resource-${label}-${tag}@tests.invalid`;
  const s = await req("/api/auth/sign-up/email", { name: "资源验收", email, password });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const login = await req("/api/auth/sign-in/email", { email, password });
  assert.equal(login.status, 200);
  const a = { id: s.body.user.id, email, ...login };
  await api(a, "me");
  return a;
}
async function api(user, action, payload = {}) {
  return req("/api/v1/platform", { action, payload, client: "web" }, user?.token);
}
const upload = (a, data, mime = "image/png", extra = {}) =>
  api(a, "uploadAsset", { mime, fileBase64: Buffer.from(data).toString("base64"), ...extra });
let a, b, c, asset, largeAsset, projectId, doc, bundle;
let browser;
try {
  await step(
    "signup does not auto-promote admin; binary actions require authentication",
    async () => {
      a = await account("a");
      b = await account("b");
      c = await account("quota");
      assert.equal(
        (
          await db.query("select count(*)::int n from user_roles where user_id=any($1)", [
            [a.id, b.id, c.id],
          ])
        ).rows[0].n,
        0,
      );
      assert.equal((await api(null, "uploadAsset")).status, 401);
    },
  );
  await step("actual PNG upload, SHA, owner read and per-owner dedupe", async () => {
    const bytes = iconPng(32),
      r = await upload(a, bytes);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    asset = r.body.asset;
    assert.equal(asset.sha256, createHash("sha256").update(bytes).digest("hex"));
    const before = (await api(a, "assetUsage")).body;
    await Promise.all([upload(a, bytes), upload(a, bytes)]);
    assert.deepEqual((await api(a, "assetUsage")).body, before);
    const read = await api(a, "getAsset", { sha256: asset.sha256 });
    assert.equal(read.status, 200);
    assert.deepEqual(Buffer.from(read.body.fileBase64, "base64"), Buffer.from(bytes));
    assert.equal((await api(b, "getAsset", { sha256: asset.sha256 })).status, 404);
  });
  await step(
    "wrong MIME/SVG/digest/corrupt header/oversize rejected without storage changes",
    async () => {
      const before = (await api(a, "assetUsage")).body;
      for (const [data, mime, extra] of [
        [iconPng(16), "image/jpeg", {}],
        [new TextEncoder().encode("<svg/>"), "image/png", {}],
        [iconPng(16), "image/png", { sha256: "0".repeat(64) }],
        [new Uint8Array(2 * 1024 * 1024 + 1), "image/png", {}],
      ])
        assert.equal((await upload(a, data, mime, extra)).status, 400);
      const chunk=(type,payload)=>{const out=Buffer.alloc(payload.length+12);out.writeUInt32BE(payload.length);out.write(type,4);Buffer.from(payload).copy(out,8);out.writeUInt32BE(crc32(out.subarray(4,-4)),out.length-4);return out;};
      const png=iconPng(1),bomb=Buffer.concat([png.subarray(0,33),chunk("IDAT",deflateSync(new Uint8Array(5*1024*1024))),chunk("IEND",Buffer.alloc(0))]);
      assert.equal((await upload(a,bomb)).status,400);
      assert.deepEqual((await api(a, "assetUsage")).body, before);
    },
  );
  await step(
    "real PNG larger than normal 1MB API budget succeeds via bounded binary action",
    async () => {
      const data = iconPng(600);
      assert.ok(data.length > 1_000_000);
      const r = await upload(a, data);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      largeAsset=r.body.asset;
    },
  );
  await step(
    "cloud save checks owner resources and rejects undeclared/remote image paths",
    async () => {
      doc = counterDoc();
      doc.project.id = `asset${tag}`;
      doc.assets = [asset,largeAsset];
      doc.pages[0].components.push({
        ...doc.pages[0].components[0],
        id: "resource_image",
        name: "资源图片",
        type: "image",
        props: { src: `/${asset.path}`, objectFit: "contain", alt: "blank" },
        layout: { x: 20, y: 200, w: 100, h: 100 },
      });
      doc.dependencies = computeDependencies(doc);
      const foreign = structuredClone(doc);
      foreign.project.id = `foreign${tag}`;
      assert.equal((await api(b, "saveProjectDoc", { doc: foreign, baseRevision: 0 })).status, 400);
      const external = structuredClone(doc);
      external.project.id = `external${tag}`;
      external.pages[0].components.at(-1).props.src = "https://localhost/private";
      assert.equal(
        (await api(a, "saveProjectDoc", { doc: external, baseRevision: 0 })).status,
        400,
      );
      const saved = await api(a, "saveProjectDoc", { doc, baseRevision: 0 });
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      projectId = doc.project.id;
    },
  );
  await step(
    "bproj includes exact PNG bytes; repeat download idempotent; fixed revision gate rejects stale",
    async () => {
      await db.query(
        "insert into quota_accounts(user_id,kind,balance) values($1,'export',5) on conflict(user_id,kind) do update set balance=5",
        [a.id],
      );
      const loaded = (await api(a, "getProjectDoc", { projectId })).body;
      const input = {
        projectId,
        expectedRevision: loaded.revision,
        expectedContentSha256: loaded.contentSha256,
      };
      // Keep real server API field names (expectedRevision/contentSha256 from delivery contract).
      const r = await api(a, "exportBundle", input);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      bundle = Buffer.from(r.body.zipBase64, "base64");
      assert.ok(bundle.length>1_000_000,"real large bproj crosses normal API transport cap");
      assert.deepEqual(Buffer.from((await readZip(bundle))[asset.path]), Buffer.from(iconPng(32)));
      assert.equal((await api(a, "exportBundle", input)).body.reused, true);
      assert.equal(
        (
          await db.query("select balance from quota_accounts where user_id=$1 and kind='export'", [
            a.id,
          ])
        ).rows[0].balance,
        4,
      );
      assert.equal((await api(a, "exportBundle", { ...input, expectedRevision: 999 })).status, 409);
    },
  );
  await step(
    "cross-account bproj import transfers actual bytes atomically, original untouched",
    async () => {
      const r = await api(b, "importBundle", {
        fileBase64: bundle.toString("base64"),
        mode: "copy",
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.notEqual(r.body.projectId, projectId);
      assert.deepEqual(
        Buffer.from((await api(b, "getAsset", { sha256: asset.sha256 })).body.fileBase64, "base64"),
        Buffer.from(iconPng(32)),
      );
      const again = await api(b, "importBundle", { fileBase64: bundle.toString("base64") });
      assert.equal(again.body.duplicate, true);
    },
  );
  await step(
    "missing, undeclared, duplicate, traversal, corrupt binary packages reject with no new projects",
    async () => {
      const files = await readZip(bundle),
        before = (await api(b, "listProjects")).body.length;
      const entries = Object.entries(files).map(([path, data]) => ({ path, data }));
      for (const changed of [
        entries.filter((e) => e.path !== asset.path),
        [...entries, { path: "surprise.js", data: new Uint8Array([1]) }],
        [...entries, entries[0]],
        [...entries, { path: "../escape", data: new Uint8Array([1]) }],
      ]) {
        const r = await api(b, "importBundle", {
          fileBase64: Buffer.from(writeZip(changed)).toString("base64"),
          mode: "copy",
        });
        assert.equal(r.status, 400, JSON.stringify(r.body));
      }
      assert.equal((await api(b, "listProjects")).body.length, before);
    },
  );
  await step(
    "quota concurrency serialized; failed import rolls back previously inserted resource bytes",
    async () => {
      await db.query(
        "insert into memberships(id,user_id,plan_id,snapshot,starts_at,ends_at,source) values($1,$2,'fixture',$3::jsonb,now()-interval '1 day',now()+interval '1 day','fixture')",
        [
          `mem${tag}`,
          c.id,
          JSON.stringify({ storageMb: 1, projectLimit: 20, concurrency: 1, priority: 0 }),
        ],
      );
      const results = await Promise.all([upload(c, iconPng(400)), upload(c, iconPng(401))]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 413]);
      const usage = (await api(c, "assetUsage")).body;
      assert.ok(usage.bytes <= usage.limitBytes);
      const beforeAssets = (
        await db.query("select count(*)::int n from project_binary_assets where user_id=$1", [c.id])
      ).rows[0].n;
      const quotaImport=await api(c,"importBundle",{fileBase64:bundle.toString("base64"),mode:"copy"});
      assert.equal(quotaImport.status,413,JSON.stringify(quotaImport.body));
      assert.equal((await db.query("select count(*)::int n from project_binary_assets where user_id=$1",[c.id])).rows[0].n,beforeAssets);
      await db.query(
        "insert into projects(id,user_id,name,app_name,package_name,device,body) select 'cap'||$1||n,$1,'fixture','fixture','com.fixture.app','watch-round','{}'::jsonb from generate_series(1,20) n",
        [c.id],
      );
      const smallDoc=structuredClone(doc);smallDoc.assets=[asset];
      const smallBundle=await packBproj(smallDoc,1,{[asset.path]:iconPng(32)});
      const imported = await api(c, "importBundle", {
        fileBase64: Buffer.from(smallBundle.bytes).toString("base64"),
        mode: "copy",
      });
      assert.equal(imported.status, 403, JSON.stringify(imported.body));
      assert.equal(
        (
          await db.query("select count(*)::int n from project_binary_assets where user_id=$1", [
            c.id,
          ])
        ).rows[0].n,
        beforeAssets,
      );
    },
  );
  await step(
    "immutable resource row rejects UPDATE; metadata admin ACL denies normal user",
    async () => {
      await assert.rejects(
        db.query("update project_binary_assets set bytes=1 where user_id=$1", [a.id]),
        /immutable/,
      );
      assert.equal((await api(b, "adminProjectAssets")).status, 403);
      const supers = (await db.query("select user_id from user_roles where role='super_admin'"))
        .rows;
      if (!supers.length)
        execFileSync(
          process.execPath,
          ["scripts/bootstrap-admin.mjs", "--user-id", a.id, "--email", a.email],
          { env: { ...process.env, DATABASE_URL }, stdio: "pipe" },
        );
      if(supers.length)await db.query("insert into user_roles(user_id,role) values($1,'admin') on conflict do nothing",[a.id]);
      assert.equal((await api(a, "adminProjectAssets")).status, 200);
    },
  );
  await step(
    "Chromium editor displays actual PNG and picker uploads replacement, not an icon placeholder",
    async () => {
      browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const login=await context.request.post(`${BASE}/api/auth/sign-in/email`,{headers:{origin:BASE},data:{email:a.email,password}});
      assert.equal(login.status(),200);
      const page = await context.newPage();
      await page.goto(`${BASE}/edit/${projectId}`);
      await page.getByAltText("工程 PNG 资源").first().waitFor({ timeout: 30000 });
      assert.equal(
        await page
          .getByAltText("工程 PNG 资源")
          .first()
          .evaluate((img) => img.complete && img.naturalWidth === 32),
        true,
      );
      // Click actual selected node through its generated title, then use real file picker.
      await page.getByAltText("工程 PNG 资源").first().click();
      await page
        .getByLabel("上传 PNG 资源")
        .setInputFiles({
          name: "replacement.png",
          mimeType: "image/png",
          buffer: Buffer.from(iconPng(17)),
        });
      await page.getByText("PNG 已上传并引用", { exact: false }).waitFor({ timeout: 30000 });
      assert.ok((await api(a, "assetUsage")).body.count >= 3);
      await page.screenshot({
        path: `${OUT}/editor-resource.png`,
        fullPage: true,
      });
      await context.close();
    },
  );
  if(process.env.BLUEOS_TOOLKIT_DIR)await step("actual isolated worker builds frozen PNG resources, verifies VRU bytes and repeated download does not charge",async()=>{
    const env={...process.env,DATABASE_URL,BUILD_SANDBOX:"auto",WORKER_ID:`v3-resource-${tag}`};
    const child=spawn(process.execPath,["worker/build-worker.mjs"],{env,stdio:["ignore","pipe","pipe"]});
    let workerLog="";child.stdout.on("data",x=>workerLog+=x);child.stderr.on("data",x=>workerLog+=x);
    const exited=new Promise(resolve=>child.once("exit",code=>resolve(code)));
    for(let n=0;n<100;n++){
      if((await db.query("select 1 from build_workers where id=$1",[env.WORKER_ID])).rowCount)break;
      if(child.exitCode!==null)throw Error(`isolated worker exited: ${workerLog}`);
      await new Promise(r=>setTimeout(r,100));
    }
    await db.query("update system_config set value='true' where key='build_enabled'");
    try {
      await db.query("insert into quota_accounts(user_id,kind,balance) values($1,'build',2) on conflict(user_id,kind) do update set balance=2",[a.id]);
      const loaded=(await api(a,"getProjectDoc",{projectId})).body,input={projectId,expectedRevision:loaded.revision,expectedContentSha256:loaded.contentSha256};
      const requested=await api(a,"requestBuild",input);assert.equal(requested.status,200,JSON.stringify(requested.body));
      assert.notEqual(requested.body.status,"unavailable",JSON.stringify(requested.body));
      assert.equal((await api(a,"requestBuild",input)).body.reused,true);
      const newer=await upload(a,iconPng(19));assert.equal(newer.status,200);
      const changed=structuredClone(loaded.doc);changed.assets.push(newer.body.asset);changed.project.name="资源后续修订";
      const revised=await api(a,"saveProjectDoc",{doc:changed,baseRevision:loaded.revision});assert.equal(revised.status,200,JSON.stringify(revised.body));assert.ok(revised.body.revision>loaded.revision);
      let task;
      for(let n=0;n<180;n++){
        task=await api(a,"getBuild",{id:requested.body.id});
        if(["succeeded","failed","cancelled","unavailable"].includes(task.body.status))break;
        if(child.exitCode!==null)throw Error(`isolated worker exited: ${workerLog}`);
        await new Promise(r=>setTimeout(r,1000));
      }
      writeFileSync(`${OUT}/isolated-build-result.json`,JSON.stringify(task.body,null,2));
      assert.equal(task.body.status,"succeeded",JSON.stringify({status:task.body.status,error:task.body.error,log:task.body.log}));
      assert.equal(task.body.revision,loaded.revision);
      assert.equal(task.body.verify.checks.filter(x=>x.name.startsWith("资源 ") && x.ok).length,loaded.doc.assets.length);
      const frozen=(await db.query("select source_zip,source_sha256 from build_tasks where id=$1",[requested.body.id])).rows[0];
      assert.equal(createHash("sha256").update(frozen.source_zip).digest("hex"),frozen.source_sha256);
      const frozenFiles=await readZip(frozen.source_zip);assert.equal(frozenFiles[`src/${newer.body.asset.path}`],undefined);
      writeFileSync(`${OUT}/frozen-source.zip`,frozen.source_zip);
      writeFileSync(`${OUT}/snapshot-provenance.json`,JSON.stringify({taskId:requested.body.id,revision:loaded.revision,newerRevision:revised.body.revision,sourceSha256:frozen.source_sha256,assets:loaded.doc.assets.map(({path,bytes,sha256})=>({path,bytes,sha256})),excludedNewAsset:newer.body.asset.path},null,2));
      const before=(await db.query("select balance,reserved from quota_accounts where user_id=$1 and kind='build'",[a.id])).rows[0];assert.equal(before.balance,1);assert.equal(before.reserved,0);
      for(let i=0;i<2;i++){const r=await api(a,"downloadBuild",{id:requested.body.id});assert.equal(r.status,200);if(i===0)writeFileSync(`${OUT}/rpk/isolated-resource.debug.rpk`,Buffer.from(r.body.rpkBase64,"base64"));}
      assert.deepEqual((await db.query("select balance,reserved from quota_accounts where user_id=$1 and kind='build'",[a.id])).rows[0],before);
      assert.equal((await api(a,"requestBuild",input)).status,409);
    }finally{
      await db.query("update system_config set value='false' where key='build_enabled'");
      child.kill("SIGTERM");await exited;writeFileSync(`${OUT}/isolated-worker.log`,workerLog);
    }
  });
  console.log(`RESULT ${passed}/${passed}`);
} finally {
  await browser?.close();
  await db.end();
}
