/*
 * Fractional-position interpolators (a3-audio-implementation.md, Sampler).
 * Each takes samples at integer offsets around the read position and a
 * fraction t ∈ [0, 1) past x0. None allocates. The sampler reads with
 * `hermite`; `linear` and `lagrange6` are references for tests.
 */

/**
 * 4-point cubic Hermite (Catmull-Rom) through x0 (t = 0) and x1 (t = 1), with
 * slopes from central differences. Exact for polynomials of degree ≤ 2.
 * @param {number} xm1 sample at offset −1
 * @param {number} x0 sample at offset 0
 * @param {number} x1 sample at offset 1
 * @param {number} x2 sample at offset 2
 * @param {number} t fraction in [0, 1)
 * @returns {number}
 */
export function hermite(xm1, x0, x1, x2, t) {
  const c0 = x0;
  const c1 = 0.5 * (x1 - xm1);
  const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
  const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
  return ((c3 * t + c2) * t + c1) * t + c0;
}

/**
 * Linear interpolation between x0 (t = 0) and x1 (t = 1).
 * @param {number} x0 sample at offset 0
 * @param {number} x1 sample at offset 1
 * @param {number} t fraction in [0, 1)
 * @returns {number}
 */
export function linear(x0, x1, t) {
  return x0 + (x1 - x0) * t;
}

/**
 * 6-point Lagrange interpolation through offsets −2 … 3. Exact for
 * polynomials of degree ≤ 5.
 * @param {number} xm2 sample at offset −2
 * @param {number} xm1 sample at offset −1
 * @param {number} x0 sample at offset 0
 * @param {number} x1 sample at offset 1
 * @param {number} x2 sample at offset 2
 * @param {number} x3 sample at offset 3
 * @param {number} t fraction in [0, 1)
 * @returns {number}
 */
export function lagrange6(xm2, xm1, x0, x1, x2, x3, t) {
  // Distances from each node: a = t + 2 … f = t − 3.
  const a = t + 2;
  const b = t + 1;
  const c = t;
  const d = t - 1;
  const e = t - 2;
  const f = t - 3;
  return (
    (-xm2 * b * c * d * e * f) / 120 +
    (xm1 * a * c * d * e * f) / 24 -
    (x0 * a * b * d * e * f) / 12 +
    (x1 * a * b * c * e * f) / 12 -
    (x2 * a * b * c * d * f) / 24 +
    (x3 * a * b * c * d * e) / 120
  );
}
