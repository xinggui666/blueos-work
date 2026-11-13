export const CLIENTS = ["web", "android", "desktop"] as const;
export type ClientKind = (typeof CLIENTS)[number];

export const SHARED_ACTIONS = [
  "me",
  "listProjects",
  "syncProject",
  "getProjectDoc",
  "saveProjectDoc",
  "listRevisions",
  "validateProject",
  "previewImport",
  "importBundle",
  "deleteProject",
  "generate",
  "exportBundle",
  "listJobs",
  "downloadJob",
  "requestBuild",
  "market",
  "install",
  "redeem",
  "listOrders",
  "createOrder",
  "developerApply",
  "mySubmissions",
  "submitComponent",
  "ledger",
  "releaseCheck",
] as const;

export type SharedAction = (typeof SHARED_ACTIONS)[number];

export function isClient(value: unknown): value is ClientKind {
  return value === "web" || value === "android" || value === "desktop";
}

export function isSharedAction(value: string): value is SharedAction {
  return (SHARED_ACTIONS as readonly string[]).includes(value);
}
