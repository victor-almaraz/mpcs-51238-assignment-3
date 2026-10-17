/*
 * Pan text for the pan knobs: the short readout, the spoken value and the
 * typed-value parser. Pure functions; no React.
 */

/** Short pan text: "L20", "C", "R20". */
export function panShort(p) {
  const v = Math.round(p * 100);
  return v === 0 ? 'C' : v < 0 ? `L${-v}` : `R${v}`;
}

/** Spoken pan text: "Left 20", "Centre", "Right 20". */
export function panSpoken(p) {
  const v = Math.round(p * 100);
  return v === 0 ? 'Centre' : v < 0 ? `Left ${-v}` : `Right ${v}`;
}

/**
 * Parses typed pan text on the readout's 0–100 scale: "L20", "R5", "C",
 * "Left 20", or a bare number, where 20 is R20, −20 is L20 and 0 is centre.
 * Returns −1 to +1 (clamped by the knob), or null for other text.
 */
export function parsePan(text) {
  const t = text.trim().replace(/−/g, '-');
  if (/^c(entre|enter)?$/i.test(t)) return 0;
  const m = /^(l|r|left|right)?\s*([-+]?\d+(?:\.\d+)?)$/i.exec(t);
  if (!m) return null;
  const sign = m[1]?.[0].toLowerCase() === 'l' ? -1 : 1;
  return (sign * Number(m[2])) / 100;
}
