/*
 * Pan laws (mixer-and-routing.md, Pan law; a3-audio-implementation.md, Mixer):
 *   mono source:   constant power, θ = (p + 1)·π/4, L = cos θ, R = sin θ
 *                  (centre −3.01 dB per side);
 *   stereo source: balance, L·= min(1, 1 − p), R·= min(1, 1 + p) (centre unity).
 * The master uses balance. p ∈ [−1, 1]. Gains are computed once per block.
 */

/** Writes the constant-power gains [L, R] for pan `p` into `out` at `at`. */
export function constantPower(p, out, at = 0) {
  const theta = ((p + 1) * Math.PI) / 4;
  out[at] = Math.cos(theta);
  out[at + 1] = Math.sin(theta);
}

/** Writes the balance gains [L, R] for pan `p` into `out` at `at`. */
export function balance(p, out, at = 0) {
  out[at] = p > 0 ? 1 - p : 1;
  out[at + 1] = p < 0 ? 1 + p : 1;
}
