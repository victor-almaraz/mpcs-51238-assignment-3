/*
 * Audio sources on the main thread (a3-audio-implementation.md, Decoding,
 * hashing and peaks; assignment-3-scope.md, Audio clips and Audio persistence).
 *
 * Per file, one at a time: read the bytes, hash them (SHA-256 hex is the
 * sourceId), decode a copy with decodeAudioData on an OfflineAudioContext (no
 * AudioContext exists before a sound-producing action), check the 20-minute
 * project limit, keep the source in memory and store the original bytes in
 * IndexedDB, or keep it for the session only when that fails. Sources decode at
 * one rate; when the live context runs at another, they decode again from
 * their bytes.
 */
import {
  get as getStored,
  hasRoomFor,
  put as putStored,
  requestPersistence,
} from '../storage/audio-store.js';

export const MAX_PROJECT_AUDIO_S = 20 * 60;
export const DEFAULT_DECODE_RATE = 48000;

export const decodeFailed = (name) => `Could not decode ${name}. Supported formats: WAV, MP3, M4A/AAC, FLAC, OGG.`;
export const limitReached = (name) => `${name} was not added. A project can hold up to 20 minutes of audio.`;
export const sessionOnly = (name) => `This browser could not store ${name}. Save a .wrack file to keep this audio.`;

/** sourceId → { sourceId, name, mimeType, size, bytes, rate, frames, channels, stored: 'device' | 'session' } */
const sources = new Map();
const listeners = new Set();
let version = 0;

function changed() {
  version++;
  for (const listener of listeners) listener();
}

/** Subscribes to source changes. Returns an unsubscribe function. */
export function subscribeSources(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes every time a source loads or unloads (useSyncExternalStore snapshot). */
export const getSourcesVersion = () => version;

/** The loaded source with `sourceId`, or undefined. */
export const getSource = (sourceId) => sources.get(sourceId);

/** Every loaded source. */
export const allSources = () => [...sources.values()];

/** Lowercase hex SHA-256 of `bytes` (ArrayBuffer). */
export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Decodes `bytes` at `rate` and returns the channel data. decodeAudioData
 * detaches the buffer it receives, so it gets a copy.
 */
export async function decodeBytes(bytes, rate) {
  const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: rate });
  const buffer = await ctx.decodeAudioData(bytes.slice(0));
  const channels = [];
  for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) channels.push(buffer.getChannelData(c));
  return { channels, frames: buffer.length, rate: buffer.sampleRate };
}

/**
 * Writes `entry`'s bytes to the audio store when the capacity check allows,
 * and registers it as 'device' or, when that fails, 'session'.
 */
async function store(entry) {
  let stored = 'session';
  if (await hasRoomFor(entry.size)) {
    const written = await putStored({
      sourceId: entry.sourceId,
      name: entry.name,
      mimeType: entry.mimeType,
      size: entry.size,
      sha256: entry.sourceId,
      bytes: entry.bytes,
    });
    if (written.ok) stored = 'device';
    else console.error('Audio store write failed', written.error);
  }
  return register({ ...entry, stored });
}

/** Marks a loaded source as no longer stored (its record was removed). */
export function markUnstored(sourceId) {
  const entry = sources.get(sourceId);
  if (entry && entry.stored !== 'session') register({ ...entry, stored: 'session' });
}

function register(entry) {
  sources.set(entry.sourceId, entry);
  changed();
  return entry;
}

/** Seconds of decoded audio among `sourceIds` (unique, loaded or described by `refs`). */
export function decodedSeconds(refs) {
  let s = 0;
  for (const ref of Object.values(refs ?? {})) s += ref.frames / ref.sampleRate;
  return s;
}

/**
 * Imports files in order. `projectSources` are the project's SourceRefs (for
 * the 20-minute limit). Calls `onResult(result)` per file as it finishes:
 * { ok: true, source, reused } or { ok: false, name, message }; a stored-as-
 * session result carries `message` too. Resolves when every file is done.
 */
export async function importFiles(files, { rate = DEFAULT_DECODE_RATE, projectSources = {}, onResult }) {
  let seconds = decodedSeconds(projectSources);
  const known = new Set(Object.keys(projectSources));
  for (const file of files) {
    const name = file.name;
    let bytes;
    try {
      bytes = await file.arrayBuffer();
    } catch (err) {
      console.error(err);
      onResult({ ok: false, name, message: decodeFailed(name) });
      continue;
    }
    const sourceId = await sha256Hex(bytes);
    const loaded = sources.get(sourceId);
    if (loaded) {
      // Sources stay in memory across projects, so the limit applies here too.
      const length = loaded.frames / loaded.rate;
      if (!known.has(sourceId) && seconds + length > MAX_PROJECT_AUDIO_S) {
        onResult({ ok: false, name, message: limitReached(name) });
        continue;
      }
      if (!known.has(sourceId)) seconds += length;
      known.add(sourceId);
      const stored = loaded.stored === 'device' ? loaded : await store(loaded);
      // The same audio under another file name: the clip takes the name it was imported as.
      const source = stored.name === name ? stored : { ...stored, name };
      onResult(source.stored === 'device' ? { ok: true, source, reused: true } : { ok: true, source, reused: true, message: sessionOnly(name) });
      continue;
    }
    let decoded;
    try {
      decoded = await decodeBytes(bytes, rate);
    } catch (err) {
      console.error(err);
      onResult({ ok: false, name, message: decodeFailed(name) });
      continue;
    }
    const length = decoded.frames / decoded.rate;
    if (!known.has(sourceId) && seconds + length > MAX_PROJECT_AUDIO_S) {
      onResult({ ok: false, name, message: limitReached(name) });
      continue;
    }
    seconds += known.has(sourceId) ? 0 : length;
    known.add(sourceId);
    const blob = new Blob([bytes], { type: file.type || 'application/octet-stream' });
    requestPersistence().catch((err) => console.error('persist() failed', err));
    const source = await store({
      sourceId,
      name,
      mimeType: blob.type,
      size: blob.size,
      bytes: blob,
      rate: decoded.rate,
      frames: decoded.frames,
      channels: decoded.channels,
      stored: 'session',
    });
    onResult(source.stored === 'device' ? { ok: true, source } : { ok: true, source, message: sessionOnly(name) });
  }
}

/**
 * Loads the project's sources that are not in memory from IndexedDB and
 * decodes them at `rate`. Sources absent from both stay unloaded ("Audio not
 * loaded"). Resolves to the list of missing sourceIds.
 */
export async function loadStoredSources(sourceRefs, rate = DEFAULT_DECODE_RATE) {
  const missing = [];
  for (const ref of Object.values(sourceRefs ?? {})) {
    if (sources.has(ref.id)) continue;
    const record = await getStored(ref.id);
    if (!record.ok || !record.value) {
      missing.push(ref.id);
      continue;
    }
    try {
      const bytes = await record.value.bytes.arrayBuffer();
      const decoded = await decodeBytes(bytes, rate);
      register({
        sourceId: ref.id,
        name: record.value.name,
        mimeType: record.value.mimeType,
        size: record.value.size,
        bytes: record.value.bytes,
        rate: decoded.rate,
        frames: decoded.frames,
        channels: decoded.channels,
        stored: 'device',
      });
    } catch (err) {
      console.error(`Stored audio for ${ref.name} could not be decoded`, err);
      missing.push(ref.id);
    }
  }
  return missing;
}

/** Decodes every loaded source again at `rate` (the live context's rate). */
export async function redecodeAll(rate) {
  for (const source of [...sources.values()]) {
    if (source.rate === rate) continue;
    try {
      const decoded = await decodeBytes(await source.bytes.arrayBuffer(), rate);
      sources.set(source.sourceId, { ...source, rate: decoded.rate, frames: decoded.frames, channels: decoded.channels });
    } catch (err) {
      console.error(`${source.name} could not be decoded at ${rate} Hz`, err);
      sources.delete(source.sourceId);
    }
  }
  changed();
}

/**
 * Loads sources carried by a .wrack file: `audio` maps sourceId → Blob of the
 * original bytes (already checked against their SHA-256), `refs` are the
 * archive project's SourceRefs. Each source not yet in memory is decoded at
 * `rate`, stored on the device when possible and registered. Resolves to
 * { loaded: [sourceId], failed: [message] }.
 */
export async function loadArchiveSources(audio, refs, rate = DEFAULT_DECODE_RATE) {
  const loaded = [];
  const failed = [];
  for (const [sourceId, blob] of audio) {
    const ref = refs?.[sourceId];
    const name = ref?.name ?? sourceId;
    if (sources.has(sourceId)) {
      loaded.push(sourceId);
      continue;
    }
    try {
      const decoded = await decodeBytes(await blob.arrayBuffer(), rate);
      await store({
        sourceId,
        name,
        mimeType: ref?.format || blob.type || 'application/octet-stream',
        size: blob.size,
        bytes: blob,
        rate: decoded.rate,
        frames: decoded.frames,
        channels: decoded.channels,
        stored: 'session',
      });
      loaded.push(sourceId);
    } catch (err) {
      console.error(err);
      failed.push(decodeFailed(name));
    }
  }
  return { loaded, failed };
}

/** Registers an already decoded source (archives, tests). */
export function addDecodedSource(entry) {
  return register(entry);
}
