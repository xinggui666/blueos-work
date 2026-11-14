import {test} from "node:test";
import assert from "node:assert/strict";
import {boundedRequestText,requestLimit,BINARY_REQUEST_BYTES,NORMAL_REQUEST_BYTES} from "./request-limits.ts";
test("only binary actions get expanded request budgets",()=>{
 assert.equal(requestLimit("syncProject"),NORMAL_REQUEST_BYTES);assert.equal(requestLimit("uploadAsset"),3*1024*1024);assert.equal(requestLimit("importBundle"),BINARY_REQUEST_BYTES);assert.equal(requestLimit("adminWhatever"),NORMAL_REQUEST_BYTES);
});
test("bounded streaming body cancels oversized chunked input before unbounded read",async()=>{
 let cancelled=false;
 const stream=new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled=true;}});
 const req=new Request("http://localhost",{method:"POST",body:stream,duplex:"half"} as RequestInit);
 await assert.rejects(boundedRequestText(req),/请求过大/);assert.equal(cancelled,true);
});
test("bounded body preserves Chinese UTF-8 and rejects invalid UTF-8",async()=>{
 assert.equal(await boundedRequestText(new Request("http://localhost",{method:"POST",body:"资源"})),"资源");
 await assert.rejects(boundedRequestText(new Request("http://localhost",{method:"POST",body:new Uint8Array([255])})));
});
