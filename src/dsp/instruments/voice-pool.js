/*
 * Voice allocation with stealing (a3-audio-implementation.md, Shared rules;
 * audio-safety.md). At most `cap` voices hold notes; a stolen voice keeps a
 * slot while it fades out over 64 frames, so the pool has 2·cap slots.
 * Stealing takes the released voice with the lowest envelope level, otherwise
 * the oldest held voice. A shared GlobalVoices budget caps voices across all
 * instruments.
 */
import { GLOBAL_VOICES, VOICES_PER_INSTRUMENT } from '../core/constants.js';
import { IDLE, RELEASE, STEAL } from './envelope.js';

/** Counts held voices across every instrument of an engine. */
export class GlobalVoices {
  constructor(max = GLOBAL_VOICES) {
    this.max = max;
    this.count = 0;
  }
}

export class VoicePool {
  /**
   * @param {import('./envelope.js').EnvelopeBank} env envelopes, one per slot (2·cap slots)
   * @param {GlobalVoices} global shared budget
   * @param {number} [cap] held-voice cap for this instrument
   */
  constructor(env, global, cap = VOICES_PER_INSTRUMENT) {
    this.env = env;
    this.global = global;
    this.cap = cap;
    this.slots = 2 * cap;
    this.noteId = new Int32Array(this.slots).fill(-1); // -1: not holding a note
    this.order = new Float64Array(this.slots); // allocation order, for "oldest"
    this.counted = new Uint8Array(this.slots); // 1 while the slot counts toward the caps
    this.clock = 0;
    this.held = 0;
  }

  /** Number of slots needed by EnvelopeBank and per-voice state. */
  static slotsFor(cap = VOICES_PER_INSTRUMENT) {
    return 2 * cap;
  }

  /** Releases the cap counts of slots whose envelopes have ended. Call once per block. */
  reap() {
    for (let v = 0; v < this.slots; v++) {
      if (this.counted[v] && this.env.stage[v] === IDLE) this.#uncount(v);
    }
  }

  #uncount(v) {
    if (!this.counted[v]) return;
    this.counted[v] = 0;
    this.held--;
    this.global.count--;
  }

  /** Index of the slot holding `noteId`, or −1. */
  find(noteId) {
    for (let v = 0; v < this.slots; v++) if (this.noteId[v] === noteId && this.env.stage[v] !== IDLE) return v;
    return -1;
  }

  /** Chooses a voice to steal: the quietest released voice, else the oldest held voice; −1 if none. */
  #victim() {
    let best = -1;
    let bestLevel = Infinity;
    for (let v = 0; v < this.slots; v++) {
      if (this.counted[v] && this.env.stage[v] === RELEASE && this.env.level[v] < bestLevel) {
        best = v;
        bestLevel = this.env.level[v];
      }
    }
    if (best >= 0) return best;
    let oldest = Infinity;
    for (let v = 0; v < this.slots; v++) {
      if (this.counted[v] && this.env.stage[v] !== STEAL && this.order[v] < oldest) {
        best = v;
        oldest = this.order[v];
      }
    }
    return best;
  }

  /**
   * Allocates a slot for `noteId`, stealing when a cap is reached. Returns the
   * slot index, or −1 when the global budget is full and this instrument holds
   * no voice to steal (the note is dropped).
   */
  allocate(noteId) {
    if (this.held >= this.cap || this.global.count >= this.global.max) {
      const victim = this.#victim();
      if (victim < 0) return -1;
      this.env.steal(victim);
      this.noteId[victim] = -1;
      this.#uncount(victim);
    }
    let slot = -1;
    for (let v = 0; v < this.slots; v++) {
      if (this.env.stage[v] === IDLE) {
        slot = v;
        break;
      }
    }
    if (slot < 0) return -1;
    this.noteId[slot] = noteId;
    this.order[slot] = this.clock++;
    this.counted[slot] = 1;
    this.held++;
    this.global.count++;
    return slot;
  }

  /** Forgets the note held by slot `v` (after note-off, so a repeated noteId finds no stale voice). */
  detach(v) {
    this.noteId[v] = -1;
  }

  /** Sounding voices (including releases and fades), for polyphony auto-gain. */
  sounding() {
    let n = 0;
    for (let v = 0; v < this.slots; v++) if (this.env.stage[v] !== IDLE) n++;
    return n;
  }

  /** Frees every slot's cap count immediately (engine reset). */
  clear() {
    for (let v = 0; v < this.slots; v++) {
      this.#uncount(v);
      this.noteId[v] = -1;
    }
  }
}
