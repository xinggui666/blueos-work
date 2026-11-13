/**
 * 协议常量（不依赖 zod），供手表端运行时打包使用。schema.ts 重新导出这些常量。
 */
export const PROTOCOL_LIMITS = {
  pages: 12,
  componentsPerPage: 80,
  variables: 64,
  events: 200,
  actionsPerList: 50,
  actionDepth: 6,
  functions: 32,
  params: 8,
  bindings: 200,
  timers: 8,
  assets: 64,
  repeatMax: 100,
  callDepth: 8,
} as const;

/** 所有组件都可以绑定显示状态（visible，布尔）。 */
export const VISIBLE_PROP = "visible";
