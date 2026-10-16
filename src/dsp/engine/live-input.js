/*
 * Live notes from the computer keyboard, Web MIDI and note previews
 * (a3-audio-implementation.md, Live input; midi.md). Events are MIDI channel
 * messages [status, data1, data2] applied at offset 0 of the next quantum.
 * Live voices use note IDs LIVE_NOTE_BASE + 128·channel + pitch, so transport
 * stops and loop wraps (which release sequenced notes only) leave them
 * sounding, and note previews (channel 16) never cut a note being played.
 * A token bucket limits note-ons to 200 per second (project limit); excess
 * note-ons are dropped and counted, note-offs always pass.
 */
import { NOTE_COUNT } from '../core/constants.js';

/** First live note ID; sequenced note IDs stay below it. */
export const LIVE_NOTE_BASE = 1 << 24;

/** MIDI channel (0-based) the engine client uses for note previews and auditions. */
export const PREVIEW_CHANNEL = 15;
const CHANNELS = 16;

/** Note-on flood limit, per second (project limit). */
export const FLOOD_LIMIT_PER_S = 200;

// MIDI status byte, not a frame count.
// eslint-disable-next-line no-restricted-syntax
export const NOTE_OFF = 0x80;
export const NOTE_ON = 0x90;
export const CONTROL_CHANGE = 0xb0;
export const CC_SUSTAIN = 64;
export const CC_ALL_SOUND_OFF = 120;
export const CC_ALL_NOTES_OFF = 123;

/**
 * Token bucket: `rate` tokens per second, holding at most `burst`. Time is
 * passed in by the caller (seconds), so the class reads no clock and runs on
 * both threads.
 */
export class FloodLimiter {
  constructor(rate = FLOOD_LIMIT_PER_S, burst = FLOOD_LIMIT_PER_S) {
    this.rate = rate;
    this.burst = burst;
    this.tokens = burst;
    this.time = 0;
    this.dropped = 0;
  }

  /** Advances the bucket to time `t` (seconds). */
  refill(t) {
    if (t > this.time) {
      this.tokens = Math.min(this.burst, this.tokens + (t - this.time) * this.rate);
      this.time = t;
    }
  }

  /** True when a note-on at time `t` may pass; otherwise counts it as dropped. */
  allow(t) {
    this.refill(t);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    this.dropped++;
    return false;
  }
}

/**
 * Applies one MIDI channel message to `kernel` (an instrument kernel or null).
 * Note-on with velocity 0 is a note-off; a repeated note-on of a held pitch
 * releases the held voice first. CC 120 fades every live voice; CC 123
 * releases them. Other messages are ignored. Returns false when the flood
 * limit dropped a note-on.
 */
export function applyLiveEvent(kernel, status, data1, data2, limiter, timeS) {
  if (kernel === null) return true;
  const kind = status & 0xf0;
  const pitch = data1 & 0x7f;
  const id = LIVE_NOTE_BASE + NOTE_COUNT * (status & 0x0f) + pitch;
  if (kind === NOTE_ON && data2 > 0) {
    if (!limiter.allow(timeS)) return false;
    kernel.noteOff(id);
    kernel.noteOn(id, pitch, data2 & 0x7f);
  } else if (kind === NOTE_OFF || kind === NOTE_ON) {
    kernel.noteOff(id);
  } else if (kind === CONTROL_CHANGE && (data1 === CC_ALL_SOUND_OFF || data1 === CC_ALL_NOTES_OFF)) {
    for (let i = 0; i < CHANNELS * NOTE_COUNT; i++) kernel.noteOff(LIVE_NOTE_BASE + i);
    if (data1 === CC_ALL_SOUND_OFF) kernel.allNotesOff(true);
  }
  return true;
}
