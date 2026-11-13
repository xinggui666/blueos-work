/** 生成占位图标（不依赖外部图片库）。正式图标要求 114×114、正方形、无白边，由用户自行替换。 */
import { crc32 } from "../protocol/zip.ts";

export function iconPng(size = 114): Uint8Array {
  const raw = new Uint8Array((size * 4 + 1) * size);
  let offset = 0;
  const cx = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x - cx, y - cx);
      const on = (dist > size * 0.28 && dist < size * 0.4) || dist <= size * 0.12;
      const rgb = on ? [60, 141, 255] : [12, 18, 24];
      raw[offset++] = rgb[0];
      raw[offset++] = rgb[1];
      raw[offset++] = rgb[2];
      raw[offset++] = 255;
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlibStore(raw)), chunk("IEND", new Uint8Array())];
  return concat(parts);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function zlibStore(data: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [Uint8Array.from([0x78, 0x01])];
  for (let i = 0; i < data.length; i += 65535) {
    const size = Math.min(65535, data.length - i);
    const block = new Uint8Array(5 + size);
    block[0] = i + size >= data.length ? 1 : 0;
    block[1] = size & 255;
    block[2] = size >> 8;
    block[3] = ~size & 255;
    block[4] = (~size >> 8) & 255;
    block.set(data.subarray(i, i + size), 5);
    parts.push(block);
  }
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  const tail = new Uint8Array(4);
  new DataView(tail.buffer).setUint32(0, ((b << 16) | a) >>> 0);
  parts.push(tail);
  return concat(parts);
}
