import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildArchive, openArchive, sha256Hex } from '../../src/lib/archive/archive.js';
import { crc32, crc32Blob } from '../../src/lib/archive/crc32.js';
import {
  MAX_ARCHIVE_BYTES,
  MAX_ENTRIES,
  MAX_JSON_DEPTH,
  MAX_PROJECT_JSON_BYTES,
  jsonDepth,
  validateArchive,
  validateEntries,
} from '../../src/lib/archive/validate.js';
import { readEntryBytes, readZip } from '../../src/lib/archive/zip-reader.js';
import { TOO_LARGE, writeZip } from '../../src/lib/archive/zip-writer.js';

const enc = new TextEncoder();
const ID_A = 'a'.repeat(64);
const ID_B = 'b'.repeat(64);
const PROJECT = enc.encode('{"id":"prj_test","sources":{}}');

const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

/**
 * A ZIP built field by field, independent of zip-writer.js, so fixtures can
 * carry values the writer refuses. Each spec is { name, data, method, flags,
 * crc, size, localSize, offset }; omitted fields take valid values.
 */
function rawZip(specs) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const spec of specs) {
    const name = enc.encode(spec.name);
    const data = spec.data ?? new Uint8Array(0);
    const crc = spec.crc ?? crc32(data);
    const size = spec.size ?? data.length;
    const method = spec.method ?? 0;
    const flags = spec.flags ?? 0x0800;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, method, true);
    lv.setUint16(12, 0x0021, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, spec.localSize ?? size, true);
    lv.setUint32(22, spec.localSize ?? size, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const header = new Uint8Array(46 + name.length);
    const cv = new DataView(header.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, method, true);
    cv.setUint16(14, 0x0021, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, spec.offset ?? offset, true);
    header.set(name, 46);
    parts.push(local, data);
    central.push(header);
    offset += local.length + data.length;
  }
  const centralSize = central.reduce((sum, h) => sum + h.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, specs.length, true);
  ev.setUint16(10, specs.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end]);
}

const project = (data = PROJECT) => ({ name: 'project.json', data });
const audio = (id, ext = 'wav', data = new Uint8Array([1, 2, 3, 4])) => ({ name: `audio/${id}.${ext}`, data });

async function messages(blob) {
  const result = await validateArchive(blob);
  assert.equal(result.ok, false, 'the archive is rejected');
  return result.error.errors.map((e) => e.message);
}

async function assertRejected(blob, message) {
  const listed = await messages(blob);
  assert.ok(listed.includes(message), `expected "${message}" in ${JSON.stringify(listed)}`);
}

test('crc32 matches the check value and is incremental', async () => {
  const digits = enc.encode('123456789');
  assert.equal(crc32(digits), 0xcbf43926);
  assert.equal(crc32(digits.subarray(4), crc32(digits.subarray(0, 4))), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
  assert.equal(await crc32Blob(new Blob([digits]), 2), 0xcbf43926);
});

test('the writer emits the specified headers', async () => {
  const data = enc.encode('hello');
  const written = await writeZip([{ path: 'project.json', data }]);
  assert.equal(written.ok, true);
  const bytes = await bytesOf(written.value);
  const view = new DataView(bytes.buffer);
  const nameLength = 'project.json'.length;
  assert.equal(bytes.length, 30 + nameLength + 5 + 46 + nameLength + 22);

  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(4, true), 20, 'version needed');
  assert.equal(view.getUint16(6, true), 0x0800, 'UTF-8 flag');
  assert.equal(view.getUint16(8, true), 0, 'method');
  assert.equal(view.getUint16(10, true), 0, 'DOS time');
  assert.equal(view.getUint16(12, true), 0x0021, 'DOS date');
  assert.equal(view.getUint32(14, true), crc32(data));
  assert.equal(view.getUint32(18, true), 5);
  assert.equal(view.getUint32(22, true), 5);
  assert.equal(view.getUint16(26, true), nameLength);
  assert.equal(view.getUint16(28, true), 0);
  assert.deepEqual(bytes.subarray(30 + nameLength, 35 + nameLength), data);

  const c = 35 + nameLength;
  assert.equal(view.getUint32(c, true), 0x02014b50);
  assert.equal(view.getUint16(c + 4, true), 20, 'version made by');
  assert.equal(view.getUint16(c + 6, true), 20);
  assert.equal(view.getUint16(c + 8, true), 0x0800);
  assert.equal(view.getUint16(c + 10, true), 0);
  assert.equal(view.getUint16(c + 12, true), 0);
  assert.equal(view.getUint16(c + 14, true), 0x0021);
  assert.equal(view.getUint32(c + 16, true), crc32(data));
  assert.equal(view.getUint32(c + 20, true), 5);
  assert.equal(view.getUint32(c + 24, true), 5);
  assert.equal(view.getUint32(c + 42, true), 0, 'local header offset');

  const e = c + 46 + nameLength;
  assert.equal(view.getUint32(e, true), 0x06054b50);
  assert.equal(view.getUint16(e + 8, true), 1);
  assert.equal(view.getUint16(e + 10, true), 1);
  assert.equal(view.getUint32(e + 12, true), 46 + nameLength);
  assert.equal(view.getUint32(e + 16, true), c);
  assert.equal(view.getUint16(e + 20, true), 0);
});

test('write → read round trip is byte-equal and deterministic', async () => {
  const blobData = new Uint8Array(20000).map((_, i) => (i * 31) & 0xff);
  const input = [
    { path: 'project.json', data: PROJECT },
    { path: `audio/${ID_A}.wav`, data: new Blob([blobData]) },
    { path: `audio/${ID_B}.flac`, data: new Uint8Array([9, 8, 7]) },
    { path: 'audio/empty.wav', data: new Uint8Array(0) },
  ];
  const first = await writeZip(input);
  const second = await writeZip(input);
  assert.deepEqual(await bytesOf(first.value), await bytesOf(second.value), 'same input, same bytes');

  const read = await readZip(first.value);
  assert.equal(read.ok, true);
  assert.deepEqual(read.value.entries.map((e) => e.path), input.map((e) => e.path));
  const expected = [PROJECT, blobData, new Uint8Array([9, 8, 7]), new Uint8Array(0)];
  for (const [i, entry] of read.value.entries.entries()) {
    const bytes = await readEntryBytes(entry);
    assert.equal(bytes.ok, true);
    assert.deepEqual(bytes.value, expected[i]);
    assert.equal(entry.size, expected[i].length);
    assert.equal(entry.crc, crc32(expected[i]));
  }
});

test('the writer refuses unsafe and repeated paths', async () => {
  for (const path of ['../x', '/x', 'C:x', 'a\\b', 'a\0b', '']) {
    const result = await writeZip([{ path, data: new Uint8Array(1) }]);
    assert.equal(result.ok, false, path);
    assert.equal(result.error.code, 'invalid-path');
  }
  const repeated = await writeZip([
    { path: 'Project.json', data: new Uint8Array(1) },
    { path: 'project.json', data: new Uint8Array(1) },
  ]);
  assert.equal(repeated.error.code, 'invalid-path');
});

test('the writer refuses archives over the size limit without reading data', async () => {
  const huge = { size: MAX_ARCHIVE_BYTES, slice: () => assert.fail('data is read') };
  const tooLarge = { ok: false, error: { code: 'too-large', message: TOO_LARGE } };
  assert.deepEqual(await writeZip([{ path: `audio/${ID_A}.wav`, data: huge }]), tooLarge);
  assert.deepEqual(await writeZip([{ path: 'x', data: new Uint8Array(100) }], { maxBytes: 100 }), tooLarge);
  const overflow = { size: 2 ** 32, slice: () => assert.fail('data is read') };
  assert.deepEqual(await writeZip([{ path: 'x', data: overflow }], { maxBytes: Infinity }), tooLarge, '32-bit size');
  const fits = await writeZip([{ path: 'x', data: new Uint8Array(100) }], { maxBytes: 30 + 46 + 2 + 100 + 22 });
  assert.equal(fits.ok, true);
});

test('a valid archive validates', async () => {
  const result = await validateArchive(rawZip([project(), audio(ID_A), audio(ID_B, 'mp3')]));
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.project, { id: 'prj_test', sources: {} });
  assert.deepEqual([...result.value.audio.keys()], [ID_A, ID_B]);
  assert.equal(result.value.audio.get(ID_A).path, `audio/${ID_A}.wav`);
  assert.deepEqual(await bytesOf(result.value.audio.get(ID_A).blob), new Uint8Array([1, 2, 3, 4]));
});

test('a traversal path is rejected', async () => {
  await assertRejected(rawZip([project(), { name: '../evil.txt' }]), 'The archive contains an unsafe path: ../evil.txt.');
  await assertRejected(rawZip([project(), { name: 'audio/../../x' }]), 'The archive contains an unsafe path: audio/../../x.');
});

test('absolute paths are rejected', async () => {
  await assertRejected(rawZip([project(), { name: '/etc/passwd' }]), 'The archive contains an absolute path: /etc/passwd.');
  await assertRejected(rawZip([project(), { name: 'C:/x.wav' }]), 'The archive contains an absolute path: C:/x.wav.');
});

test('backslash and NUL paths are rejected', async () => {
  await assertRejected(rawZip([project(), { name: 'audio\\x.wav' }]), 'The archive contains a path with a backslash: audio\\x.wav.');
  await assertRejected(rawZip([project(), { name: 'a\0b' }]), 'The archive contains a path with a NUL character: a\\0b.');
});

test('duplicate entries are rejected, compared case-insensitively', async () => {
  await assertRejected(rawZip([project(), audio(ID_A), audio(ID_A)]), `The archive lists audio/${ID_A}.wav twice.`);
  await assertRejected(
    rawZip([project(), audio(ID_A, 'wav'), audio(ID_A, 'WAV')]),
    `The archive lists audio/${ID_A}.wav and audio/${ID_A}.WAV, which differ only in letter case.`,
  );
  await assertRejected(rawZip([project(), project()]), 'The archive lists project.json twice.');
});

test('an entry whose header size exceeds the file is rejected', async () => {
  const blob = rawZip([project(), { ...audio(ID_A), size: 0x7fffffff }]);
  await assertRejected(blob, `audio/${ID_A}.wav is larger than the archive file.`);
  const read = await readZip(blob);
  assert.equal(read.ok, false);
  assert.ok(read.error.errors.some((e) => e.code === 'size-mismatch' && e.path === `audio/${ID_A}.wav`));
});

test('a local header that disagrees with the central directory is rejected', async () => {
  await assertRejected(
    rawZip([project(), { ...audio(ID_A), localSize: 3 }]),
    `audio/${ID_A}.wav has a local header that does not match the central directory.`,
  );
});

test('overlapping entries are rejected', async () => {
  await assertRejected(rawZip([project(), { ...audio(ID_A), offset: 0 }]), `audio/${ID_A}.wav overlaps another entry.`);
});

test('project.json deeper than 64 levels is rejected; 64 levels are accepted', async () => {
  const nested = (levels) => enc.encode('{"d":'.repeat(levels - 1) + '{}' + '}'.repeat(levels - 1));
  assert.equal(jsonDepth(new TextDecoder().decode(nested(MAX_JSON_DEPTH))), 64);
  assert.equal((await validateArchive(rawZip([project(nested(64))]))).ok, true);
  await assertRejected(rawZip([project(nested(65))]), 'project.json is nested more than 64 levels deep.');
  const deep = enc.encode('['.repeat(200000) + ']'.repeat(200000));
  await assertRejected(rawZip([project(deep)]), 'project.json is nested more than 64 levels deep.');
  assert.equal(jsonDepth('{"s":"[[[[{{\\"[["}'), 1, 'brackets inside strings do not count');
});

test('project.json over 5 MB is rejected', async () => {
  const big = new Uint8Array(MAX_PROJECT_JSON_BYTES + 1).fill(0x20);
  await assertRejected(rawZip([project(big)]), 'project.json is larger than 5 MB.');
});

test('invalid project.json text is rejected', async () => {
  await assertRejected(rawZip([project(enc.encode('{not json'))]), 'project.json is not valid JSON.');
  await assertRejected(rawZip([project(enc.encode('[]'))]), 'project.json does not contain a project.');
  await assertRejected(rawZip([project(new Uint8Array([0x7b, 0xff, 0x7d]))]), 'project.json is not valid UTF-8 text.');
});

test('a non-zero method is rejected', async () => {
  await assertRejected(
    rawZip([project(), { ...audio(ID_A), method: 8 }]),
    `audio/${ID_A}.wav is compressed; .wrack archives store files uncompressed.`,
  );
});

test('the encryption flag is rejected', async () => {
  await assertRejected(rawZip([project(), { ...audio(ID_A), flags: 0x0801 }]), `audio/${ID_A}.wav is encrypted.`);
});

test('a corrupted CRC is rejected', async () => {
  await assertRejected(rawZip([project(), { ...audio(ID_A), crc: 0x12345678 }]), `audio/${ID_A}.wav failed its CRC check.`);
  const written = await writeZip([{ path: 'project.json', data: PROJECT }]);
  const bytes = await bytesOf(written.value);
  bytes[30 + 'project.json'.length + 2] ^= 0xff;
  await assertRejected(new Blob([bytes]), 'project.json failed its CRC check.');
});

test('more than 1000 entries are rejected', async () => {
  const specs = [project()];
  for (let i = 0; i < MAX_ENTRIES; i++) specs.push(audio(i.toString(16).padStart(64, '0')));
  assert.equal(specs.length, 1001);
  await assertRejected(rawZip(specs), 'The archive contains 1001 entries; the limit is 1000.');
  assert.equal((await validateArchive(rawZip(specs.slice(0, MAX_ENTRIES)))).ok, true, '1000 entries are accepted');
});

test('a truncated file or a missing end record is rejected', async () => {
  const message = 'The file is not a .wrack archive, or it is truncated: its end record is missing.';
  const bytes = await bytesOf(rawZip([project(), audio(ID_A)]));
  await assertRejected(new Blob([bytes.subarray(0, bytes.length - 10)]), message);
  await assertRejected(new Blob([bytes.subarray(0, 40)]), message);
  await assertRejected(new Blob([enc.encode('RIFF....WAVE')]), message);
  await assertRejected(new Blob([]), message);
  const read = await readZip(new Blob([bytes.subarray(0, bytes.length - 1)]));
  assert.deepEqual(read.error.errors.map((e) => e.code), ['no-end-record']);
});

test('the layout allows only project.json and audio/<sourceId>.<ext>', async () => {
  await assertRejected(rawZip([audio(ID_A)]), 'The archive does not contain project.json.');
  await assertRejected(rawZip([project(), { name: 'notes.txt' }]), 'The archive contains an unexpected entry: notes.txt.');
  await assertRejected(rawZip([project(), { name: 'audio/ABC.wav' }]), 'The archive contains an unexpected entry: audio/ABC.wav.');
  await assertRejected(
    rawZip([project(), audio(ID_A, 'wav'), audio(ID_A, 'mp3')]),
    `The archive contains more than one file for source ${ID_A}: audio/${ID_A}.wav and audio/${ID_A}.mp3.`,
  );
});

test('every problem is listed', async () => {
  const listed = await messages(rawZip([{ name: '../x' }, { name: 'a\\b', method: 8 }, audio(ID_A), audio(ID_A)]));
  assert.deepEqual(listed, [
    'The archive contains an unsafe path: ../x.',
    'The archive contains a path with a backslash: a\\b.',
    'a\\b is compressed; .wrack archives store files uncompressed.',
    `The archive lists audio/${ID_A}.wav twice.`,
    'The archive does not contain project.json.',
  ]);
});

test('validateEntries checks parsed entries without data', () => {
  const entry = (path) => ({ path, size: 1, compressedSize: 1, crc: 0, method: 0, flags: 0x0800, blob: null });
  assert.equal(validateEntries([entry('project.json'), entry(`audio/${ID_A}.wav`)]).ok, true);
  const result = validateEntries([entry('project.json'), entry('/abs')]);
  assert.deepEqual(result.error.errors.map((e) => e.code), ['absolute-path']);
});

test('buildArchive → openArchive round trip matches SHA-256 source IDs', async () => {
  const wav = new Uint8Array(4096).map((_, i) => i & 0xff);
  const mp3 = enc.encode('ID3 not really an mp3');
  const wavId = await sha256Hex(wav.buffer);
  const mp3Id = await sha256Hex(mp3.buffer);
  const missingId = 'c'.repeat(64);
  const doc = {
    id: 'prj_round',
    name: 'Round trip',
    sources: {
      [wavId]: { id: wavId, name: 'kick.wav', path: `audio/${wavId}.wav` },
      [mp3Id]: { id: mp3Id, name: 'vox.mp3', path: `audio/${mp3Id}.mp3` },
      [missingId]: { id: missingId, name: 'gone.wav', path: `audio/${missingId}.wav` },
    },
  };
  const sources = [
    { sourceId: wavId, bytes: new Blob([wav]) },
    { sourceId: mp3Id, bytes: new Blob([mp3]) },
    { sourceId: 'd'.repeat(64), bytes: new Blob([enc.encode('unreferenced')]) },
  ];
  const built = await buildArchive(doc, sources);
  assert.equal(built.ok, true);
  assert.deepEqual(built.value.missing, [missingId]);
  const again = await buildArchive(doc, sources);
  assert.deepEqual(await bytesOf(built.value.blob), await bytesOf(again.value.blob), 'deterministic');

  const read = await readZip(built.value.blob);
  assert.deepEqual(read.value.entries.map((e) => e.path), ['project.json', `audio/${wavId}.wav`, `audio/${mp3Id}.mp3`]);

  const opened = await openArchive(built.value.blob);
  assert.equal(opened.ok, true);
  assert.deepEqual(opened.value.project, doc);
  assert.deepEqual([...opened.value.audio.keys()], [wavId, mp3Id]);
  assert.deepEqual(await bytesOf(opened.value.audio.get(wavId)), wav);
  assert.deepEqual(await bytesOf(opened.value.audio.get(mp3Id)), mp3);
});

test('openArchive rejects audio whose bytes do not hash to its source ID', async () => {
  const result = await openArchive(rawZip([project(), audio(ID_A)]));
  assert.equal(result.ok, false);
  assert.deepEqual(result.error.errors, [
    { code: 'hash-mismatch', path: `audio/${ID_A}.wav`, message: `audio/${ID_A}.wav does not match its source ID.` },
  ]);
});

test('buildArchive refuses a source path outside the layout and passes writer errors through', async () => {
  const doc = { id: 'prj_bad', sources: { [ID_A]: { id: ID_A, path: '../x.wav' } } };
  const bad = await buildArchive(doc, [{ sourceId: ID_A, bytes: new Blob([new Uint8Array(1)]) }]);
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'invalid-path');

  const ok = { id: 'prj_big', sources: { [ID_A]: { id: ID_A, path: `audio/${ID_A}.wav` } } };
  const huge = { size: MAX_ARCHIVE_BYTES, slice: () => assert.fail('data is read') };
  assert.deepEqual(await buildArchive(ok, [{ sourceId: ID_A, bytes: huge }]), {
    ok: false,
    error: { code: 'too-large', message: TOO_LARGE },
  });
});

test('validateArchive refuses a file over 500 MB without reading it', async () => {
  const huge = { size: MAX_ARCHIVE_BYTES + 1, slice: () => assert.fail('data is read') };
  assert.deepEqual(await messages(huge), ['The archive file is larger than 500 MB.']);
});
