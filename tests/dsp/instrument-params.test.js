/*
 * The synth parameters carried over from the assignment 2 synths
 * (docs/instruments.md): ADSR decay and sustain, filter envelope, FM fine,
 * additive vibrato, pluck pick position and release, granular position,
 * pitch spread, envelope and File source, and per-instrument tuning.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AdditiveKernel } from '../../src/dsp/instruments/additive.js';
import { FmKernel } from '../../src/dsp/instruments/fm.js';
import { GranularKernel, SOURCES } from '../../src/dsp/instruments/granular.js';
import { PluckKernel } from '../../src/dsp/instruments/pluck.js';
import { INSTRUMENTS } from '../../src/dsp/instruments/registry.js';
import { SubtractiveKernel, WAVEFORMS } from '../../src/dsp/instruments/subtractive.js';
import { GlobalVoices } from '../../src/dsp/instruments/voice-pool.js';
import { cents, peak, toneMagnitude, zeroCrossingFrequency } from '../support/signal.js';

const FS = 48000;

function make(Kernel, params = {}) {
  const k = new Kernel(FS, new GlobalVoices());
  for (const [id, v] of Object.entries(params)) k.setParam(id, v);
  return k;
}

function render(k, frames, block = 128) {
  const out = new Float32Array(frames);
  for (let off = 0; off < frames; off += block) k.render(out, off, Math.min(off + block, frames));
  return out;
}

const rms = (buf, start, end) => {
  let s = 0;
  for (let i = start; i < end; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / (end - start));
};

test('every synth lists the reference parameters with their ranges and defaults', () => {
  const ids = (type) => INSTRUMENTS[type].params.map((d) => d.id);
  const tuning = ['octave', 'cents'];
  assert.deepEqual(ids('subtractive'), ['waveform', 'cutoff', 'resonance', 'envAmount', 'attack', 'decay', 'sustain', 'release', ...tuning]);
  assert.deepEqual(ids('fm'), ['ratio', 'fine', 'index', 'indexDecay', 'attack', 'decay', 'sustain', 'release', ...tuning]);
  assert.deepEqual(ids('additive'), ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'attack', 'decay', 'sustain', 'release', 'vibratoRate', 'vibratoDepth', ...tuning]);
  assert.deepEqual(ids('pluck'), ['damping', 'brightness', 'pickPosition', 'decay', 'release', ...tuning]);
  assert.deepEqual(ids('granular'), ['source', 'position', 'grainSize', 'density', 'spray', 'pitchSpread', 'attack', 'release', ...tuning]);
  const def = (type, id) => INSTRUMENTS[type].params.find((d) => d.id === id);
  assert.deepEqual([def('subtractive', 'envAmount').min, def('subtractive', 'envAmount').max, def('subtractive', 'envAmount').default], [0, 6, 0]);
  assert.deepEqual([def('fm', 'fine').min, def('fm', 'fine').max, def('fm', 'fine').default], [-0.5, 0.5, 0]);
  assert.deepEqual([def('additive', 'vibratoRate').min, def('additive', 'vibratoRate').max, def('additive', 'vibratoRate').default], [0.5, 12, 5]);
  assert.deepEqual([def('pluck', 'release').min, def('pluck', 'release').max, def('pluck', 'release').default], [0.02, 2, 0.1]);
  assert.deepEqual([def('granular', 'attack').default, def('granular', 'release').default, def('granular', 'pitchSpread').max], [0.05, 0.4, 1200]);
  assert.deepEqual([def('fm', 'octave').min, def('fm', 'octave').max, def('fm', 'cents').min, def('fm', 'cents').max], [-3, 3, -100, 100]);
});

test('ADSR: the level decays to the sustain fraction and holds there', () => {
  const sine = WAVEFORMS.indexOf('sine');
  const held = make(SubtractiveKernel, { waveform: sine, cutoff: 16000, attack: 0.002, sustain: 1 });
  const half = make(SubtractiveKernel, { waveform: sine, cutoff: 16000, attack: 0.002, decay: 0.1, sustain: 0.5 });
  held.noteOn(1, 69, 100);
  half.noteOn(1, 69, 100);
  const a = render(held, FS);
  const b = render(half, FS);
  const ratio = rms(b, 0.5 * FS, FS) / rms(a, 0.5 * FS, FS);
  assert.ok(Math.abs(ratio - 0.5) < 0.01, `sustain level ${ratio}`);
  // Early in the decay the level is still above sustain.
  assert.ok(rms(b, 0.01 * FS, 0.02 * FS) / rms(a, 0.01 * FS, 0.02 * FS) > 0.6);
});

test('ADSR: sustain 0 ends a held note once the decay dies away', () => {
  const k = make(FmKernel, { attack: 0.002, decay: 0.05, sustain: 0 });
  k.noteOn(1, 60, 100);
  render(k, FS / 2);
  assert.equal(k.activeVoices(), 0);
});

test('filter envelope: the cutoff opens on the attack and settles to sustain', () => {
  const saw = WAVEFORMS.indexOf('saw');
  const base = { waveform: saw, cutoff: 200, resonance: 0, attack: 0.05, decay: 0.2, sustain: 1 };
  const plain = make(SubtractiveKernel, base);
  const swept = make(SubtractiveKernel, { ...base, envAmount: 4 });
  plain.noteOn(1, 45, 127); // 110 Hz
  swept.noteOn(1, 45, 127);
  const a = render(plain, FS);
  const b = render(swept, FS);
  // With sustain 1 the envelope holds at its peak: 200 Hz × 2^4 = 3.2 kHz lets the 20th harmonic through.
  const h = 110 * 20;
  assert.ok(toneMagnitude(b, h, FS, FS / 2, 8192) > 10 * toneMagnitude(a, h, FS, FS / 2, 8192));
});

test('filter envelope depth is capped at 0.45·fs and stays finite at the extremes', () => {
  const k = make(SubtractiveKernel, { waveform: WAVEFORMS.indexOf('saw'), cutoff: 16000, resonance: 20, envAmount: 6, attack: 0.002 });
  k.noteOn(1, 120, 127);
  const out = render(k, FS / 4);
  assert.ok(out.every(Number.isFinite));
  assert.equal(k.envOct[k.pool.find(1)], Math.max(0, Math.min(6, Math.log2((0.45 * FS) / 16000))));
});

test('FM fine moves the modulator off the ratio grid', () => {
  const k0 = make(FmKernel, { ratio: 1, fine: 0, index: 2, indexDecay: 4 });
  const k1 = make(FmKernel, { ratio: 1, fine: 0.41, index: 2, indexDecay: 4 });
  k0.noteOn(1, 57, 127); // 220 Hz
  k1.noteOn(1, 57, 127);
  const a = render(k0, FS);
  const b = render(k1, FS);
  // Ratio 1 puts sidebands on harmonics of 220 Hz; fine 0.41 puts one at 220 + 1.41·220.
  const side = 220 + 1.41 * 220;
  assert.ok(toneMagnitude(b, side, FS, 4800, 16384) > 5 * toneMagnitude(a, side, FS, 4800, 16384));
});

test('additive vibrato swings the pitch by the depth and leaves depth 0 untouched', () => {
  const steady = make(AdditiveKernel, { h2: 0, h3: 0, h4: 0, h5: 0, h6: 0, h7: 0, h8: 0, vibratoDepth: 0 });
  steady.noteOn(1, 69, 100);
  const s = render(steady, FS);
  assert.ok(Math.abs(cents(zeroCrossingFrequency(s, FS, 4800, FS - 4800), 440)) < 1);
  const vib = make(AdditiveKernel, { h2: 0, h3: 0, h4: 0, h5: 0, h6: 0, h7: 0, h8: 0, vibratoRate: 2, vibratoDepth: 100 });
  vib.noteOn(1, 69, 100);
  const v = render(vib, FS);
  // A quarter cycle of a 2 Hz LFO from phase 0 ends at the top of the swing (+100 cents).
  const up = zeroCrossingFrequency(v, FS, 0.11 * FS, 0.03 * FS);
  const down = zeroCrossingFrequency(v, FS, 0.36 * FS, 0.03 * FS);
  assert.ok(cents(up, 440) > 80, `top ${cents(up, 440)} cents`);
  assert.ok(cents(down, 440) < -80, `bottom ${cents(down, 440)} cents`);
});

test('pluck pick position 0.5 removes the even harmonics', () => {
  const at = (pickPosition) => {
    const k = make(PluckKernel, { pickPosition, brightness: 1, damping: 0, decay: 10 });
    k.noteOn(1, 45, 127); // 110 Hz
    return render(k, FS / 2);
  };
  const plain = at(0);
  const middle = at(0.5);
  const ratio = (buf) => toneMagnitude(buf, 220, FS, 2400, 16384) / toneMagnitude(buf, 110, FS, 2400, 16384);
  assert.ok(ratio(middle) < 0.2 * ratio(plain), `${ratio(middle)} vs ${ratio(plain)}`);
});

test('pluck release mutes the string after note-off; the voice ends once it dies away', () => {
  const tail = (release) => {
    const k = make(PluckKernel, { decay: 10, release });
    k.noteOn(1, 57, 127);
    render(k, FS / 10);
    k.noteOff(1);
    const out = render(k, FS);
    return { k, level: rms(out, 0.2 * FS, 0.3 * FS) };
  };
  const short = tail(0.05);
  const long = tail(2);
  assert.ok(short.level < 0.01 * long.level, `${short.level} vs ${long.level}`);
  assert.equal(short.k.activeVoices(), 0);
  assert.ok(long.k.activeVoices() > 0);
  // Without a note-off the string still ends when it has decayed.
  const held = make(PluckKernel, { decay: 0.2 });
  held.noteOn(1, 69, 127);
  render(held, 2 * FS);
  assert.equal(held.activeVoices(), 0);
});

test('granular position and spray 0 place every grain at position·(L − c)', () => {
  const k = make(GranularKernel, { position: 0.25, spray: 0, density: 60 });
  k.noteOn(1, 60, 100);
  const starts = new Set();
  for (let off = 0; off < FS / 4; off += 128) {
    k.render(new Float32Array(128), 0, 128);
    for (let g = 0; g < k.maxGrains; g++) if (k.gActive[g] && k.gAge[g] <= 128) starts.add(Math.round(k.gPos[g] - k.gAge[g] * k.gInc[g]));
  }
  const L = k.sourceLength;
  const c = Math.round(0.06 * FS) * k.inc[k.pool.find(1)];
  for (const s of starts) assert.ok(Math.abs(s - 0.25 * (L - 1 - c)) < 2, `grain start ${s}`);
});

test('granular pitch spread detunes grains; noise ignores the pitch', () => {
  const rates = (params) => {
    const k = make(GranularKernel, { density: 60, ...params });
    k.noteOn(1, 60, 100);
    const seen = new Set();
    for (let off = 0; off < FS / 2; off += 128) {
      k.render(new Float32Array(128), 0, 128);
      for (let g = 0; g < k.maxGrains; g++) if (k.gActive[g]) seen.add(k.gInc[g].toFixed(6));
    }
    return [...seen].map(Number);
  };
  assert.equal(rates({ pitchSpread: 0 }).length, 1);
  const spread = rates({ pitchSpread: 1200 });
  assert.ok(spread.length > 5);
  assert.ok(Math.max(...spread) / Math.min(...spread) > 1.5);
  assert.deepEqual(rates({ source: SOURCES.indexOf('noise'), pitchSpread: 1200 }), [1]);
});

test('granular File source is silent until bound, then plays the file mixed to mono', () => {
  const file = SOURCES.indexOf('sample');
  const k = make(GranularKernel, { source: file, attack: 0.002 });
  k.noteOn(1, 60, 127);
  assert.equal(peak(render(k, FS / 4)), 0);
  const left = new Float32Array(FS);
  const right = new Float32Array(FS);
  for (let i = 0; i < FS; i++) left[i] = right[i] = Math.sin((2 * Math.PI * 261.63 * i) / FS);
  assert.equal(k.bindSource([left, right]), true);
  const out = render(k, FS / 2);
  assert.ok(peak(out) > 0.01);
  assert.ok(toneMagnitude(out, 261.63, FS, 2400, 16384) > 5 * toneMagnitude(out, 300, FS, 2400, 16384));
  k.unbindSource();
  assert.equal(k.takeMissingReport(), true);
  assert.equal(k.activeGrains(), 0);
});

test('granular attack and release shape each voice', () => {
  const k = make(GranularKernel, { attack: 0.5, release: 0.05, density: 60 });
  k.noteOn(1, 60, 127);
  const out = render(k, FS);
  assert.ok(rms(out, 0, 0.1 * FS) < 0.5 * rms(out, 0.6 * FS, FS));
  k.noteOff(1);
  render(k, FS / 4);
  assert.equal(k.activeVoices(), 0);
});

test('tuning: octave +1 doubles the frequency, cents shift it, and pitch clamps to MIDI 127', () => {
  const sine = WAVEFORMS.indexOf('sine');
  const freq = (params, pitch = 69) => {
    const k = make(SubtractiveKernel, { waveform: sine, cutoff: 16000, ...params });
    k.noteOn(1, pitch, 100);
    return zeroCrossingFrequency(render(k, FS), FS, 4800, FS - 4800);
  };
  assert.ok(Math.abs(cents(freq({ octave: 1 }), 880)) < 1);
  assert.ok(Math.abs(cents(freq({ octave: -2, cents: 50 }), 110 * 2 ** (50 / 1200))) < 1);
  const k = make(FmKernel, { octave: 3 });
  assert.ok(Math.abs(k.noteHz(120) - 440 * 2 ** ((127 - 69) / 12)) < 1e-6);
  const p = make(PluckKernel, { octave: 1 });
  p.noteOn(1, 57, 127);
  assert.ok(Math.abs(p.freq[p.pool.find(1)] - 440) < 1e-6);
});
