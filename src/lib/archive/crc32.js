/*
 * CRC-32 as used by ZIP (assignment-3-scope.md, `.wrack` archive): reflected
 * table, polynomial 0xEDB88320, initial value and final XOR 0xFFFFFFFF.
 * `crc32` is incremental: crc32(b, crc32(a)) equals the CRC of a followed by b.
 */

/** Bytes read per Blob slice when computing a CRC. */
export const CHUNK_BYTES = 8 * 1024 * 1024;

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 of `bytes` (Uint8Array), continuing from `crc`. Returns an unsigned 32-bit integer. */
export function crc32(bytes, crc = 0) {
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** CRC-32 of a Blob, read in `chunkBytes` slices so the whole Blob is never in memory at once. */
export async function crc32Blob(blob, chunkBytes = CHUNK_BYTES) {
  let crc = 0;
  for (let start = 0; start < blob.size; start += chunkBytes) {
    const chunk = await blob.slice(start, Math.min(start + chunkBytes, blob.size)).arrayBuffer();
    crc = crc32(new Uint8Array(chunk), crc);
  }
  return crc;
}
