/*
 * Non-finite guard (a3-audio-implementation.md, Stage order; audio-safety.md).
 * A NaN, ±Infinity or |x| > 1e4 sample in either channel mutes the output for
 * 250 ms, then fades it back in over 50 ms (project limits) along g = x³, the
 * curve of the start fade.
 */

/** Samples above this magnitude count as a fault (audio-safety.md). */
export const GUARD_MAX_MAGNITUDE = 1e4;

/** Mute and fade-in durations, in seconds (project limits). */
export const GUARD_MUTE_S = 0.25;
export const GUARD_FADE_S = 0.05;

export class NonFiniteGuard {
  /** @param {number} fs sample rate, Hz */
  constructor(fs) {
    this.muteFrames = Math.round(GUARD_MUTE_S * fs);
    this.fadeFrames = Math.round(GUARD_FADE_S * fs);
    this.reset();
  }

  /** Clears any mute or fade in progress. */
  reset() {
    this.muteLeft = 0;
    this.fadePos = this.fadeFrames; // fadeFrames = fade finished
    this.tripped = false; // set when a fault starts a mute; cleared by the caller
  }

  /**
   * Processes frames [start, end) of both channels in place. A fault zeroes the
   * faulty frame, starts the mute and sets `tripped`. Returns the index of the
   * first fault in the range, or −1.
   */
  process(bufL, bufR, start, end) {
    const max = GUARD_MAX_MAGNITUDE;
    const inv = 1 / this.fadeFrames;
    let firstFault = -1;
    for (let i = start; i < end; i++) {
      const l = bufL[i];
      const r = bufR[i];
      // NaN fails every comparison, so `!(… <= max)` catches NaN and ±Infinity.
      if (!(l <= max && l >= -max && r <= max && r >= -max)) {
        this.muteLeft = this.muteFrames;
        this.fadePos = 0;
        this.tripped = true;
        if (firstFault < 0) firstFault = i;
      }
      if (this.muteLeft > 0) {
        this.muteLeft--;
        bufL[i] = 0;
        bufR[i] = 0;
      } else if (this.fadePos < this.fadeFrames) {
        const x = this.fadePos * inv;
        const g = x * x * x;
        this.fadePos++;
        bufL[i] = l * g;
        bufR[i] = r * g;
      }
    }
    return firstFault;
  }

  /** True while the output is muted after a fault. */
  get muted() {
    return this.muteLeft > 0;
  }
}
