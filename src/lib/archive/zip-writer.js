/*
 * STORE-only ZIP writer for `.wrack` archives (assignment-3-scope.md, `.wrack`
 * archive; a3-agent-plan.md, Phase 12). Per entry: a local file header and the
 * data; then one central directory header per entry; then the end record.
 * Every header uses version 20, flag bit 11 (UTF-8 names), method 0 and the
 * fixed DOS time 0 and date 0x0021 (1980-01-01), so equal input gives
 * byte-identical output. No ZIP64: a size or offset that does not fit in
 * 32 bits is refused. The output is `new Blob(parts)`; entry data is passed
 * through as a Blob part and read only in slices to compute its CRC.
 */
import { crc32, crc32Blob } from './crc32.js';
import { pathProblem } from './paths.js';

/** Largest archive, in bytes (project limit). */
export const MAX_ARCHIVE_BYTES = 500 * 1024 * 1024;

export const TOO_LARGE = 'This project is too large to save as one file.';

export const LOCAL_SIGNATURE = 0x04034b50;
export const CENTRAL_SIGNATURE = 0x02014b50;
export const END_SIGNATURE = 0x06054b50;
export const LOCAL_HEADER_BYTES = 30;
export const CENTRAL_HEADER_BYTES = 46;
export const END_RECORD_BYTES = 22;
export const ZIP_VERSION = 20;
export const UTF8_FLAG = 0x0800;
export const DOS_TIME = 0;
export const DOS_DATE = 0x0021;

const UINT32_MAX = 0xffffffff;
const UINT16_MAX = 0xffff;

const encoder = new TextEncoder();

const tooLarge = () => ({ ok: false, error: { code: 'too-large', message: TOO_LARGE } });

function sizeOf(data) {
  return data instanceof Uint8Array ? data.byteLength : data.size;
}

function localHeader(name, crc, size) {
  const bytes = new Uint8Array(LOCAL_HEADER_BYTES + name.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, LOCAL_SIGNATURE, true);
  view.setUint16(4, ZIP_VERSION, true);
  view.setUint16(6, UTF8_FLAG, true);
  view.setUint16(8, 0, true); // method: STORE
  view.setUint16(10, DOS_TIME, true);
  view.setUint16(12, DOS_DATE, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true); // compressed size
  view.setUint32(22, size, true); // uncompressed size
  view.setUint16(26, name.length, true);
  view.setUint16(28, 0, true); // extra field length
  bytes.set(name, LOCAL_HEADER_BYTES);
  return bytes;
}

function centralHeader(name, crc, size, offset) {
  const bytes = new Uint8Array(CENTRAL_HEADER_BYTES + name.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, CENTRAL_SIGNATURE, true);
  view.setUint16(4, ZIP_VERSION, true); // version made by
  view.setUint16(6, ZIP_VERSION, true); // version needed
  view.setUint16(8, UTF8_FLAG, true);
  view.setUint16(10, 0, true); // method: STORE
  view.setUint16(12, DOS_TIME, true);
  view.setUint16(14, DOS_DATE, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, name.length, true);
  // Extra length, comment length, disk number, internal and external attributes stay 0.
  view.setUint32(42, offset, true);
  bytes.set(name, CENTRAL_HEADER_BYTES);
  return bytes;
}

function endRecord(count, centralSize, centralOffset) {
  const bytes = new Uint8Array(END_RECORD_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, END_SIGNATURE, true);
  // Disk numbers stay 0.
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  // Comment length stays 0.
  return bytes;
}

/**
 * Writes `entries` ({ path, data: Uint8Array | Blob }, in order) as a ZIP.
 * Resolves to { ok: true, value: Blob }, or { ok: false, error: { code, message, path? } }
 * with code 'invalid-path' for an unsafe or repeated path, or 'too-large' when the
 * archive would exceed `maxBytes` (default MAX_ARCHIVE_BYTES) or a 32-bit field.
 * Sizes are checked before any data is read.
 */
export async function writeZip(entries, { maxBytes = MAX_ARCHIVE_BYTES } = {}) {
  const items = [];
  const seen = new Set();
  let total = END_RECORD_BYTES;
  for (const { path, data } of entries) {
    const problem = typeof path === 'string' ? pathProblem(path) : { message: 'An archive entry has no name.' };
    if (problem) return { ok: false, error: { code: 'invalid-path', path, message: problem.message } };
    const key = path.toLowerCase();
    if (seen.has(key)) return { ok: false, error: { code: 'invalid-path', path, message: `The archive lists ${path} twice.` } };
    seen.add(key);
    const name = encoder.encode(path);
    const size = sizeOf(data);
    if (!Number.isSafeInteger(size) || size < 0 || size > UINT32_MAX) return tooLarge();
    total += LOCAL_HEADER_BYTES + CENTRAL_HEADER_BYTES + 2 * name.length + size;
    if (total > maxBytes || total > UINT32_MAX) return tooLarge();
    items.push({ name, data, size });
  }
  if (items.length > UINT16_MAX) return tooLarge();

  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data, size } of items) {
    const crc = data instanceof Uint8Array ? crc32(data) : await crc32Blob(data);
    parts.push(localHeader(name, crc, size), data);
    central.push(centralHeader(name, crc, size, offset));
    offset += LOCAL_HEADER_BYTES + name.length + size;
  }
  const centralSize = central.reduce((sum, header) => sum + header.length, 0);
  parts.push(...central, endRecord(items.length, centralSize, offset));
  return { ok: true, value: new Blob(parts) };
}
