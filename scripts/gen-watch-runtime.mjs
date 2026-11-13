#!/usr/bin/env node
/**
 * 把手表端运行时（src/lib/generator/watch-entry.ts）打包成 ES2015 的单文件，
 * 写入 src/lib/generator/watch-runtime.generated.ts（导出为字符串，生成器原样写进 RPK 源工程）。
 *   node scripts/gen-watch-runtime.mjs          生成
 *   node scripts/gen-watch-runtime.mjs --check  只检查是否最新（CI 用）
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = `${root}src/lib/generator/watch-runtime.generated.ts`;

const bundle = await rolldown({ input: `${root}src/lib/generator/watch-entry.ts`, platform: "neutral", transform: { target: "es2015" }, treeshake: true });
const { output } = await bundle.generate({ format: "esm", minify: true });
await bundle.close();
const code = output[0].code;
if (/\bzod\b|\brequire\(/.test(code)) throw new Error("手表运行时不能依赖 zod 或 require");
const sha = createHash("sha256").update(code).digest("hex");
const body = `// 自动生成，请勿手改：node scripts/gen-watch-runtime.mjs\n// 来源 src/lib/generator/watch-entry.ts（runtime.ts + expr.ts），ES2015，${code.length} 字节\nexport const WATCH_RUNTIME_SHA256 = ${JSON.stringify(sha)};\nexport const WATCH_RUNTIME = ${JSON.stringify(code)};\n`;
if (process.argv.includes("--check")) {
  const current = existsSync(out) ? readFileSync(out, "utf8") : "";
  if (current !== body) {
    console.error("watch-runtime.generated.ts 不是最新，请运行 node scripts/gen-watch-runtime.mjs");
    process.exit(1);
  }
  console.log(`watch runtime 最新（${code.length} 字节，${sha.slice(0, 12)}）`);
} else {
  writeFileSync(out, body);
  console.log(`写入 ${out}（${code.length} 字节，${sha.slice(0, 12)}）`);
}
