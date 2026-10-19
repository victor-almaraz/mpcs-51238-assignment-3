import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { CC_ALL_NOTES_OFF, CONTROL_CHANGE, NOTE_OFF, NOTE_ON, PREVIEW_CHANNEL } from '../../src/dsp/engine/live-input.js';
import { getEngine } from '../../src/lib/audio/engine-client.js';
import { EXAMPLES } from '../../src/lib/project/examples.js';
import { setTempo, setTrack, ticksPerBar } from '../../src/lib/project/model.js';

/*
 * Engine client behaviour against a stand-in AudioContext and worklet nodes:
 * messages to the engine are recorded, engine reports are delivered by hand
 * and animation frames run on demand.
 */
const FS = 48000;
const LATENCY_S = 0.05;
let frames = [];
let nodes = [];
let ctx = null;

class FakePort {
  constructor() {
    this.sent = [];
    this.onmessage = null;
  }
  postMessage(msg) {
    this.sent.push(msg);
  }
}

class FakeNode {
  constructor() {
    this.port = new FakePort();
    nodes.push(this);
  }
  connect(node) {
    return node;
  }
}

class FakeContext {
  constructor() {
    this.sampleRate = FS;
    this.currentTime = 0;
    this.baseLatency = 0;
    this.outputLatency = LATENCY_S;
    this.destination = {};
    this.audioWorklet = { addModule: () => Promise.resolve() };
    ctx = this;
  }
  resume() {
    return Promise.resolve();
  }
}

globalThis.AudioContext = FakeContext;
globalThis.AudioWorkletNode = FakeNode;
globalThis.requestAnimationFrame = (cb) => frames.push(cb);

const runFrames = () => {
  const due = frames;
  frames = [];
  for (const cb of due) cb();
};

/** A fresh client, started on the first example, with audio running. */
async function started() {
  delete globalThis.__wrackEngine;
  frames = [];
  nodes = [];
  const engine = getEngine();
  engine.setProject(EXAMPLES[0].doc);
  engine.requestSound(() => {});
  engine.confirmNotice(false);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(engine.getState().status, 'running');
  return { engine, port: nodes[0].port };
}

const report = (port, msg) => port.onmessage({ data: msg });
const sentOf = (port, t) => port.sent.filter((m) => m.t === t);

beforeEach(() => {
  ctx = null;
});

test('the playhead trails a report by the output latency without stalling', async () => {
  const { engine, port } = await started();
  engine.play();
  assert.equal(engine.positionTick(), 0, 'nothing from the start is audible yet');
  ctx.currentTime = 1;
  report(port, { t: 'pos', playFrame: FS, ctxFrame: FS, playing: true, meters: null });
  const a = engine.positionTick();
  ctx.currentTime = 1.02;
  const b = engine.positionTick();
  assert.ok(a > 0 && b > a, 'the readout keeps moving between reports');
});

test('a position before the loop start after a wrap falls at the end of the previous pass', async () => {
  const { engine, port } = await started();
  const doc = setTempo(EXAMPLES[0].doc, 120);
  const bar = ticksPerBar(doc.meter[0].numerator, doc.meter[0].denominator);
  const barS = (doc.meter[0].numerator * 4) / doc.meter[0].denominator / 2; // 120 bpm
  engine.setProject(doc);
  runFrames();
  engine.setLoop(true, 0, bar);
  engine.play();
  ctx.currentTime = barS + 0.01; // the engine wrapped 10 ms ago
  report(port, { t: 'pos', playFrame: Math.round(0.01 * FS), ctxFrame: Math.round(ctx.currentTime * FS), playing: true, meters: null });
  const tick = engine.positionTick(); // audible: 40 ms before the loop end
  assert.ok(tick > 0.95 * bar && tick < bar, `expected the end of the pass, got ${tick} of ${bar}`);
});

test('a stale report after a locate while playing is ignored', async () => {
  const { engine, port } = await started();
  engine.play();
  ctx.currentTime = 2;
  engine.locate(0);
  report(port, { t: 'pos', playFrame: 2 * FS, ctxFrame: 2 * FS, playing: true, meters: null });
  ctx.currentTime = 2 + LATENCY_S + 0.01;
  const tick = engine.positionTick();
  assert.ok(tick < 100, `playhead stays near the locate, got ${tick}`);
});

test('locating while paused makes Stop return to the new tick', async () => {
  const { engine } = await started();
  engine.play();
  engine.pause();
  engine.locate(960);
  assert.equal(engine.stop(), 960);
});

test('meters stay empty from a structural change until the engine acknowledges its model', async () => {
  const { engine, port } = await started();
  const meters = new Float32Array(4);
  report(port, { t: 'ack', rev: sentOf(port, 'model').at(-1).rev });
  report(port, { t: 'pos', playFrame: 0, ctxFrame: 0, playing: false, meters });
  assert.equal(engine.getMeters(), meters);
  engine.setProject(setTempo(EXAMPLES[0].doc, 100));
  assert.equal(engine.getMeters(), null);
  runFrames();
  const rev = sentOf(port, 'model').at(-1).rev;
  report(port, { t: 'pos', playFrame: 0, ctxFrame: 0, playing: false, meters });
  assert.equal(engine.getMeters(), null);
  report(port, { t: 'ack', rev });
  report(port, { t: 'pos', playFrame: 0, ctxFrame: 0, playing: false, meters });
  assert.equal(engine.getMeters(), meters);
});

test('a param change in the frame of a structural change follows the model', async () => {
  const { engine, port } = await started();
  const structural = setTempo(EXAMPLES[0].doc, 100);
  const trackId = structural.trackOrder.find((id) => structural.tracks[id].kind === 'instrument');
  engine.setProject(structural);
  engine.setProject(setTrack(structural, trackId, { gainDb: -6 }));
  const before = port.sent.length;
  runFrames();
  const kinds = port.sent.slice(before).map((m) => m.t);
  assert.ok(kinds.indexOf('model') >= 0 && kinds.indexOf('params') > kinds.indexOf('model'), kinds.join(','));
});

test('a new live target keeps notes held on a track that is still armed', async () => {
  const { engine, port } = await started();
  engine.setLiveTarget(0);
  engine.setArmedTargets([0]);
  const before = port.sent.length;
  engine.setLiveTarget(1);
  const cuts = port.sent.slice(before).filter((m) => m.t === 'live' && m.events[0] === CONTROL_CHANGE && m.events[1] === CC_ALL_NOTES_OFF);
  assert.equal(cuts.length, 0);
});

test('a preview ends on the track it started on, and none plays without a target', async () => {
  const { engine, port } = await started();
  const realTimeout = globalThis.setTimeout;
  const timers = [];
  globalThis.setTimeout = (cb) => timers.push(cb);
  try {
    engine.setLiveTarget(-1);
    engine.preview(60);
    assert.equal(sentOf(port, 'live').length, 0);
    engine.setLiveTarget(1);
    engine.preview(60);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    engine.setLiveTarget(2);
    timers.forEach((cb) => cb());
  } finally {
    globalThis.setTimeout = realTimeout;
  }
  const live = sentOf(port, 'live');
  const on = live.find((m) => m.events[0] === (NOTE_ON | PREVIEW_CHANNEL));
  const off = live.find((m) => m.events[0] === (NOTE_OFF | PREVIEW_CHANNEL));
  assert.equal(on.track, 1);
  assert.equal(off.track, 1);
});

test('panic calls the panic listeners', async () => {
  const { engine } = await started();
  let calls = 0;
  const unsubscribe = engine.subscribePanic(() => calls++);
  engine.panic();
  unsubscribe();
  engine.panic();
  assert.equal(calls, 1);
});
