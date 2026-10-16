/*
 * Waveform peaks on the main thread (a3-audio-implementation.md, Decoding,
 * hashing and peaks): one module worker computes min/max levels per source
 * from transferred channel copies; results are cached in memory by sourceId,
 * so drawing never recomputes them.
 */
export const PEAKS_WORKER_URL = '/worklets/workers/peaks.js';

let worker = null;
let nextId = 0;
const cache = new Map(); // sourceId → levels
const waiting = new Map(); // sourceId → channels the request was made for
const listeners = new Set();

function onMessage(event) {
  const msg = event.data;
  if (msg?.t !== 'peaks') return;
  waiting.delete(msg.sourceId);
  cache.set(msg.sourceId, msg.levels);
  for (const listener of listeners) listener(msg.sourceId);
}

function getWorker() {
  if (!worker) {
    worker = new Worker(PEAKS_WORKER_URL, { type: 'module' });
    worker.onmessage = onMessage;
    worker.onerror = (err) => console.error('Peaks worker failed', err);
  }
  return worker;
}

/** Cached peak levels for `source` (decode.js entry), requesting them once if absent. */
export function peaksFor(source) {
  const cached = cache.get(source.sourceId);
  if (cached) return cached;
  if (!waiting.has(source.sourceId)) {
    waiting.set(source.sourceId, source.channels);
    const copies = source.channels.map((c) => c.slice());
    getWorker().postMessage({ t: 'peaks', id: ++nextId, sourceId: source.sourceId, channels: copies }, copies.map((c) => c.buffer));
  }
  return null;
}

/** Calls `listener(sourceId)` when a source's peaks arrive. Returns an unsubscribe function. */
export function subscribePeaks(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The coarsest level with at least one bucket per pixel at `framesPerPixel`
 * (ui-timeline-and-editors.md, Budgets); the finest level when zoomed in further.
 */
export function levelFor(levels, framesPerPixel) {
  let chosen = levels[0];
  for (const level of levels) if (level.bucket <= framesPerPixel) chosen = level;
  return chosen;
}
