#!/usr/bin/env node
/** ch.19 expiry boundaries. ONLY run on a disposable local test DB matching E2E_BASE. */
import assert from "node:assert/strict";
import pg from "pg";
const BASE = process.env.E2E_BASE || "http://localhost:3997";
const DB = process.env.DATABASE_URL;
assert.ok(DB && ["localhost", "127.0.0.1"].includes(new URL(DB).hostname), "disposable LOCAL database required");
const pool = new pg.Pool({ connectionString: DB });
const tag = Date.now().toString(36);
const H = { "content-type": "application/json", origin: BASE };
async function register(name) {
 const email = `${name}-${tag}@expiry.local`, password = "Expiry-Passw0rd!";
 let r = await fetch(`${BASE}/api/auth/sign-up/email`, {method:"POST",headers:H,body:JSON.stringify({email,password,name})}); assert.equal(r.status,200); await r.text();
 r = await fetch(`${BASE}/api/auth/sign-in/email`, {method:"POST",headers:H,body:JSON.stringify({email,password})}); assert.equal(r.status,200); const token=r.headers.get("set-auth-token");await r.text();assert.ok(token);return token;
}
async function call(token,action,payload={}) {
 const r=await fetch(`${BASE}/api/v1/platform`,{method:"POST",headers:{...H,authorization:`Bearer ${token}`},body:JSON.stringify({action,payload,client:"android"})});return {status:r.status,json:await r.json()};
}
let ok=0;
async function step(name,fn){await fn();ok++;console.log(`✔ ${name}`);}
try {
 const admin=await register("admin");assert.equal((await call(admin,"me")).status,200);
 const user=await register("user");const me=(await call(user,"me")).json;const userId=me.userId;
 const plan=(await pool.query("select id from plans where active = true and categories = '' order by id limit 1")).rows[0];assert.ok(plan);
 await step("有效会员能用会员组件；会员到期后 me 无会员且 palette 再次锁定",async()=>{
  assert.equal((await call(admin,"adminGrantMembership",{userId,planId:plan.id})).status,200);
  let m=(await call(user,"me")).json;assert.ok(m.membership);assert.equal(m.palette.time,"");
  await pool.query("update memberships set starts_at=now()-interval '2 days', ends_at=now()-interval '1 day' where user_id=$1",[userId]);
  m=(await call(user,"me")).json;assert.equal(m.membership,null);assert.ok(m.palette.time);
 });
 await step("组件单独授权有效；授权过期后重新锁定",async()=>{
  const c=(await pool.query("select id from components where slug='hotspot'")).rows[0];assert.ok(c);
  assert.equal((await call(admin,"adminGrantComponent",{userId,componentId:c.id})).status,200);
  assert.equal((await call(user,"me")).json.palette.hotspot,"");
  await pool.query("update component_grants set expires_at=now()-interval '1 second' where user_id=$1 and component_id=$2",[userId,c.id]);
  assert.ok((await call(user,"me")).json.palette.hotspot);
 });
 await step("服务端 session 到期后原 Bearer 返回 401",async()=>{
  await pool.query('update "session" set "expiresAt"=now()-interval \'1 minute\' where "userId"=$1',[userId]);
  assert.equal((await call(user,"me")).status,401);
 });
 console.log(`\n${ok} 通过（真实本地数据库过期边界）`);
} finally {await pool.end();}
