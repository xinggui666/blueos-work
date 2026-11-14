// worker/rpk.mjs 的类型声明（供 TypeScript 测试导入）。
export type ZipEntry = { name: string; method: number; size: number; data: () => Buffer };
export type RpkCheck = { name: string; ok: boolean; detail: string };
export type RpkExpect = { packageName: string; versionCode: number; versionName: string; mode: string; routes: string[]; assets?: {path:string;bytes:number;sha256:string}[] };
export declare const RPK_LIMITS: { bytes: number; entries: number };
export declare function readZipEntries(buf: Buffer): ZipEntry[];
export declare function verifyRpk(buf: Buffer, expect: RpkExpect): { ok: boolean; checks: RpkCheck[]; sha256: string; bytes: number };
export declare function sha256(buf: Buffer): string;
export declare function readVruEntries(buf:Buffer):Map<string,Buffer>;
