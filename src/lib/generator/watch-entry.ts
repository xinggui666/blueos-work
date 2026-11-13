/**
 * 手表端运行时入口：打包进生成的 BlueOS 工程（src/common/engine.js）。
 * 与网页预览使用同一份解释器（runtime.ts + expr.ts），保证预览和成品的执行语义一致。
 * 只能引用不依赖 zod 的模块。改动后运行 `npm run gen:watch-runtime` 重新生成。
 */
export { Runtime, RUNTIME_LIMITS } from "../protocol/runtime.ts";
export { toText, truthy } from "../protocol/expr.ts";
export { VISIBLE_PROP } from "../protocol/limits.ts";
