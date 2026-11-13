export function readBproj(bytes: Uint8Array): unknown {
  const files = unzipStored(bytes);
  const project = files["project.json"];
  if (!project) throw new Error("这个文件不是可导入的工程包");
  return JSON.parse(new TextDecoder().decode(project)) as unknown;
}

function unzipStored(bytes: Uint8Array): Record<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files: Record<string, Uint8Array> = {};
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) break;
    const method = view.getUint16(offset + 8, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = new TextDecoder().decode(bytes.slice(nameStart, nameStart + nameLength));
    if (method !== 0) throw new Error("工程包压缩方式不支持");
    files[name] = bytes.slice(dataStart, dataStart + size);
    offset = dataStart + size;
  }
  return files;
}
