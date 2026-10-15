/*
 * PolyBLEP band-limited oscillator shapes (a3-audio-implementation.md,
 * Subtractive). Phase t ∈ [0, 1), increment dt = f/fs.
 */

/** Two-sample polynomial correction for a unit step at phase 0. */
export function blep(t, dt) {
  if (t < dt) {
    const x = t / dt;
    return 2 * x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + 2 * x + 1;
  }
  return 0;
}

/** Band-limited saw: 2t − 1 − blep(t, dt). */
export function saw(t, dt) {
  return 2 * t - 1 - blep(t, dt);
}

/** Band-limited 50 % square: sign(0.5 − t) + blep(t, dt) − blep((t + 0.5) mod 1, dt). */
export function square(t, dt) {
  const half = t + 0.5 < 1 ? t + 0.5 : t - 0.5;
  return (t < 0.5 ? 1 : -1) + blep(t, dt) - blep(half, dt);
}
