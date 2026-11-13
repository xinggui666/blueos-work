// 生成统一工程协议的 JSON Schema：node --experimental-strip-types scripts/gen-protocol-schema.ts [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { ProjectDocSchema, SCHEMA_VERSION } from "../src/lib/protocol/schema.ts";

const schema = {
  $id: `https://blueos-workshop/protocol/project-v${SCHEMA_VERSION}.schema.json`,
  title: "BlueOS 工坊统一工程协议",
  ...z.toJSONSchema(ProjectDocSchema, { unrepresentable: "any", reused: "ref" }),
};
const text = JSON.stringify(schema, null, 2) + "\n";
const file = new URL("../docs/protocol/project.schema.json", import.meta.url);
if (process.argv.includes("--check")) {
  const current = readFileSync(file, "utf8");
  if (current !== text) {
    console.error("docs/protocol/project.schema.json 已过期，请运行 npm run protocol:schema");
    process.exit(1);
  }
  console.log("schema up to date");
} else {
  writeFileSync(file, text);
  console.log("wrote", file.pathname, text.length, "bytes");
}
