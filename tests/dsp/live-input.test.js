import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Engine } from '../../src/dsp/engine/engine.js';
import { FLOOD_LIMIT_PER_S, FloodLimiter, LIVE_NOTE_BASE, applyLiveEvent } from '../../src/dsp/engine/live-input.js';
import { emptyModel } from '../../src/dsp/engine/model.js';
import { SubtractiveKernel } from '../../src/dsp/instruments/subtractive.js';
import { GlobalVoices } from '../../src/dsp/instruments/voice-pool.js';
import { ignoresKeyboard, noteName, pitchForCode } from '../../src/lib/audio/keyboard-input.js';
import { parseMidi } from '../../src/lib/audio/midi-input.js';
import { peak } from '../support/signal.js';

const FS = 48000;

test('flood limiter: 200 note-ons per second, then excess note-ons drop and count', () => {
  const lim = new FloodLimiter();
  let passed = 0;
  for (let i = 0; i < 1000; i++) if (lim.allow(0)) passed++;
  assert.equal(passed, FLOOD_LIMIT_PER_S, 'a burst passes up to the bucket size');
  assert.equal(lim.dropped, 800);
  assert.equal(lim.allow(0.004), false, 'less than one token after 4 ms');
  assert.equal(lim.allow(0.006), true, 'one token after 5 ms');
  let sustained = 0;
  for (let k = 0; k < 2000; k++) if (lim.allow(1 + k / 1000)) sustained++;
  assert.ok(Math.abs(sustained - 2 * FLOOD_LIMIT_PER_S - FLOOD_LIMIT_PER_S) <= 2, `steady rate: ${sustained} in 2 s after a refill`);
});

test('applyLiveEvent: note-on, note-off, velocity 0 and all notes off', () => {
  const k = new SubtractiveKernel(FS, new GlobalVoices());
  const lim = new FloodLimiter();
  applyLiveEvent(k, 0x90, 60, 100, lim, 0);
  assert.ok(k.pool.find(LIVE_NOTE_BASE + 60) >= 0);
  applyLiveEvent(k, 0x90, 60, 0, lim, 0);
  assert.equal(k.pool.find(LIVE_NOTE_BASE + 60), -1, 'velocity 0 is a note-off');
  applyLiveEvent(k, 0x91, 64, 90, lim, 0);
  applyLiveEvent(k, 0x90, 64, 90, lim, 0);
  const holding = [...k.pool.noteId].filter((id) => id === LIVE_NOTE_BASE + 64).length;
  assert.equal(holding, 1, 'a repeated note-on releases the held voice first, so one voice holds the pitch');
  applyLiveEvent(k, 0xb0, 123, 0, lim, 0);
  assert.equal(k.pool.find(LIVE_NOTE_BASE + 64), -1);
  assert.equal(applyLiveEvent(null, 0x90, 60, 100, lim, 0), true, 'a track without a kernel ignores events');
});

test('previews on channel 16 use their own note IDs and never cut a held note', () => {
  const k = new SubtractiveKernel(FS, new GlobalVoices());
  const lim = new FloodLimiter();
  applyLiveEvent(k, 0x90, 60, 100, lim, 0);
  applyLiveEvent(k, 0x9f, 60, 100, lim, 0);
  applyLiveEvent(k, 0x8f, 60, 0, lim, 0);
  assert.ok(k.pool.find(LIVE_NOTE_BASE + 60) >= 0, 'the played note still holds');
  assert.equal(k.pool.find(LIVE_NOTE_BASE + 15 * 128 + 60), -1, 'the preview ended');
});

test('the engine re-checks the flood limit', () => {
  const lim = new FloodLimiter();
  const k = new SubtractiveKernel(FS, new GlobalVoices());
  for (let i = 0; i < 300; i++) applyLiveEvent(k, 0x90, 40 + (i % 40), 100, lim, 0);
  assert.equal(lim.dropped, 100);
});

function engineWithTrack(type = 'subtractive', notes = []) {
  const e = new Engine(FS);
  e.setModel(
    e.prepareModel({
      ...emptyModel(FS),
      tracks: [
        {
          trackId: 'trk_a', gainDb: 0, pan: 0, mute: false, solo: false,
          deviceId: 'dev_a', type, params: {},
          notes: {
            start: Int32Array.from(notes, (n) => n[0]),
            end: Int32Array.from(notes, (n) => n[1]),
            pitch: Uint8Array.from(notes, (n) => n[2]),
            vel: Uint8Array.from(notes, () => 100),
          },
        },
      ],
    }),
  );
  return e;
}

function render(e, frames) {
  const l = new Float32Array(frames);
  const r = new Float32Array(frames);
  for (let off = 0; off < frames; off += 128) e.process(l.subarray(off, off + 128), r.subarray(off, off + 128), 0, 128);
  return l;
}

test('live notes sound while stopped and survive stop and loop wraps; sequenced notes are released', () => {
  const e = engineWithTrack('subtractive', [[0, 96000, 48]]);
  e.live(0, 0x90, 72, 100);
  assert.ok(peak(render(e, 4800)) > 0.01, 'a live note plays with the transport stopped');
  const k = e.model.tracks[0].kernel;
  e.setLoop(true, 0, 9600);
  e.play(0);
  render(e, 4800);
  assert.ok(k.pool.find(0) >= 0, 'the sequenced note started');
  render(e, 9600); // wraps once
  assert.ok(k.pool.find(LIVE_NOTE_BASE + 72) >= 0, 'the live note held through the wrap');
  e.stop();
  assert.equal(k.pool.find(0), -1, 'stop released the sequenced note');
  assert.ok(k.pool.find(LIVE_NOTE_BASE + 72) >= 0, 'the live note still holds');
  e.live(0, 0x80, 72, 0);
  assert.equal(k.pool.find(LIVE_NOTE_BASE + 72), -1);
  e.panic();
  render(e, 1280);
  assert.equal(k.activeVoices(), 0);
});

test('drum hits ring on through a stop', () => {
  const e = engineWithTrack('drums');
  e.live(0, 0x90, 49, 127);
  e.stop();
  const k = e.model.tracks[0].kernel;
  render(e, 1280);
  assert.ok(k.activeVoices() > 0);
});

test('computer keyboard: A–K map to C–C of the base octave; Z/X range is C0–C8', () => {
  assert.equal(pitchForCode('KeyA', 4), 60);
  assert.equal(pitchForCode('KeyW', 4), 61);
  assert.equal(pitchForCode('KeyK', 4), 72);
  assert.equal(pitchForCode('KeyA', 0), 12);
  assert.equal(pitchForCode('KeyK', 7), 108);
  assert.equal(pitchForCode('KeyQ', 4), null);
  assert.equal(noteName(60), 'C4');
  assert.equal(noteName(61), 'C#4');
  assert.equal(noteName(12), 'C0');
});

test('keyboard input is ignored with modifiers and in text entry', () => {
  const target = (selector) => ({ closest: (s) => (s.includes(selector) ? {} : null) });
  assert.equal(ignoresKeyboard({ ctrlKey: true, target: target('none') }), true);
  assert.equal(ignoresKeyboard({ target: { closest: () => ({}) } }), true);
  assert.equal(ignoresKeyboard({ target: { closest: () => null } }), false);
});

test('MIDI parsing: notes, velocity-0 note-off, sustain, all-off messages; system messages ignored', () => {
  assert.deepEqual(parseMidi(Uint8Array.of(0x92, 60, 100)), { type: 'on', pitch: 60, velocity: 100 });
  assert.deepEqual(parseMidi(Uint8Array.of(0x90, 60, 0)), { type: 'off', pitch: 60 });
  assert.deepEqual(parseMidi(Uint8Array.of(0x85, 61, 40)), { type: 'off', pitch: 61 });
  assert.deepEqual(parseMidi(Uint8Array.of(0xb0, 64, 127)), { type: 'sustain', down: true });
  assert.deepEqual(parseMidi(Uint8Array.of(0xb0, 64, 10)), { type: 'sustain', down: false });
  assert.deepEqual(parseMidi(Uint8Array.of(0xb0, 120, 0)), { type: 'allSoundOff' });
  assert.deepEqual(parseMidi(Uint8Array.of(0xb0, 123, 0)), { type: 'allNotesOff' });
  assert.equal(parseMidi(Uint8Array.of(0xf8)), null, 'clock');
  assert.equal(parseMidi(Uint8Array.of(0xe0, 0, 64)), null, 'pitch bend is ignored');
});
