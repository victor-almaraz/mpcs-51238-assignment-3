import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { Engine, INSTRUMENT_PARAM_BASE, MASTER_METER, MASTER_TARGET, PARAM_GAIN, PARAM_MUTE, PARAM_PAN, PARAM_SOLO } from '../../src/dsp/engine/engine.js';
import { emptyModel } from '../../src/dsp/engine/model.js';
import { METER_FIELDS } from '../../src/dsp/mixer/meter.js';
import { ChannelStrip, faderGain } from '../../src/dsp/mixer/mixer.js';
import { balance, constantPower } from '../../src/dsp/mixer/pan.js';
import { compileModel } from '../../src/lib/audio/compile-model.js';
import { paramChanges } from '../../src/lib/audio/param-changes.js';
import { EXAMPLES } from '../../src/lib/project/examples.js';
import { setDeviceParam, setTempo, setTrack } from '../../src/lib/project/model.js';
import { peak } from '../support/signal.js';

const FS = 48000;
const settled = (fs) => {
  const s = new ChannelStrip(fs);
  return s;
};

function mixStrip(strip, srcL, srcR, stereo) {
  const n = srcL.length;
  const busL = new Float32Array(n);
  const busR = new Float32Array(n);
  const oL = new Float32Array(n);
  const oR = new Float32Array(n);
  strip.mix(srcL, srcR, stereo, n, busL, busR, 0, oL, oR);
  return [busL, busR];
}

function snapStrip(strip) {
  strip.gain.snap(strip.gain.target);
  strip.pan.snap(strip.pan.target);
  strip.gate.snap(strip.gate.target);
}

test('pan laws: centre is −3.01 dB per side for mono and unity for stereo', () => {
  const g = new Float64Array(2);
  constantPower(0, g);
  assert.ok(Math.abs(g[0] - Math.SQRT1_2) < 1e-12 && Math.abs(g[1] - Math.SQRT1_2) < 1e-12);
  balance(0, g);
  assert.deepEqual([...g], [1, 1]);
  balance(-0.5, g);
  assert.deepEqual([...g], [1, 0.5]);
  balance(0.25, g);
  assert.deepEqual([...g], [0.75, 1]);
});

test('centre pan gives equal channels for mono and stereo sources', () => {
  const src = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i / 5));
  for (const stereo of [false, true]) {
    const strip = settled(FS);
    const [l, r] = mixStrip(strip, src, src, stereo);
    assert.deepEqual(l, r, stereo ? 'stereo' : 'mono');
  }
});

test('full left gives silence on the right for mono and stereo sources', () => {
  const src = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i / 5));
  for (const stereo of [false, true]) {
    const strip = settled(FS);
    strip.setPan(-1);
    snapStrip(strip);
    const [l, r] = mixStrip(strip, src, src, stereo);
    assert.ok(peak(l) > 0.5);
    assert.equal(peak(r), 0, stereo ? 'stereo' : 'mono');
  }
});

test('fader: −∞ at the minimum, +6 dB at the maximum', () => {
  assert.equal(faderGain(-60), 0);
  assert.ok(Math.abs(faderGain(6) - 1.9953) < 1e-4);
  const strip = settled(FS);
  strip.setGainDb(-60);
  snapStrip(strip);
  const [l] = mixStrip(strip, new Float32Array(128).fill(1), new Float32Array(128).fill(1), true);
  assert.equal(peak(l), 0);
});

/** Engine with subtractive tracks (one note each, held for 1 s) and the given mixer fields. */
function engineWith(tracks, masterPan = 0) {
  const e = new Engine(FS);
  e.setModel(
    e.prepareModel({
      ...emptyModel(FS),
      masterPan,
      tracks: tracks.map((t, i) => ({
        trackId: `trk_${i}`,
        deviceId: `dev_${i}`,
        type: t.type ?? 'subtractive',
        params: {},
        gainDb: t.gainDb ?? 0,
        pan: t.pan ?? 0,
        mute: t.mute ?? false,
        solo: t.solo ?? false,
        notes: { start: Int32Array.of(0), end: Int32Array.of(FS), pitch: Uint8Array.of(t.pitch ?? 60), vel: Uint8Array.of(127) },
      })),
    }),
  );
  return e;
}

function renderEngine(e, frames, quantum = 128) {
  const l = new Float32Array(frames);
  const r = new Float32Array(frames);
  for (let off = 0; off < frames; off += quantum) {
    const end = Math.min(off + quantum, frames);
    e.process(l.subarray(off, end), r.subarray(off, end), 0, end - off);
  }
  return [l, r];
}

test('solo-in-place: soloed tracks play, others are silent; mute silences', () => {
  const both = engineWith([{}, {}]);
  both.play(0);
  renderEngine(both, 4800);
  const m1 = both.readMeters();
  assert.ok(m1[0] > 0 && m1[METER_FIELDS] > 0, 'both tracks sound');
  const solo = engineWith([{ solo: true }, {}]);
  solo.play(0);
  renderEngine(solo, 4800);
  const m2 = solo.readMeters();
  assert.ok(m2[0] > 0);
  assert.equal(m2[METER_FIELDS], 0, 'the unsoloed track is silent');
  const muted = engineWith([{ mute: true, solo: true }]);
  muted.play(0);
  const [l] = renderEngine(muted, 4800);
  assert.equal(peak(l), 0, 'mute wins over solo');
});

test('master pan applies balance', () => {
  const e = engineWith([{}], -1);
  e.play(0);
  const [l, r] = renderEngine(e, 9600);
  assert.ok(peak(l) > 0.01);
  assert.equal(peak(r), 0);
});

test('meters report peak and mean square per track and for the master', () => {
  const e = engineWith([{ pitch: 69 }]);
  e.play(0);
  renderEngine(e, 4800);
  renderEngine(e, 4800);
  const m = e.readMeters();
  const [l] = [m[0]];
  assert.ok(l > 0.05 && l < 0.3);
  assert.ok(m[2] > 0 && m[2] < l * l, 'mean square below peak²');
  const master = MASTER_METER * METER_FIELDS;
  assert.ok(Math.abs(m[master] - l * 0.2512) < 0.01, 'master meter after −12 dB master volume');
  const again = e.readMeters();
  assert.equal(again[0], 0, 'reading resets the window');
});

test('params: gain, pan, mute and instrument parameters apply without a new model', () => {
  const e = engineWith([{}, {}]);
  e.applyParams(Float64Array.of(0, PARAM_GAIN, -6, 1, PARAM_MUTE, 1, 0, PARAM_PAN, 0.5, MASTER_TARGET, PARAM_PAN, 0.25));
  const [a, b] = e.model.tracks;
  assert.ok(Math.abs(a.strip.gain.target - 10 ** (-6 / 20)) < 1e-12);
  assert.equal(a.strip.pan.target, 0.5);
  assert.equal(b.strip.gate.target, 0);
  assert.equal(e.masterPan.target, 0.25);
  e.applyParams(Float64Array.of(1, PARAM_SOLO, 1));
  assert.equal(a.strip.gate.target, 0, 'solo on another track gates this one');
  // Subtractive param 1 is cutoff.
  e.applyParams(Float64Array.of(0, INSTRUMENT_PARAM_BASE + 1, 500));
  assert.equal(a.kernel.cutoff.target, 500);
});

test('Panic silences every sound within 20 ms, including one-shot drum hits', () => {
  const beat = EXAMPLES.find((x) => x.slug === 'beat').doc;
  const e = new Engine(FS);
  e.setMetronome(true);
  e.setModel(e.prepareModel(compileModel(beat, FS).model));
  e.play(0);
  renderEngine(e, FS);
  e.panic();
  const [l, r] = renderEngine(e, FS / 2);
  const after = Math.round(0.02 * FS);
  assert.equal(peak(l, after), 0);
  assert.equal(peak(r, after), 0);
  assert.equal(e.playing, false);
  for (const t of e.model.tracks) assert.equal(t.kernel?.activeVoices() ?? 0, 0);
});

test('two 4 s renders of an example are bit-identical (SHA-256)', () => {
  const hash = (slug) => {
    const doc = EXAMPLES.find((x) => x.slug === slug).doc;
    const e = new Engine(FS);
    e.setModel(e.prepareModel(compileModel(doc, FS).model));
    e.play(0);
    const [l, r] = renderEngine(e, 4 * FS);
    return createHash('sha256').update(Buffer.from(l.buffer)).update(Buffer.from(r.buffer)).digest('hex');
  };
  for (const slug of ['beat', 'ambient', 'pluck']) assert.equal(hash(slug), hash(slug), slug);
});

test('every example renders non-silent, finite audio', () => {
  for (const example of EXAMPLES) {
    const e = new Engine(FS);
    e.setModel(e.prepareModel(compileModel(example.doc, FS).model));
    e.play(0);
    const [l, r] = renderEngine(e, 2 * FS);
    for (let i = 0; i < l.length; i += 7) assert.ok(Number.isFinite(l[i]) && Number.isFinite(r[i]));
    assert.ok(peak(l) > 0.01, `${example.slug} sounds`);
    const meters = e.readMeters();
    example.doc.trackOrder.forEach((_, i) => assert.ok(meters[i * METER_FIELDS] > 0, `${example.slug} track ${i + 1} sounds`));
  }
});

test('paramChanges: parameter-only edits become triples; structural edits need a model', () => {
  const doc = EXAMPLES[0].doc;
  const bassId = doc.trackOrder[1];
  const bassDevice = doc.tracks[bassId].deviceIds[0];
  assert.deepEqual(paramChanges(doc, setTrack(doc, bassId, { gainDb: -3, mute: true })), [1, PARAM_GAIN, -3, 1, PARAM_MUTE, 1]);
  assert.deepEqual(paramChanges(doc, setDeviceParam(doc, bassDevice, 'cutoff', 800)), [1, INSTRUMENT_PARAM_BASE + 1, 800]);
  assert.deepEqual(paramChanges(doc, setTrack(doc, doc.masterTrackId, { pan: 0.3 })), [MASTER_TARGET, PARAM_PAN, 0.3]);
  assert.equal(paramChanges(doc, setTempo(doc, 90)), null);
  assert.equal(paramChanges(null, doc), null);
  assert.deepEqual(paramChanges(doc, doc), []);
});
