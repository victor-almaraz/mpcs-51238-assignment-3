/*
 * Start and resume fade: gain rises 0 → 1 over 50 ms along g = x³, x = elapsed/50 ms.
 * The cubic keeps the first 10 ms below 0.8 % of full scale (audio-safety.md:
 * onset peak ≤ 0.02) and still completes within 60 ms. A new SafetyKernel
 * starts faded out, so the first sound after load fades in.
 */

export const FADE_S = 0.05;

export class StartFade {
  /** @param {number} fs sample rate, Hz */
  constructor(fs) {
    this.frames = Math.round(FADE_S * fs);
    this.pos = 0;
  }

  /** Restarts the fade from silence (transport start, context resume, Panic). */
  restart() {
    this.pos = 0;
  }

  /** True once the fade has reached full gain. */
  get done() {
    return this.pos >= this.frames;
  }

  /** Applies the fade to frames [start, end) in place. */
  process(bufL, bufR, start, end) {
    if (this.pos >= this.frames) return;
    const inv = 1 / this.frames;
    for (let i = start; i < end; i++) {
      if (this.pos >= this.frames) return;
      const x = this.pos * inv;
      const g = x * x * x;
      this.pos++;
      bufL[i] *= g;
      bufR[i] *= g;
    }
  }
}
