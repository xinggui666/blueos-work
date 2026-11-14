import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readVruEntries,verifyRpk,readZipEntries} from "./rpk.mjs";
import {writeZip} from "../src/lib/protocol/zip.ts";
function vru(files){const items=Object.entries(files),n=items.reduce((v,[name])=>v+12+Buffer.byteLength(name),0),head=176+n,total=head+items.reduce((v,[,data])=>v+data.length,0),out=Buffer.alloc(total);out.write("vivo union file");out.writeUInt32LE(n,64);out.writeUInt32LE(total,68);out.writeUInt32LE(items.length,172);let p=176,at=head;for(const [name,data]of items){out.writeUInt32LE(Buffer.byteLength(name),p);p+=4;p+=out.write(name,p);out.writeUInt32LE(at,p);out.writeUInt32LE(data.length,p+4);p+=8;Buffer.from(data).copy(out,at);at+=data.length;}return out;}
const data=Buffer.from("actual-png-fixture-bytes"),asset={path:"assets/example.png",bytes:data.length,sha256:createHash("sha256").update(data).digest("hex")};
function packageFixture(files){return Buffer.from(writeZip([{path:"META-INF/CERT",data:Buffer.from("fixture-cert")},{path:"manifest.json",data:Buffer.from(JSON.stringify({package:"com.fixture",versionCode:1,versionName:"1.0",router:{pages:{"pages/Home":{}}}}))},{path:"com.fixture.vru",data:vru(files)}]));}
const expect={packageName:"com.fixture",versionCode:1,versionName:"1.0",mode:"debug",routes:["pages/Home"],assets:[asset]};
test("VRU indexed resource digest passes and missing/tampered/wrong size fails",()=>{
 const base={"pages/Home/index.js":Buffer.from("page"),[asset.path]:data};
 assert.equal(verifyRpk(packageFixture(base),expect).ok,true);
 for(const files of [{"pages/Home/index.js":Buffer.from("page")},{...base,[asset.path]:Buffer.from("tampered")}])assert.equal(verifyRpk(packageFixture(files),expect).ok,false);
 assert.equal(verifyRpk(packageFixture(base),{...expect,assets:[{...asset,bytes:999}]}).ok,false);
});
test("VRU rejects unknown/truncated layout, unsafe names, overlap and invalid offset",()=>{
 assert.throws(()=>readVruEntries(Buffer.alloc(176)),/VRU/);
 assert.throws(()=>readVruEntries(vru({"../escape":data})),/路径/);
 const corrupt=vru({"safe":data});corrupt.writeUInt32LE(0,184);assert.throws(()=>readVruEntries(corrupt),/范围/);
 const truncated=vru({"safe":data}).subarray(0,-1);assert.throws(()=>readVruEntries(truncated),/VRU/);
});
test("worker zip reader rejects duplicate names, CRC corruption and out-of-bound compressed payload",()=>{
 assert.throws(()=>readZipEntries(Buffer.from(writeZip([{path:"a",data},{path:"a",data}]))),/重复/);
 const zip=Buffer.from(writeZip([{path:"a",data}]));zip[31]^=1;assert.throws(()=>readZipEntries(zip)[0].data(),/CRC/);
 const huge=Buffer.from(writeZip([{path:"a",data}]));huge.writeUInt32LE(99_999_999,huge.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]))+20);assert.throws(()=>readZipEntries(huge)[0].data(),/越界/);
});
