/** 浏览器和 Node 通用的最小 ZIP 读写（写：仅存储；读：存储 + deflate，deflate 由调用方注入解压函数）。 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function writeZip(files: { path: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = enc.encode(file.path);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 文件名
    lv.setUint16(8, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, file.data.length, true);
    lv.setUint32(22, file.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, file.data.length, true);
    cv.setUint32(24, file.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    chunks.push(local, file.data);
    central.push(cen);
    offset += local.length + file.data.length;
  }
  const cenSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cenSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cenSize + 22);
  let p = 0;
  for (const c of [...chunks, ...central, end]) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

export type Inflate = (data: Uint8Array) => Promise<Uint8Array> | Uint8Array;
export const ZIP_LIMITS = { totalBytes: 8 * 1024 * 1024, entries: 128, entryBytes: 4 * 1024 * 1024 };

/** 通过中央目录读取（能正确处理带数据描述符的 ZIP），并检查路径穿越、条目数和解压大小。 */
export async function readZip(
  bytes: Uint8Array,
  inflate?: Inflate,
): Promise<Record<string, Uint8Array>> {
  if (bytes.length > ZIP_LIMITS.totalBytes) throw new Error("文件过大");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("不是有效的 ZIP 文件");
  const count = view.getUint16(eocd + 10, true);
  if (count > ZIP_LIMITS.entries) throw new Error("压缩包条目过多");
  let p = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const files: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50)
      throw new Error("ZIP 目录损坏");
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const csize = view.getUint32(p + 20, true);
    const usize = view.getUint32(p + 24, true);
    const nlen = view.getUint16(p + 28, true);
    const xlen = view.getUint16(p + 30, true);
    const clen = view.getUint16(p + 32, true);
    const lho = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (Object.hasOwn(files, name))
      throw new Error(`ZIP 文件重复：${name}`);
    if (name.endsWith("/")) continue;
    if (name.startsWith("/") || name.includes("..") || name.includes("\\"))
      throw new Error(`压缩包路径不安全：${name}`);
    if (usize > ZIP_LIMITS.entryBytes) throw new Error(`文件 ${name} 过大`);
    total += usize;
    if (total > ZIP_LIMITS.totalBytes) throw new Error("解压后总大小超过限制");
    if (lho + 30 > bytes.length || flags & 1) throw new Error("ZIP 条目越界或已加密");
    if (view.getUint32(lho, true) !== 0x04034b50) throw new Error("ZIP 条目损坏");
    const start = lho + 30 + view.getUint16(lho + 26, true) + view.getUint16(lho + 28, true);
    if (start + csize > bytes.length) throw new Error("ZIP 条目数据越界");
    const raw = bytes.subarray(start, start + csize);
    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) {
      if (!inflate) throw new Error("这个压缩包使用了压缩，当前环境不支持解压");
      data = await inflate(raw);
    } else throw new Error("不支持的压缩方式");
    if (data.length !== usize) throw new Error(`文件 ${name} 大小不符`);
    if (crc32(data) !== crc) throw new Error(`文件 ${name} 校验失败（CRC）`);
    files[name] = data;
  }
  return files;
}

/** 浏览器端 deflate-raw 解压（DecompressionStream）。 */
export async function browserInflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > ZIP_LIMITS.entryBytes) throw new Error("解压文件超过限制");
      chunks.push(item.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
