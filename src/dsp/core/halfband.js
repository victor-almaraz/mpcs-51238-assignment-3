/*
 * Half-band decimation for sampler mip levels (a3-audio-implementation.md,
 * Sampler → Mip levels): a 63-tap Kaiser-windowed (β 7.857, project limit)
 * half-band lowpass, then 2:1 decimation, per level. The filter is zero-phase
 * (centred), so output frame k lines up with input frame 2k, and the input is
 * zero outside its length. Runs in the peaks worker, never in process():
 * these functions allocate.
 */

/** Taps of the half-band filter (project limit). */
export const HALFBAND_TAPS = 63;

/** Kaiser window β (project limit); about 80 dB stopband attenuation. */
export const KAISER_BETA = 7.857;

const CENTER = (HALFBAND_TAPS - 1) / 2;

/** Modified Bessel function of the first kind, order 0, by its power series. */
function besselI0(x) {
  const q = (x * x) / 4;
  let term = 1;
  let sum = 1;
  for (let k = 1; k < 64; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < 1e-17 * sum) break;
  }
  return sum;
}

/**
 * Kaiser-windowed ideal half-band lowpass h[n] = sin(π·m/2)/(π·m)·w[n], m = n − 31.
 * Even offsets other than 0 are exactly 0, the centre tap is 0.5, and the odd
 * taps are scaled to sum to 0.5, so the DC gain is 1 and H(f) + H(fs/2 − f) = 1.
 */
function buildHalfband() {
  const h = new Float64Array(HALFBAND_TAPS);
  const i0Beta = besselI0(KAISER_BETA);
  let oddSum = 0;
  for (let n = 0; n < HALFBAND_TAPS; n++) {
    const m = n - CENTER;
    if (m === 0 || m % 2 === 0) continue;
    const r = m / CENTER;
    const w = besselI0(KAISER_BETA * Math.sqrt(1 - r * r)) / i0Beta;
    h[n] = (Math.sin((Math.PI * m) / 2) / (Math.PI * m)) * w;
    oddSum += h[n];
  }
  for (let n = 0; n < HALFBAND_TAPS; n++) h[n] *= 0.5 / oddSum;
  h[CENTER] = 0.5;
  return h;
}

/** The 63 half-band coefficients, index 31 at the centre. */
export const HALFBAND = buildHalfband();

/** Odd-offset taps h[31 + m] for m = 1, 3, …, 31 (the filter is symmetric). */
const ODD_TAPS = Float64Array.from({ length: (CENTER + 1) / 2 }, (_, j) => HALFBAND[CENTER + 2 * j + 1]);

/**
 * Lowpass-filters `input` with HALFBAND and keeps every second frame:
 * output[k] = Σ h[n]·input[2k + n − 31] for k < output.length.
 * @param {Float32Array} input source frames
 * @param {Float32Array} output decimated frames; ceil(input.length/2) covers the input
 * @returns {Float32Array} `output`
 */
export function decimate2(input, output) {
  const n = input.length;
  for (let k = 0; k < output.length; k++) {
    const c = 2 * k;
    let acc = c < n ? 0.5 * input[c] : 0;
    if (c - CENTER >= 0 && c + CENTER < n) {
      for (let j = 0; j < ODD_TAPS.length; j++) {
        const m = 2 * j + 1;
        acc += ODD_TAPS[j] * (input[c - m] + input[c + m]);
      }
    } else {
      for (let j = 0; j < ODD_TAPS.length; j++) {
        const m = 2 * j + 1;
        const lo = c - m;
        const hi = c + m;
        acc += ODD_TAPS[j] * ((lo >= 0 && lo < n ? input[lo] : 0) + (hi < n ? input[hi] : 0));
      }
    }
    output[k] = acc;
  }
  return output;
}

/**
 * Builds mip levels 1 and 2 of one channel: each halves the rate of the one
 * before it. Lengths are ceil(n/2) and ceil(n/4) for n input frames.
 * @param {Float32Array} channel level-0 frames
 * @returns {Float32Array[]} [level1, level2]
 */
export function buildMips(channel) {
  const level1 = decimate2(channel, new Float32Array(Math.ceil(channel.length / 2)));
  const level2 = decimate2(level1, new Float32Array(Math.ceil(level1.length / 2)));
  return [level1, level2];
}
