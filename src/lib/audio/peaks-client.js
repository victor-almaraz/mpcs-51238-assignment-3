/*
 * Waveform peaks and sampler mips on the main thread
 * (a3-audio-implementation.md, Decoding, hashing and peaks): one module worker
 * computes min/max levels and half-band mip levels from transferred channel
 * copies. Peaks are cached in memory by sourceId, so drawing never recomputes
 * them.
 */
export const PEAKS_WORKER_URL = '/worklets/workers/peaks.js';

let worker = null;
let nextId = 0;
const cache = new Map(); // sourceId → { channels, levels }
const waiting = new Map(); // sourceId → channels the request was made for
const listeners = new Set();

const mipRequests = new Map(); // request id → { resolve }

function onMessage(event) {
  const msg = event.data;
  if (msg?.t === 'mips') {
    mipRequests.get(msg.id)?.resolve(msg.levels);
    mipRequests.delete(msg.id);
    return;
  }
  if (msg?.t !== 'peaks') return;
  const channels = waiting.get(msg.sourceId);
  waiting.delete(msg.sourceId);
  cache.set(msg.sourceId, { channels, levels: msg.levels });
  for (const listener of listeners) listener(msg.sourceId);
}

function getWorker() {
  if (!worker) {
    worker = new Worker(PEAKS_WORKER_URL, { type: 'module' });
    worker.onmessage = onMessage;
    worker.onerror = (err) => {
      console.error('Peaks worker failed', err);
      for (const { resolve } of mipRequests.values()) resolve(null);
      mipRequests.clear();
      waiting.clear();
    };
  }
  return worker;
}

/**
 * Cached peak levels for `source` (decode.js entry), requesting them once if
 * absent. Peaks belong to the channel arrays they were built from, so a source
 * decoded again at another rate gets new peaks.
 */
export function peaksFor(source) {
  const cached = cache.get(source.sourceId);
  if (cached?.channels === source.channels) return cached.levels;
  if (waiting.get(source.sourceId) !== source.channels) {
    waiting.set(source.sourceId, source.channels);
    const copies = source.channels.map((c) => c.slice());
    getWorker().postMessage({ t: 'peaks', id: ++nextId, sourceId: source.sourceId, channels: copies }, copies.map((c) => c.buffer));
  }
  return null;
}

/**
 * Sampler mip levels 1 and 2 for `channels` ([{ level, channels }]), built in
 * the worker from transferred copies; null when the worker fails.
 */
export function mipsFor(sourceId, channels) {
  const id = ++nextId;
  const copies = channels.map((c) => c.slice());
  return new Promise((resolve) => {
    mipRequests.set(id, { resolve });
    getWorker().postMessage({ t: 'mips', id, sourceId, channels: copies }, copies.map((c) => c.buffer));
  });
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
