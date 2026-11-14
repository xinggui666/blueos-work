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
  const names = new Set();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error("zip 目录损坏");
    if (at + 46 > buf.length) throw new Error("zip 目录越界");
    if (buf.readUInt16LE(at + 8) & 1) throw new Error("加密 ZIP 不受支持");
    const crc = buf.readUInt32LE(at + 16);
    const method = buf.readUInt16LE(at + 10);
    const csize = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    if (at + 46 + nameLen + extraLen + commentLen > buf.length || local + 30 > buf.length)
      throw new Error("zip 条目越界");
    if (names.has(name)) throw new Error("zip 重复路径");
    names.add(name);
    total += size;
    if (size > RPK_LIMITS.bytes || total > 64 * 1024 * 1024)
      throw new Error("zip 解压总量超过限制");
    if (name.startsWith("/") || name.includes("\\") || name.split("/").includes("..")) throw new Error(`zip 路径不安全：${name}`);
    out.push({
      name,
      method,
      size,
      data() {
        if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error("zip 文件头损坏");
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        if (start + csize > buf.length) throw new Error("zip 数据越界");
        const raw = buf.subarray(start, start + csize);
        let data;
        if (method === 0) data = Buffer.from(raw);
        else if (method === 8) data = inflateRawSync(raw, { maxOutputLength: Math.max(1, size) });
        else throw new Error(`不支持的压缩方式 ${method}`);
        if (data.length !== size || zipCrc(data) !== crc)
          throw new Error(`zip 大小/CRC 不符：${name}`);
        return data;
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
 * @param {{ packageName: string, versionCode: number, versionName: string, mode: string, routes: string[], assets?: {path:string,bytes:number,sha256:string}[] }} expect
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
    check(
      "版本号",
      Number(manifest.versionCode) === Number(expect.versionCode) &&
        String(manifest.versionName) === String(expect.versionName),
      `${manifest.versionName} (${manifest.versionCode})`,
    );
    check(
      "调试/正式",
      expect.mode === "release" ? manifest.config?.debug !== true : true,
      manifest.config?.debug ? "debug 包" : "release 包",
    );
    const routes = Object.keys(manifest.router?.pages ?? {});
    check(
      "页面路由",
      expect.routes.every((r) => routes.includes(r)),
      routes.join(", "),
    );
  }
  const vru = find(`${expect.packageName}.vru`);
  if (!vru) check("页面代码包 .vru", false, "缺少");
  else {
    const data = vru.data();
    check(
      "页面代码包 .vru",
      data.subarray(0, 15).toString("latin1") === "vivo union file",
      `${data.length} 字节`,
    );
    const missing = expect.routes.filter((r) => !data.includes(Buffer.from(r)));
    check(
      "页面已编译进包",
      missing.length === 0,
      missing.length ? `缺少 ${missing.join(", ")}` : `${expect.routes.length} 个页面`,
    );
  }
  if (expect.assets?.length) {
    try {
      if (!vru) throw Error("缺少 VRU，无法验证资源");
      const packed = readVruEntries(vru.data());
      for (const asset of expect.assets) {
        const resource = packed.get(asset.path);
        check(
          `资源 ${asset.path}`,
          resource && resource.length === asset.bytes && sha256(resource) === asset.sha256,
          resource ? `${resource.length} 字节` : "缺失",
        );
      }
    } catch (error) {
      check("资源 VRU 索引", false, error.message);
    }
  }
  return { ok: checks.every((c) => c.ok), checks, sha256: sha256(buf), bytes: buf.length };
}

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** Official toolkit 1.9.45-beta.44 observed VRU: 176-byte header + length/name/offset/size index + bytes.
 * Unknown/new layouts fail closed when resource verification is requested. Not a watch-runtime test. */
export function readVruEntries(buf) {
  if (
    buf.length < 176 ||
    buf.subarray(0, 15).toString("latin1") !== "vivo union file" ||
    buf.readUInt32LE(68) !== buf.length
  )
    throw Error("不支持的 VRU 头");
  const end = 176 + buf.readUInt32LE(64),
    count = buf.readUInt32LE(172);
  if (end > buf.length || count > RPK_LIMITS.entries) throw Error("VRU 索引越界");
  let p = 176;
  const out = new Map(),
    ranges = [];
  for (let i = 0; i < count; i++) {
    if (p + 4 > end) throw Error("VRU 名称越界");
    const n = buf.readUInt32LE(p);
    p += 4;
    if (!n || n > 512 || p + n + 8 > end) throw Error("VRU 条目越界");
    const name = buf.subarray(p, p + n).toString("utf8");
    p += n;
    const offset = buf.readUInt32LE(p),
      size = buf.readUInt32LE(p + 4);
    p += 8;
    if (
      name.startsWith("/") ||
      name.includes("\\") ||
      name.includes("\0") ||
      name.split("/").some((x) => x === ".." || x === "." || !x) ||
      out.has(name) ||
      offset < end ||
      offset + size > buf.length
    )
      throw Error("VRU 路径/范围无效");
    out.set(name, buf.subarray(offset, offset + size));
    ranges.push([offset, offset + size]);
  }
  if (p !== end) throw Error("VRU 索引长度不符");
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++)
    if (ranges[i][0] < ranges[i - 1][1]) throw Error("VRU 数据重叠");
  return out;
}
function zipCrc(data) {
  let c = 0xffffffff;
  for (const b of data) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
