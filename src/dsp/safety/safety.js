/*
 * SafetyKernel: the last stage before the output, live and offline
 * (a3-audio-implementation.md, Safety stage). Order per sample:
 * guard → DC blocker → duck → limiter → fade → final clamp. The fade follows
 * the limiter, so the onset bound (audio-safety.md: ≤ 0.02 in the first 10 ms)
 * holds for any input level.
 * A guard trip resets the DC blocker and the limiter at the faulty frame, so
 * samples in the limiter's look-ahead delay cannot reach the muted output.
 */
import { DcBlocker } from './dc-blocker.js';
import { SustainedLevelDuck } from './duck.js';
import { StartFade } from './fade.js';
import { NonFiniteGuard } from './guard.js';
import { Limiter, OUTPUT_CEILING } from './limiter.js';

export class SafetyKernel {
  /** @param {number} fs sample rate, Hz */
  constructor(fs) {
    this.guard = new NonFiniteGuard(fs);
    this.dc = new DcBlocker(fs);
    this.duck = new SustainedLevelDuck(fs);
    this.fade = new StartFade(fs);
    this.limiter = new Limiter(fs);
    this.latencyFrames = this.limiter.D;
  }

  /** Restarts the 50 ms fade-in (transport start, context resume, Panic). */
  resumeFade() {
    this.fade.restart();
  }

  /** Releases a sustained-level duck after the user acknowledges it. */
  ackDuck() {
    this.duck.acknowledge();
  }

  /** DC blocker, duck, limiter and fade over frames [start, end). */
  #stages(bufL, bufR, start, end) {
    if (end <= start) return;
    this.dc.process(bufL, bufR, start, end);
    this.duck.process(bufL, bufR, start, end);
    this.limiter.process(bufL, bufR, start, end);
    this.fade.process(bufL, bufR, start, end);
  }

  /** True once since the last call when the guard muted the output. */
  takeGuardTrip() {
    const tripped = this.guard.tripped;
    this.guard.tripped = false;
    return tripped;
  }

  /** True once since the last call when the duck turned on or off; read `duck.active`. */
  takeDuckChange() {
    const changed = this.duck.changed;
    this.duck.changed = false;
    return changed;
  }

  /** Processes frames [start, end) of both channels in place. */
  process(bufL, bufR, start, end) {
    const fault = this.guard.process(bufL, bufR, start, end);
    if (fault < 0) {
      this.#stages(bufL, bufR, start, end);
    } else {
      this.#stages(bufL, bufR, start, fault);
      this.dc.reset();
      this.limiter.reset();
      this.#stages(bufL, bufR, fault, end);
    }
    const c = OUTPUT_CEILING;
    for (let i = start; i < end; i++) {
      const l = bufL[i];
      const r = bufR[i];
      bufL[i] = l > c ? c : l < -c ? -c : l;
      bufR[i] = r > c ? c : r < -c ? -c : r;
    }
  }
}
