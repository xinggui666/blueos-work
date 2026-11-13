#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyRpk } from "../worker/rpk.mjs";
const directory = process.argv[2];
if (!directory) throw new Error("sample directory required");
for (const mode of ["debug", "release"]) {
 const file = `com.example.counter.${mode}.1.0.rpk`;
 const result = verifyRpk(readFileSync(join(directory,file)), { packageName:"com.example.counter", versionName:"1.0", versionCode:1, mode, routes:["pages/Home","pages/Two"] });
 if(!result.ok) throw new Error(`${file}: ${JSON.stringify(result.checks)}`);
 console.log(`${file}: structure/compiled routes OK; ${result.sha256}; not watch-runtime verification`);
}
