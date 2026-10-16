/*
 * WAV writer (a3-audio-implementation.md, WAV writer; export.md). Stereo,
 * little-endian, one preallocated ArrayBuffer filled through a DataView:
 *   wav16  — 44-byte header, PCM (format 1), TPDF dither;
 *   wav24  — 68-byte header, WAVE_FORMAT_EXTENSIBLE (0xFFFE), no dither;
 *   wav32f — 58-byte header, IEEE float (format 3) with a fact chunk.
 * RIFF size = file length − 8; data size = frames·blockAlign (even for
 * stereo in every format, so no pad byte is needed).
 */
import { createTpdf } from './dither.js';

export const FORMATS = Object.freeze({
  wav16: Object.freeze({ header: 44, blockAlign: 4, bits: 16, label: 'WAV 16-bit (dithered)' }),
  wav24: Object.freeze({ header: 68, blockAlign: 6, bits: 24, label: 'WAV 24-bit' }),
  wav32f: Object.freeze({ header: 58, blockAlign: 8, bits: 32, label: 'WAV 32-bit float' }),
});

const CHANNELS = 2;
/** KSDATAFORMAT_SUBTYPE_PCM: 00000001-0000-0010-8000-00AA00389B71, in file byte order. */
// eslint-disable-next-line no-restricted-syntax -- 0x80 is a GUID byte, not the render quantum
const PCM_SUBFORMAT = [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71];

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

function ascii(view, at, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
}

/** Writes one 24-bit sample, little-endian, without dither. */
function write24(view, at, x) {
  const q = clamp(Math.round(x * 8388607), -8388608, 8388607);
  view.setUint8(at, q & 0xff);
  view.setUint8(at + 1, (q >> 8) & 0xff);
  view.setUint8(at + 2, (q >> 16) & 0xff);
}

/** Writes the header for `format` and returns the data offset. */
function writeHeader(view, format, frames, fs) {
  const f = FORMATS[format];
  const dataBytes = frames * f.blockAlign;
  ascii(view, 0, 'RIFF');
  view.setUint32(4, f.header + dataBytes - 8, true);
  ascii(view, 8, 'WAVE');
  ascii(view, 12, 'fmt ');
  const fmtSize = format === 'wav16' ? 16 : format === 'wav24' ? 40 : 18;
  view.setUint32(16, fmtSize, true);
  view.setUint16(20, format === 'wav16' ? 1 : format === 'wav24' ? 0xfffe : 3, true);
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, fs, true);
  view.setUint32(28, fs * f.blockAlign, true);
  view.setUint16(32, f.blockAlign, true);
  view.setUint16(34, f.bits, true);
  let at = 36;
  if (format === 'wav24') {
    view.setUint16(36, 22, true); // cbSize
    view.setUint16(38, 24, true); // wValidBitsPerSample
    view.setUint32(40, 0x3, true); // dwChannelMask: front left, front right
    PCM_SUBFORMAT.forEach((b, i) => view.setUint8(44 + i, b));
    at = 60;
  } else if (format === 'wav32f') {
    view.setUint16(36, 0, true); // cbSize
    ascii(view, 38, 'fact');
    view.setUint32(42, 4, true);
    view.setUint32(46, frames, true); // dwSampleLength
    at = 50;
  }
  ascii(view, at, 'data');
  view.setUint32(at + 4, dataBytes, true);
  return at + 8;
}

/**
 * Encodes stereo `left`/`right` (Float32Arrays of equal length) at `fs` as
 * `format` ('wav16', 'wav24' or 'wav32f'). Returns an ArrayBuffer.
 * `seed` fixes the 16-bit dither.
 */
export function encodeWav(left, right, fs, format = 'wav16', seed) {
  const f = FORMATS[format];
  if (!f) throw new Error(`Unknown WAV format: ${format}`);
  const frames = left.length;
  const buffer = new ArrayBuffer(f.header + frames * f.blockAlign);
  const view = new DataView(buffer);
  let at = writeHeader(view, format, frames, fs);
  if (format === 'wav16') {
    const tpdf = createTpdf(seed);
    for (let i = 0; i < frames; i++) {
      view.setInt16(at, clamp(Math.round(left[i] * 32767 + tpdf.next()), -32768, 32767), true);
      view.setInt16(at + 2, clamp(Math.round(right[i] * 32767 + tpdf.next()), -32768, 32767), true);
      at += 4;
    }
  } else if (format === 'wav24') {
    for (let i = 0; i < frames; i++) {
      write24(view, at, left[i]);
      write24(view, at + 3, right[i]);
      at += 6;
    }
  } else {
    for (let i = 0; i < frames; i++) {
      view.setFloat32(at, left[i], true);
      view.setFloat32(at + 4, right[i], true);
      at += 8;
    }
  }
  return buffer;
}
