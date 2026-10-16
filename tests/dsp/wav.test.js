import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { EXPORT_SEED, createTpdf } from '../../src/lib/export/dither.js';
import { FORMATS, encodeWav } from '../../src/lib/export/wav-writer.js';

const FS = 48000;
const left = Float32Array.from([0, 0.5, -0.5, 1, -1, 2, -2, 0.25]);
const right = Float32Array.from([0.1, -0.1, 0.9, -0.9, 0, 0, 0.3, -0.3]);
const str = (v, at, n) => String.fromCharCode(...new Uint8Array(v.buffer, at, n));

function common(v, format, frames) {
  const f = FORMATS[format];
  assert.equal(str(v, 0, 4), 'RIFF');
  assert.equal(v.getUint32(4, true), v.byteLength - 8);
  assert.equal(str(v, 8, 4), 'WAVE');
  assert.equal(str(v, 12, 4), 'fmt ');
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(24, true), FS);
  assert.equal(v.getUint32(28, true), FS * f.blockAlign);
  assert.equal(v.getUint16(32, true), f.blockAlign);
  assert.equal(v.byteLength, f.header + frames * f.blockAlign);
}

test('16-bit: a 44-byte PCM header, block align 4, dithered samples', () => {
  const v = new DataView(encodeWav(left, right, FS, 'wav16'));
  common(v, 'wav16', 8);
  assert.equal(v.getUint32(16, true), 16);
  assert.equal(v.getUint16(20, true), 1);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(str(v, 36, 4), 'data');
  assert.equal(v.getUint32(40, true), 8 * 4);
  const tpdf = createTpdf(EXPORT_SEED);
  for (let i = 0; i < 8; i++) {
    const ql = Math.max(-32768, Math.min(32767, Math.round(left[i] * 32767 + tpdf.next())));
    const qr = Math.max(-32768, Math.min(32767, Math.round(right[i] * 32767 + tpdf.next())));
    assert.equal(v.getInt16(44 + 4 * i, true), ql + 0); // + 0 turns −0 into 0
    assert.equal(v.getInt16(46 + 4 * i, true), qr + 0);
  }
  assert.equal(v.getInt16(44 + 4 * 5, true), 32767); // clipped
  assert.equal(v.getInt16(44 + 4 * 6, true), -32768);
});

test('24-bit: a 68-byte WAVE_FORMAT_EXTENSIBLE header with the PCM subformat', () => {
  const v = new DataView(encodeWav(left, right, FS, 'wav24'));
  common(v, 'wav24', 8);
  assert.equal(v.getUint32(16, true), 40);
  assert.equal(v.getUint16(20, true), 0xfffe);
  assert.equal(v.getUint16(34, true), 24);
  assert.equal(v.getUint16(36, true), 22);
  assert.equal(v.getUint16(38, true), 24);
  assert.equal(v.getUint32(40, true), 3);
  assert.deepEqual([...new Uint8Array(v.buffer, 44, 16)], [0x01, 0, 0, 0, 0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71]);
  assert.equal(str(v, 60, 4), 'data');
  assert.equal(v.getUint32(64, true), 8 * 6);
  const sample = (frame, ch) => {
    const at = 68 + 6 * frame + 3 * ch;
    const u = v.getUint8(at) | (v.getUint8(at + 1) << 8) | (v.getUint8(at + 2) << 16);
    return u & 0x800000 ? u - 0x1000000 : u;
  };
  assert.equal(sample(1, 0), Math.round(0.5 * 8388607));
  assert.equal(sample(3, 0), 8388607);
  assert.equal(sample(6, 0), -8388608);
  assert.equal(sample(2, 1), Math.round(0.9 * 8388607));
});

test('32-bit float: a 58-byte header with a fact chunk; samples unchanged', () => {
  const v = new DataView(encodeWav(left, right, FS, 'wav32f'));
  common(v, 'wav32f', 8);
  assert.equal(v.getUint32(16, true), 18);
  assert.equal(v.getUint16(20, true), 3);
  assert.equal(v.getUint16(34, true), 32);
  assert.equal(v.getUint16(36, true), 0);
  assert.equal(str(v, 38, 4), 'fact');
  assert.equal(v.getUint32(42, true), 4);
  assert.equal(v.getUint32(46, true), 8);
  assert.equal(str(v, 50, 4), 'data');
  assert.equal(v.getUint32(54, true), 8 * 8);
  for (let i = 0; i < 8; i++) {
    assert.equal(v.getFloat32(58 + 8 * i, true), left[i]);
    assert.equal(v.getFloat32(62 + 8 * i, true), right[i]);
  }
});

test('the same input encodes to identical bytes; dither is TPDF in (−1, 1) LSB', () => {
  const hash = (b) => createHash('sha256').update(new Uint8Array(b)).digest('hex');
  assert.equal(hash(encodeWav(left, right, FS)), hash(encodeWav(left, right, FS)));
  const t = createTpdf();
  let sum = 0;
  for (let i = 0; i < 100000; i++) {
    const d = t.next();
    assert.ok(d > -1 && d < 1);
    sum += d;
  }
  assert.ok(Math.abs(sum / 100000) < 0.01);
});
