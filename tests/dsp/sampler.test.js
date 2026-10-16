import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLOCK } from '../../src/dsp/core/constants.js';
import { HALFBAND, HALFBAND_TAPS, buildMips, decimate2 } from '../../src/dsp/core/halfband.js';
import { hermite, lagrange6, linear } from '../../src/dsp/core/interp.js';
import { settleSmoothers } from '../../src/dsp/core/smoother.js';
import { IDLE, RELEASE } from '../../src/dsp/instruments/envelope.js';
import { DECAY, SamplerKernel } from '../../src/dsp/instruments/sampler.js';
import { LOOP_MODES, SAMPLER_PARAMS, resolveZone } from '../../src/dsp/instruments/sampler-zones.js';
import { GlobalVoices } from '../../src/dsp/instruments/voice-pool.js';
import { cents, peak, toneMagnitude, zeroCrossingFrequency } from '../support/signal.js';

const FS = 48000;
const loop = (name) => LOOP_MODES.indexOf(name);

function sine(freq, seconds, amp = 0.5) {
  const out = new Float32Array(Math.round(seconds * FS));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / FS);
  return out;
}

/** Mip levels 1 and 2 in the bindSource layout [[level 1 channels], [level 2 channels]]. */
function mipsOf(channels) {
  const per = channels.map((ch) => buildMips(ch));
  return [per.map((m) => m[0]), per.map((m) => m[1])];
}

function kernel(params = {}, global = new GlobalVoices()) {
  const k = new SamplerKernel(FS, global);
  for (const [id, v] of Object.entries(params)) k.setParam(id, v);
  settleSmoothers(k);
  return k;
}

function bound(channels, params = {}, mips = true) {
  const k = kernel(params);
  assert.equal(k.bindSource(channels, mips ? mipsOf(channels) : null, 'src'), true);
  return k;
}

function render(k, frames, block = BLOCK) {
  const l = new Float32Array(frames);
  const r = new Float32Array(frames);
  for (let off = 0; off < frames; off += block) k.render(l, r, off, Math.min(off + block, frames));
  return [l, r];
}

function largestStep(buf, start, end) {
  let m = 0;
  for (let i = start + 1; i < end; i++) m = Math.max(m, Math.abs(buf[i] - buf[i - 1]));
  return m;
}

test('interp: hermite is exact on quadratics and passes through x0 and x1 of a cubic; lagrange6 is exact on cubics', () => {
  const quad = (x) => 3 * x * x - 2 * x + 0.5;
  const cubic = (x) => x * x * x - x * x + 2 * x - 1;
  for (const t of [0, 0.125, 0.3, 0.5, 0.77, 0.999]) {
    assert.ok(Math.abs(hermite(quad(-1), quad(0), quad(1), quad(2), t) - quad(t)) < 1e-12, `quadratic at ${t}`);
    const p = [-2, -1, 0, 1, 2, 3].map(cubic);
    assert.ok(Math.abs(lagrange6(...p, t) - cubic(t)) < 1e-12, `lagrange6 cubic at ${t}`);
    assert.ok(Math.abs(linear(2, 5, t) - (2 + 3 * t)) < 1e-12);
  }
  assert.equal(hermite(cubic(-1), cubic(0), cubic(1), cubic(2), 0), cubic(0));
  assert.equal(hermite(cubic(-1), cubic(0), cubic(1), cubic(2), 1), cubic(1));
  // Central-difference slopes: the exact form of the coefficients.
  assert.equal(hermite(1, 2, 4, 8, 0.5), ((0.5 * 0.5 + 0) * 0.5 + 1.5) * 0.5 + 2);
});

test('halfband: 63 symmetric taps, unity DC, ≥ 76 dB stopband from 0.29·fs, flat to 0.2·fs', () => {
  assert.equal(HALFBAND.length, HALFBAND_TAPS);
  assert.equal(HALFBAND[31], 0.5);
  for (let n = 0; n < 63; n++) {
    assert.equal(HALFBAND[n], HALFBAND[62 - n]);
    if (n !== 31 && (n - 31) % 2 === 0) assert.equal(HALFBAND[n], 0);
  }
  const H = (f) => {
    let s = 0;
    for (let n = 0; n < 63; n++) s += HALFBAND[n] * Math.cos(2 * Math.PI * f * (n - 31));
    return s;
  };
  assert.ok(Math.abs(H(0) - 1) < 1e-12);
  let stop = 0;
  for (let f = 0.29; f <= 0.5; f += 1e-4) stop = Math.max(stop, Math.abs(H(f)));
  assert.ok(20 * Math.log10(stop) <= -76, `stopband ${20 * Math.log10(stop)} dB`);
  let pass = 0;
  for (let f = 0; f <= 0.2; f += 1e-4) pass = Math.max(pass, Math.abs(H(f) - 1));
  assert.ok(pass < 1e-3, `passband ripple ${pass}`);
});

test('halfband: decimate2 keeps a 0.1·fs tone and removes a 0.4·fs tone; buildMips halves twice', () => {
  const low = sine(0.1 * FS, 0.5);
  const high = sine(0.4 * FS, 0.5);
  const lowOut = decimate2(low, new Float32Array(low.length / 2));
  const highOut = decimate2(high, new Float32Array(high.length / 2));
  const gain = (out, input, f) => toneMagnitude(out, f, FS / 2, 200, 8192) / toneMagnitude(input, f, FS, 400, 16384);
  assert.ok(Math.abs(gain(lowOut, low, 0.1 * FS) - 1) < 1e-3);
  assert.ok(peak(highOut, 200, highOut.length - 200) < 0.5 * 10 ** (-70 / 20), `${peak(highOut, 200, highOut.length - 200)}`);
  const [l1, l2] = buildMips(new Float32Array(1001));
  assert.equal(l1.length, 501);
  assert.equal(l2.length, 251);
});

test('params: the instruments.md table, with valid defaults', () => {
  const ids = SAMPLER_PARAMS.map((d) => d.id);
  assert.deepEqual(ids, [
    'rootNote', 'fineTune', 'start', 'end', 'loopMode', 'loopStart', 'loopEnd', 'loopCrossfade', 'trigger',
    'attack', 'decay', 'sustain', 'release', 'cutoff', 'resonance', 'filterEnvAmount', 'velSens', 'voiceMode',
    'glide', 'pan', 'level',
  ]);
  const def = Object.fromEntries(SAMPLER_PARAMS.map((d) => [d.id, d]));
  assert.equal(def.rootNote.default, 60);
  assert.equal(def.attack.default, 2);
  assert.equal(def.decay.default, 300);
  assert.equal(def.release.default, 200);
  assert.equal(def.cutoff.default, 20000);
  assert.deepEqual(def.loopMode.options, ['off', 'forward', 'pingpong']);
});

test('resolveZone: converts fractions to frames and enforces the marker constraints', () => {
  const n = FS; // 1 s
  const ok = resolveZone({ start: 0.1, end: 0.9, loopMode: 'forward', loopStart: 0.25, loopEnd: 0.75, loopCrossfade: 10 }, n, FS);
  assert.deepEqual(ok, {
    ok: true,
    value: { startFrame: 4800, endFrame: 43200, loopStartFrame: 12000, loopEndFrame: 36000, crossfadeFrames: 480 },
  });
  const reject = (zone, frames = n) => resolveZone(zone, frames, FS);
  assert.equal(reject({ loopMode: 'forward', start: 0.3, loopStart: 0.3, loopEnd: 0.5 }).ok, false, 'start < loopStart');
  assert.equal(reject({ loopMode: 'forward', loopStart: 0.5, loopEnd: 0.4 }).ok, false, 'loopStart < loopEnd');
  assert.equal(reject({ loopMode: 'pingpong', end: 0.5, loopStart: 0.2, loopEnd: 0.6 }).ok, false, 'loopEnd ≤ end');
  assert.equal(reject({ loopMode: 'forward', loopStart: 0.5, loopEnd: 0.5 + 63 / n }).reason, 'loop-too-short');
  assert.equal(reject({ loopMode: 'forward', loopStart: 0.5, loopEnd: 0.5 + 64 / n }).ok, true, '64 frames is enough');
  assert.equal(reject({ loopMode: 'forward', loopStart: 0.2, loopEnd: 0.6, loopCrossfadeMs: 600 }).reason, 'crossfade-too-long');
  assert.equal(reject({}, 61 * FS).reason, 'source-too-long');
  assert.equal(reject({}, 60 * FS).ok, true);
  assert.equal(reject({ start: 0.5, end: 0.5 }).ok, false);
  const off = reject({ loopMode: 'off', loopStart: 0.9, loopEnd: 0.1 });
  assert.equal(off.ok, true, 'loop markers do not constrain with loop off');
  const short = reject({ loopMode: 1, start: 0, loopStart: 0.001, loopEnd: 0.5, loopCrossfade: 500 });
  assert.equal(short.value.crossfadeFrames, 48, 'crossfade ≤ loopStart − start');
});

test('pitch: a 440 Hz source at root 69 plays 880 and 220 Hz within 1 cent (with and without mips)', () => {
  const src = [sine(440, 2)];
  for (const mips of [true, false]) {
    for (const [note, freq] of [[81, 880], [57, 220], [69, 440]]) {
      const k = bound(src, { rootNote: 69 }, mips);
      k.noteOn(1, note, 100);
      const [l] = render(k, FS / 2);
      const f = zeroCrossingFrequency(l, FS, 2400, FS / 2 - 2400);
      assert.ok(Math.abs(cents(f, freq)) < 1, `note ${note}, mips ${mips}: ${f} Hz`);
    }
  }
});

test('notes beyond ±24 semitones from the root allocate no voice', () => {
  const k = bound([sine(440, 1)], { rootNote: 60 });
  k.noteOn(1, 85, 100);
  k.noteOn(2, 35, 100);
  assert.equal(k.activeVoices(), 0);
  assert.equal(k.pool.held, 0);
  k.noteOn(3, 84, 100);
  k.noteOn(4, 36, 100);
  assert.equal(k.activeVoices(), 2);
});

test('mips: a 10 kHz source at +24 semitones stays ≤ −60 dB (aliases near 0 dB without mips)', () => {
  const src = [sine(10000, 1)];
  const ref = bound(src, { rootNote: 60 });
  ref.noteOn(1, 60, 127);
  const reference = peak(render(ref, 9600)[0], 2400);
  const level = (mips) => {
    const k = bound(src, { rootNote: 60 }, mips);
    k.noteOn(1, 84, 127);
    return 20 * Math.log10(peak(render(k, 9600)[0], 2400) / reference);
  };
  const withMips = level(true);
  assert.ok(withMips <= -60, `with mips ${withMips.toFixed(1)} dB`);
  assert.ok(level(false) > -6, 'level 0 alone aliases the 40 kHz image to 8 kHz');
});

test('forward loop: the crossfaded seam has no step larger than 1.5 × the loop body\'s largest step', () => {
  // Loop length 24059 − 12000 = 12059 frames: not a whole number of 440 Hz periods.
  const src = [sine(440, 1)];
  const zone = { rootNote: 69, loopMode: loop('forward'), loopStart: 0.25, loopEnd: 24059 / FS, attack: 0 };
  const seamRatio = (crossfadeMs) => {
    const k = bound(src, { ...zone, loopCrossfade: crossfadeMs });
    k.noteOn(1, 69, 127);
    const [l] = render(k, 2 * FS);
    const body = largestStep(l, 2400, 20000);
    return largestStep(l, 2400, 2 * FS) / body;
  };
  const ratio = seamRatio(10);
  assert.ok(ratio <= 1.5, `seam/body ${ratio}`);
  assert.ok(seamRatio(0) > 1.5, 'without a crossfade the seam steps');
});

test('pingpong loop reverses at the loop markers and keeps sounding', () => {
  const k = bound([sine(440, 1)], { rootNote: 69, loopMode: loop('pingpong'), loopStart: 0.25, loopEnd: 0.5 });
  k.noteOn(1, 69, 127);
  render(k, 0.6 * FS);
  const v = k.pool.find(1);
  assert.equal(k.dir[v], -1);
  const [l] = render(k, FS);
  assert.ok(peak(l, FS - 4800) > 0.05);
  assert.ok(k.pos[v] >= 12000 && k.pos[v] <= 24000);
});

test('missing source: zeros, no voice, and one missing report per bind attempt', () => {
  const k = kernel();
  k.noteOn(1, 60, 100);
  assert.equal(k.activeVoices(), 0);
  const [l, r] = render(k, 1024);
  assert.equal(peak(l), 0);
  assert.equal(peak(r), 0);
  assert.equal(k.takeMissingReport(), false, 'no bind attempt yet');
  k.unbindSource();
  assert.equal(k.takeMissingReport(), true);
  assert.equal(k.takeMissingReport(), false);
  k.noteOn(2, 60, 100);
  assert.equal(k.takeMissingReport(), false);
  assert.equal(k.bindSource(null, null, 'gone'), false);
  assert.equal(k.takeMissingReport(), true);
  assert.equal(k.takeMissingReport(), false);
  k.bindSource([sine(440, 1)], null, 'back');
  assert.equal(k.takeMissingReport(), false);
});

test('an invalid zone starts no notes and reports once', () => {
  const k = bound([sine(440, 1)], { loopMode: loop('forward'), loopStart: 0.2, loopEnd: 0.6 });
  assert.equal(k.takeZoneReport(), null);
  k.setParam('loopEnd', 0.1);
  k.setParam('loopEnd', 0.15);
  assert.equal(k.takeZoneReport(), 'loop-markers-out-of-order');
  assert.equal(k.takeZoneReport(), null);
  k.noteOn(1, 60, 100);
  assert.equal(k.activeVoices(), 0);
  k.setParam('loopEnd', 0.7);
  k.noteOn(2, 60, 100);
  assert.equal(k.activeVoices(), 1);
});

test('no copy: the kernel holds the engine\'s channel and mip arrays', () => {
  const channels = [sine(440, 1), sine(330, 1)];
  const mips = mipsOf(channels);
  const k = kernel({ rootNote: 60 });
  k.bindSource(channels, mips, 'src');
  assert.equal(k.channels, channels);
  assert.equal(k.mips, mips);
  k.noteOn(1, 60, 100);
  k.noteOn(2, 72, 100);
  assert.equal(k.srcA[k.pool.find(1)], channels[0]);
  assert.equal(k.srcB[k.pool.find(1)], channels[1]);
  assert.equal(k.srcA[k.pool.find(2)], mips[0][0]);
});

test('stereo source: balance pan keeps each channel; a mono source pans with constant power', () => {
  const k = bound([sine(440, 1, 0.5), sine(440, 1, 0.25)], { rootNote: 69, pan: 0 });
  k.noteOn(1, 69, 127);
  const [l, r] = render(k, 9600);
  assert.ok(Math.abs(peak(l, 4800) / peak(r, 4800) - 2) < 0.01);
  const m = bound([sine(440, 1)], { rootNote: 69, pan: 1 });
  m.noteOn(1, 69, 127);
  const [ml, mr] = render(m, 9600);
  assert.ok(peak(ml, 4800) < 1e-6);
  assert.ok(Math.abs(peak(mr, 4800) - 0.5 * 0.3) < 0.002);
});

test('gate mode releases on note-off; trigger mode ignores it and ends at the region end', () => {
  const src = [sine(440, 0.5)];
  const gate = bound(src, { rootNote: 69, release: 50 });
  gate.noteOn(1, 69, 100);
  render(gate, 4800);
  gate.noteOff(1);
  assert.equal(gate.env.stage[0], RELEASE);
  render(gate, 0.06 * FS);
  assert.equal(gate.activeVoices(), 0);

  const trig = bound(src, { rootNote: 69, trigger: 1 });
  trig.noteOn(1, 69, 100);
  render(trig, 4800);
  trig.noteOff(1);
  trig.releaseSequenced();
  assert.equal(trig.env.stage[0], DECAY, 'note-off and transport stop leave a one-shot ringing');
  render(trig, 0.4 * FS);
  assert.equal(trig.activeVoices(), 1);
  const [l] = render(trig, 0.1 * FS);
  assert.equal(trig.activeVoices(), 0, 'ends after the region and a 64-frame fade');
  assert.equal(peak(l, l.length - BLOCK), 0);

  const looping = bound(src, { rootNote: 69, trigger: 1, loopMode: loop('forward'), loopStart: 0.25, loopEnd: 0.75 });
  looping.noteOn(1, 69, 100);
  render(looping, FS);
  assert.equal(looping.activeVoices(), 1, 'a looping one-shot keeps sounding');
  looping.releaseSequenced();
  assert.equal(looping.env.stage[0], RELEASE, 'transport stop releases a looping trigger voice');
});

test('ADSR: decay reaches sustain over the decay time; velSens 0 ignores velocity', () => {
  const k = bound([sine(440, 1)], { rootNote: 69, attack: 0, decay: 100, sustain: 0.5 });
  k.noteOn(1, 69, 100);
  render(k, 480);
  assert.ok(k.env.level[0] > 0.6);
  render(k, 0.1 * FS - 480);
  assert.ok(Math.abs(k.env.level[0] - 0.5) < 1e-3);
  const flat = kernel({ velSens: 0 });
  assert.equal(flat.velocityGain(1), 0.3);
  assert.equal(flat.velocityGain(127), 0.3);
  const full = kernel({ velSens: 1 });
  assert.ok(Math.abs(full.velocityGain(64) - 0.3 * (64 / 127) ** 2) < 1e-12);
});

test('Panic: allNotesOff(true) silences gate and trigger voices within 64 frames', () => {
  for (const trigger of [0, 1]) {
    const k = bound([sine(440, 1)], { rootNote: 69, trigger, loopMode: loop('forward'), loopStart: 0.25, loopEnd: 0.75 });
    for (let i = 0; i < 6; i++) k.noteOn(i, 60 + i, 127);
    render(k, 4800);
    k.allNotesOff(true);
    const [l, r] = render(k, 4 * 64);
    assert.ok(peak(l, 0, 32) > 0, 'fades rather than cuts');
    assert.ok(peak(l, 64) < 1e-9 && peak(r, 64) < 1e-9, `trigger ${trigger}: ${peak(l, 64)}`);
    assert.equal(k.activeVoices(), 0);
  }
  const soft = bound([sine(440, 1)], { rootNote: 69, trigger: 1, loopMode: loop('forward'), loopStart: 0.25, loopEnd: 0.75 });
  soft.noteOn(1, 69, 127);
  render(soft, 4800);
  soft.allNotesOff(false);
  render(soft, 0.25 * FS);
  assert.equal(soft.activeVoices(), 0, 'all-notes-off ends trigger-mode voices too');
});

test('mono: a legato note glides to its target and clamps there; releasing it glides back', () => {
  const k = bound([sine(440, 3)], { rootNote: 69, voiceMode: 1, glide: 100 });
  k.noteOn(1, 69, 100);
  render(k, 4800);
  k.noteOn(2, 81, 100);
  assert.equal(k.activeVoices(), 1, 'one voice');
  const v = k.monoVoice;
  assert.ok(k.gGlide[v] > 1);
  render(k, 0.05 * FS);
  assert.ok(k.rate[v] > 1.2 && k.rate[v] < 1.8, `halfway ${k.rate[v]}`);
  render(k, 0.06 * FS);
  assert.equal(k.rate[v], 2);
  assert.equal(k.gGlide[v], 1);
  assert.equal(k.mip[v], 1, 'level follows max(rCurrent, rTarget)');
  const [l] = render(k, 9600);
  assert.ok(Math.abs(cents(zeroCrossingFrequency(l, FS), 880)) < 1);
  k.noteOff(2);
  render(k, 0.12 * FS);
  assert.equal(k.rate[v], 1, 'back to the held note');
  assert.equal(k.env.stage[v], DECAY);
  k.noteOff(1);
  assert.equal(k.env.stage[v], RELEASE);
});

test('mono: a note after release starts a new voice; the releasing one fades', () => {
  const k = bound([sine(440, 1)], { rootNote: 69, voiceMode: 1, release: 1000 });
  k.noteOn(1, 69, 100);
  render(k, 4800);
  k.noteOff(1);
  const first = k.monoVoice;
  k.noteOn(2, 72, 100);
  assert.notEqual(k.monoVoice, first);
  render(k, BLOCK);
  assert.equal(k.env.stage[first], IDLE);
  assert.equal(k.rate[k.monoVoice], 2 ** (3 / 12));
});

test('filter: a low cutoff attenuates and the envelope amount opens it', () => {
  const src = [sine(4000, 1)];
  const at = (params) => {
    const k = bound(src, { rootNote: 69, ...params });
    k.noteOn(1, 69, 127);
    return toneMagnitude(render(k, 9600)[0], 4000, FS, 4800, 4096);
  };
  const open = at({});
  const closed = at({ cutoff: 500 });
  const swept = at({ cutoff: 500, filterEnvAmount: 1 });
  assert.ok(closed < open / 20, `${closed} vs ${open}`);
  assert.ok(swept > open / 2, `${swept} vs ${open}`);
});

test('two renders are bit-identical', () => {
  const run = () => {
    const k = bound([sine(440, 1), sine(660, 1)], {
      rootNote: 64, loopMode: loop('pingpong'), loopStart: 0.1, loopEnd: 0.4, resonance: 0.6,
      cutoff: 3000, filterEnvAmount: 0.5, decay: 200, sustain: 0.4,
    });
    k.noteOn(1, 52, 110);
    k.noteOn(2, 71, 90);
    const a = render(k, FS / 2, 100);
    k.noteOff(1);
    return [a, render(k, FS / 2, 77)];
  };
  assert.deepEqual(run(), run());
});
