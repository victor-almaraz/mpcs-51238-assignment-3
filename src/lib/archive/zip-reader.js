/*
 * ZIP reader for `.wrack` archives (a3-agent-plan.md, Phase 12). Reads only
 * through `Blob.slice`: the end record from the last 65 557 bytes, then the
 * central directory, then each local header. Every offset and size from a
 * header is checked against the file size before use. This module checks the
 * ZIP structure; archive policy (paths, limits, layout) is in validate.js.
 *
 * An entry is { path, size, compressedSize, crc, method, flags, offset, blob }
 * where `offset` is the start of the entry's data and `blob` its data slice
 * (null when the data range is not inside the file).
 */
import { CHUNK_BYTES, crc32 } from './crc32.js';
import {
  CENTRAL_HEADER_BYTES,
  CENTRAL_SIGNATURE,
  END_RECORD_BYTES,
  END_SIGNATURE,
  LOCAL_HEADER_BYTES,
  LOCAL_SIGNATURE,
} from './zip-writer.js';
import { showPath } from './paths.js';

/** End record plus the longest possible comment. */
export const END_SEARCH_BYTES = END_RECORD_BYTES + 0xffff;

/** General-purpose flag bit 3: sizes and CRC follow the data in a data descriptor. */
const DESCRIPTOR_FLAG = 0x0008;

export const NO_END_RECORD = 'The file is not a .wrack archive, or it is truncated: its end record is missing.';

const nameDecoder = new TextDecoder('utf-8', { fatal: true });

async function bytesAt(file, start, end) {
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

const viewOf = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Offset of the end record within `tail`, or -1. The comment must end exactly at the end of the file. */
function findEndRecord(tail) {
  const view = viewOf(tail);
  for (let i = tail.length - END_RECORD_BYTES; i >= 0; i--) {
    if (view.getUint32(i, true) !== END_SIGNATURE) continue;
    if (i + END_RECORD_BYTES + view.getUint16(i + 20, true) === tail.length) return i;
  }
  return -1;
}

/** Parses central directory records from `bytes`. Pushes structural errors to `errors`. */
function parseCentral(bytes, expected, errors) {
  const view = viewOf(bytes);
  const records = [];
  let pos = 0;
  while (records.length < expected) {
    if (pos + CENTRAL_HEADER_BYTES > bytes.length || view.getUint32(pos, true) !== CENTRAL_SIGNATURE) {
      errors.push({ code: 'bad-central-directory', message: "The archive's central directory is damaged." });
      break;
    }
    const nameLength = view.getUint16(pos + 28, true);
    const next = pos + CENTRAL_HEADER_BYTES + nameLength + view.getUint16(pos + 30, true) + view.getUint16(pos + 32, true);
    if (next > bytes.length) {
      errors.push({ code: 'bad-central-directory', message: "The archive's central directory is damaged." });
      break;
    }
    const nameBytes = bytes.subarray(pos + CENTRAL_HEADER_BYTES, pos + CENTRAL_HEADER_BYTES + nameLength);
    let path = null;
    try {
      path = nameDecoder.decode(nameBytes);
    } catch {
      errors.push({ code: 'bad-name', message: 'An archive entry name is not valid UTF-8.' });
    }
    records.push({
      path,
      nameBytes,
      flags: view.getUint16(pos + 8, true),
      method: view.getUint16(pos + 10, true),
      crc: view.getUint32(pos + 16, true),
      compressedSize: view.getUint32(pos + 20, true),
      size: view.getUint32(pos + 24, true),
      headerOffset: view.getUint32(pos + 42, true),
    });
    pos = next;
  }
  if (records.length === expected) return records;
  if (!errors.some((e) => e.code === 'bad-central-directory')) {
    errors.push({
      code: 'entry-count',
      message: `The archive's end record lists ${expected} entries, but its central directory holds ${records.length}.`,
    });
  }
  return records;
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Checks one entry's local header and data range. Returns the entry, or null when its name is unreadable. */
async function readLocal(file, record, centralOffset, errors) {
  if (record.path === null) return null;
  const { path, nameBytes } = record;
  const shown = showPath(path);
  const entry = {
    path,
    size: record.size,
    compressedSize: record.compressedSize,
    crc: record.crc,
    method: record.method,
    flags: record.flags,
    offset: null,
    blob: null,
    headerOffset: record.headerOffset,
    end: null,
  };
  if (record.headerOffset + LOCAL_HEADER_BYTES > file.size) {
    errors.push({ code: 'size-mismatch', path, message: `${shown} starts outside the archive file.` });
    return entry;
  }
  const local = await bytesAt(file, record.headerOffset, record.headerOffset + LOCAL_HEADER_BYTES + nameBytes.length);
  const view = viewOf(local);
  if (view.getUint32(0, true) !== LOCAL_SIGNATURE) {
    errors.push({ code: 'bad-local-header', path, message: `${shown} has no local file header.` });
    return entry;
  }
  const flags = view.getUint16(6, true);
  const nameLength = view.getUint16(26, true);
  const matches =
    flags === record.flags &&
    view.getUint16(8, true) === record.method &&
    nameLength === nameBytes.length &&
    sameBytes(local.subarray(LOCAL_HEADER_BYTES), nameBytes) &&
    ((flags & DESCRIPTOR_FLAG) !== 0 ||
      (view.getUint32(14, true) === record.crc &&
        view.getUint32(18, true) === record.compressedSize &&
        view.getUint32(22, true) === record.size));
  if (!matches) {
    errors.push({
      code: 'header-mismatch',
      path,
      message: `${shown} has a local header that does not match the central directory.`,
    });
  }
  const start = record.headerOffset + LOCAL_HEADER_BYTES + nameLength + view.getUint16(28, true);
  const end = start + record.compressedSize;
  if (end > file.size) {
    errors.push({ code: 'size-mismatch', path, message: `${shown} is larger than the archive file.` });
    return entry;
  }
  if (end > centralOffset) {
    errors.push({ code: 'overlap', path, message: `${shown} overlaps the archive's central directory.` });
    return entry;
  }
  entry.offset = start;
  entry.end = end;
  entry.blob = file.slice(start, end);
  return entry;
}

/** Reports entries whose header-plus-data ranges overlap an earlier entry. */
function checkOverlaps(entries, errors) {
  const placed = entries.filter((e) => e.end !== null).sort((a, b) => a.headerOffset - b.headerOffset);
  let reach = 0;
  for (const entry of placed) {
    if (entry.headerOffset < reach) {
      errors.push({ code: 'overlap', path: entry.path, message: `${showPath(entry.path)} overlaps another entry.` });
    }
    reach = Math.max(reach, entry.end);
  }
}

/**
 * Reads the archive structure without throwing. Resolves to { entries, errors }:
 * every entry whose central record could be parsed, and every structural problem found.
 */
export async function scanZip(file) {
  const errors = [];
  if (file.size < END_RECORD_BYTES) return { entries: [], errors: [{ code: 'no-end-record', message: NO_END_RECORD }] };
  const tailStart = file.size - Math.min(file.size, END_SEARCH_BYTES);
  const tail = await bytesAt(file, tailStart, file.size);
  const at = findEndRecord(tail);
  if (at < 0) return { entries: [], errors: [{ code: 'no-end-record', message: NO_END_RECORD }] };

  const end = viewOf(tail);
  const endOffset = tailStart + at;
  const disk = end.getUint16(at + 4, true);
  const centralDisk = end.getUint16(at + 6, true);
  const diskEntries = end.getUint16(at + 8, true);
  const count = end.getUint16(at + 10, true);
  const centralSize = end.getUint32(at + 12, true);
  const centralOffset = end.getUint32(at + 16, true);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== count) {
    return { entries: [], errors: [{ code: 'multi-disk', message: 'The archive spans several disks, which .wrack does not support.' }] };
  }
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    return { entries: [], errors: [{ code: 'zip64', message: 'The archive uses ZIP64, which .wrack does not support.' }] };
  }
  if (centralOffset + centralSize > endOffset) {
    return {
      entries: [],
      errors: [{ code: 'bad-central-directory', message: "The archive's central directory lies outside the file." }],
    };
  }

  const central = await bytesAt(file, centralOffset, centralOffset + centralSize);
  const records = parseCentral(central, count, errors);
  const entries = [];
  for (const record of records) {
    const entry = await readLocal(file, record, centralOffset, errors);
    if (entry) entries.push(entry);
  }
  checkOverlaps(entries, errors);
  for (const entry of entries) {
    delete entry.headerOffset;
    delete entry.end;
  }
  return { entries, errors };
}

/**
 * Reads the structure of a ZIP Blob or File. Resolves to { ok: true, value: { entries } }
 * or { ok: false, error: { errors: [{ code, path?, message }] } }.
 */
export async function readZip(file) {
  const { entries, errors } = await scanZip(file);
  if (errors.length > 0) return { ok: false, error: { errors } };
  return { ok: true, value: { entries } };
}

function entryError(code, entry, message) {
  return { ok: false, error: { code, path: entry.path, message } };
}

/**
 * Checks a STORE entry's data size and CRC, reading its slice in chunks. When
 * `keep` is true the bytes are returned as one Uint8Array. Resolves to
 * { ok: true, value: Uint8Array | null } or { ok: false, error: { code, path, message } }.
 */
export async function verifyEntry(entry, { keep = false } = {}) {
  const shown = showPath(entry.path);
  if (!entry.blob) return entryError('size-mismatch', entry, `${shown} is larger than the archive file.`);
  if (entry.method !== 0 || entry.compressedSize !== entry.size || entry.blob.size !== entry.size) {
    return entryError('size-mismatch', entry, `${shown} has sizes that do not match its data.`);
  }
  const bytes = keep ? new Uint8Array(entry.size) : null;
  let crc = 0;
  for (let start = 0; start < entry.size; start += CHUNK_BYTES) {
    const chunk = await bytesAt(entry.blob, start, Math.min(start + CHUNK_BYTES, entry.size));
    crc = crc32(chunk, crc);
    if (bytes) bytes.set(chunk, start);
  }
  if (crc !== entry.crc) return entryError('crc', entry, `${shown} failed its CRC check.`);
  return { ok: true, value: bytes };
}

/** Reads a STORE entry's bytes and verifies their size and CRC. Resolves like verifyEntry. */
export function readEntryBytes(entry) {
  return verifyEntry(entry, { keep: true });
}
