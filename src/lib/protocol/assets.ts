/** Portable binary-resource checks. Phase 3 deliberately supports PNG only, never URLs/SVG/scripts. */
import type { AssetDoc, ProjectDoc } from "./schema.ts";
import { crc32 } from "./zip.ts";
export type AssetFiles = Record<string, Uint8Array>;
export const ASSET_MAX_BYTES = 2 * 1024 * 1024;
export const PROJECT_ASSET_MAX_BYTES = 6 * 1024 * 1024;
export const ASSET_MAX_PIXELS = 1024 * 1024;
export function pngInfo(data: Uint8Array): {
  compressed: Uint8Array;
  decodedBytes: number;
  rowBytes: number;
} {
  const fail = (): never => {
    throw new Error("资源不是支持的完整 PNG（仅 8-bit 非交错 PNG，最多 1048576 像素）");
  };
  if (
    data.length < 57 ||
    data.length > ASSET_MAX_BYTES ||
    [137, 80, 78, 71, 13, 10, 26, 10].some((b, i) => data[i] !== b)
  )
    fail();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let p = 8,
    width = 0,
    height = 0,
    channels = 0,
    ended = false,
    seenData = false,
    dataEnded = false,
    palette = false;
  const chunks: Uint8Array[] = [];
  while (p < data.length) {
    if (p + 12 > data.length) fail();
    const n = view.getUint32(p),
      end = p + 12 + n;
    if (end > data.length || n > ASSET_MAX_BYTES) fail();
    const type = String.fromCharCode(...data.subarray(p + 4, p + 8));
    if (
      !/^[A-Za-z]{4}$/.test(type) ||
      crc32(data.subarray(p + 4, p + 8 + n)) !== view.getUint32(p + 8 + n)
    )
      fail();
    if (p === 8 && type !== "IHDR") fail();
    if (type === "IHDR") {
      if (p !== 8 || n !== 13) fail();
      width = view.getUint32(p + 8);
      height = view.getUint32(p + 12);
      const color = data[p + 17];
      channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color] ?? 0;
      if (
        !width ||
        !height ||
        width > 4096 ||
        height > 4096 ||
        width * height > ASSET_MAX_PIXELS ||
        data[p + 16] !== 8 ||
        !channels ||
        data[p + 18] ||
        data[p + 19] ||
        data[p + 20]
      )
        fail();
      // Palette PNG must carry PLTE before IDAT; checked below.
      palette = color !== 3;
    } else if (type === "PLTE") {
      if (seenData || n === 0 || n % 3 || n > 768) fail();
      palette = true;
    } else if (type === "IDAT") {
      if (dataEnded || !palette) fail();
      seenData = true;
      chunks.push(data.subarray(p + 8, p + 8 + n));
    } else if (type === "IEND") {
      if (n !== 0 || !seenData || end !== data.length) fail();
      ended = true;
    } else {
      // Reject unknown critical chunks and APNG, not an extensible execution container.
      if (type[0] === type[0].toUpperCase() || ["acTL", "fcTL", "fdAT"].includes(type)) fail();
      if (seenData) dataEnded = true;
    }
    p = end;
  }
  if (!ended) fail();
  const compressed = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    compressed.set(chunk, at);
    at += chunk.length;
  }
  const rowBytes = width * channels + 1;
  return { compressed, rowBytes, decodedBytes: rowBytes * height };
}
export function checkAsset(asset: AssetDoc, data: Uint8Array): void {
  if(asset.path!==`assets/${asset.sha256}.png`)throw new Error(`资源 ${asset.path} 路径与 SHA-256 不符；仅支持摘要命名 PNG`);
  if (
    asset.kind !== "image" ||
    asset.mime !== "image/png" ||
    !/^assets\/[A-Za-z0-9_/-]+\.png$/.test(asset.path) ||
    asset.path.includes("..") ||
    asset.path === "assets/images/logo.png"
  )
    throw new Error(`资源 ${asset.path} 不支持：仅接受本地 PNG，内置图标路径保留`);
  if (data.length !== asset.bytes || data.length > ASSET_MAX_BYTES || data.length === 0)
    throw new Error(`资源 ${asset.path} 大小不符或超过 2MiB`);
  pngInfo(data);
}

export function assertResourceReferences(doc:Pick<ProjectDoc,"assets"|"pages">):void {
 if(doc.assets.reduce((n,a)=>n+a.bytes,0)>PROJECT_ASSET_MAX_BYTES)throw new Error("工程资源总量超过 6MiB");
 const paths=new Set(doc.assets.map(a=>`/${a.path}`));
 for(const page of doc.pages)for(const c of page.components) {
  if(c.type!=="image")continue;
  const src=String(c.props.src??"/assets/images/logo.png");
  if(src && src!=="/assets/images/logo.png" && !paths.has(src))throw new Error(`图片 ${page.id}/${c.id} 未引用已声明本地资源，禁止网络 URL/任意文件路径`);
 }
}

/** Full bounded zlib scanline validation for browser import/export; never buffer unbounded expansion. */
export async function checkPngPixels(data:Uint8Array):Promise<void> {
 const info=pngInfo(data);
 if(typeof DecompressionStream==="undefined")throw new Error("当前环境缺少 PNG 解压能力，请升级浏览器/WebView");
 const reader=new Blob([info.compressed as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
 let offset=0;
 try{
  while(true){const item=await reader.read();if(item.done)break;
   if(offset+item.value.length>info.decodedBytes)throw new Error("PNG 解压数据超过像素预算");
   for(let p=(info.rowBytes-offset%info.rowBytes)%info.rowBytes;p<item.value.length;p+=info.rowBytes)if(item.value[p]>4)throw new Error("PNG 行过滤器无效");
   offset+=item.value.length;
  }
 }finally{await reader.cancel();reader.releaseLock();}
 if(offset!==info.decodedBytes)throw new Error("PNG 解压像素数据长度不符");
}
