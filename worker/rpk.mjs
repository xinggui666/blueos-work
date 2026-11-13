/**
 * RPK 产物检查与源工程解压（Worker 用，纯 Node，无第三方依赖）。
 * RPK 是 zip：META-INF/CERT（签名证书）、manifest.json、<包名>.vru（官方工具链打包的页面代码，
 * 以 "vivo union file" 开头）。检查依据是官方 toolkit 1.9.45-beta.44 实际产出的结构。
 */
import { inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";

export const RPK_LIMITS = { bytes: 20 * 1024 * 1024, entries: 2000 };

/**
 * 读取 zip 中央目录，返回 { name, method, size, data() }。路径不安全时抛错。
 * @param {Buffer} buf
 * @returns {{ name: string, method: number, size: number, data: () => Buffer }[]}
 */
export function readZipEntries(buf) {
  if (buf.length < 22) throw new Error("文件太小，不是 zip");
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("不是有效的 zip（找不到目录结尾）");
  const count = buf.readUInt16LE(eocd + 10);
  if (count > RPK_LIMITS.entries) throw new Error("zip 条目过多");
  let at = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error("zip 目录损坏");
    const method = buf.readUInt16LE(at + 10);
    const csize = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    if (name.startsWith("/") || name.includes("\\") || name.split("/").includes("..")) throw new Error(`zip 路径不安全：${name}`);
    out.push({
      name,
      method,
      size,
      data() {
        if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error("zip 文件头损坏");
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const raw = buf.subarray(start, start + csize);
        if (method === 0) return Buffer.from(raw);
        if (method === 8) return inflateRawSync(raw, { maxOutputLength: RPK_LIMITS.bytes });
        throw new Error(`不支持的压缩方式 ${method}`);
      },
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/**
 * 检查 RPK：zip 结构、签名证书、manifest 与任务一致、vru 文件头、每个页面路由都被打进包里。
 * 返回 { ok, checks: [{name, ok, detail}], sha256, bytes }。
 * @param {Buffer} buf
 * @param {{ packageName: string, versionCode: number, versionName: string, mode: string, routes: string[] }} expect
 */
export function verifyRpk(buf, expect) {
  const checks = [];
  const check = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail });
  check("大小", buf.length > 0 && buf.length <= RPK_LIMITS.bytes, `${buf.length} 字节`);
  let entries = [];
  try {
    entries = readZipEntries(buf);
    check("zip 结构", true, `${entries.length} 个条目`);
  } catch (error) {
    check("zip 结构", false, error.message);
    return { ok: false, checks, sha256: sha256(buf), bytes: buf.length };
  }
  const find = (name) => entries.find((e) => e.name === name);
  const cert = find("META-INF/CERT");
  check("签名证书 META-INF/CERT", cert && cert.size > 0);
  let manifest = null;
  try {
    manifest = JSON.parse(find("manifest.json").data().toString("utf8"));
    check("manifest.json", true);
  } catch (error) {
    check("manifest.json", false, error.message);
  }
  if (manifest) {
    check("包名", manifest.package === expect.packageName, `${manifest.package}`);
    check("版本号", Number(manifest.versionCode) === Number(expect.versionCode) && String(manifest.versionName) === String(expect.versionName), `${manifest.versionName} (${manifest.versionCode})`);
    check("调试/正式", expect.mode === "release" ? manifest.config?.debug !== true : true, manifest.config?.debug ? "debug 包" : "release 包");
    const routes = Object.keys(manifest.router?.pages ?? {});
    check("页面路由", expect.routes.every((r) => routes.includes(r)), routes.join(", "));
  }
  const vru = find(`${expect.packageName}.vru`);
  if (!vru) check("页面代码包 .vru", false, "缺少");
  else {
    const data = vru.data();
    check("页面代码包 .vru", data.subarray(0, 15).toString("latin1") === "vivo union file", `${data.length} 字节`);
    const missing = expect.routes.filter((r) => !data.includes(Buffer.from(r)));
    check("页面已编译进包", missing.length === 0, missing.length ? `缺少 ${missing.join(", ")}` : `${expect.routes.length} 个页面`);
  }
  return { ok: checks.every((c) => c.ok), checks, sha256: sha256(buf), bytes: buf.length };
}

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}
