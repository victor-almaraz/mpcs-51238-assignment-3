/*
 * Value text for instrument and effect parameters, and typed text back to values.
 * Pure functions of a parameter definition ({ unit, min, max, step }) and a value.
 */

const minus = (s) => s.replace(/-/g, '−');

/** `value` with `digits` decimals and a sign: "+" only when the rounded text is not zero. */
function signed(value, digits) {
  const text = value.toFixed(digits);
  if (Number(text) === 0) return (0).toFixed(digits);
  return minus(value > 0 ? `+${text}` : text);
}

/** A frequency: "4.5 Hz" below 10 Hz, "440 Hz", "2.0 kHz". The format follows the rounded value. */
function hz(value) {
  if (Number(value.toFixed(1)) < 10) return `${value.toFixed(1)} Hz`;
  if (Math.round(value) < 1000) return `${Math.round(value)} Hz`;
  return `${(value / 1000).toFixed(1)} kHz`;
}

/** A time in milliseconds: "2.4 ms" below 10 ms, "250 ms", "1.20 s". The format follows the rounded value. */
function ms(value) {
  if (Number(value.toFixed(1)) < 10) return `${value.toFixed(1)} ms`;
  if (Math.round(value) < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

/** Value text with units: "440 Hz", "2.0 kHz", "10 ms", "1.20 s", "−6.0 dB", "2.5×", "50 %", "+2.0 st", "L20". */
export function formatParam(def, value) {
  switch (def.unit) {
    case 'Hz':
      return hz(value);
    case 's':
      return ms(value * 1000);
    case 'ms':
      return ms(value);
    case 'dB':
      return minus(`${value.toFixed(1)} dB`);
    case 'grains/s':
      return `${value.toFixed(1)} grains/s`;
    case 'fraction':
      return `${Math.round(value * 100)} %`;
    case 'st':
      return `${signed(value, 1)} st`;
    case 'pan': {
      const p = Math.round(value * 100);
      return p === 0 ? 'C' : p < 0 ? `L${-p}` : `R${p}`;
    }
    case '×':
      return `${value.toFixed(value < 1 ? 2 : 1)}×`;
    case 'Q':
      return `Q ${value.toFixed(2)}`;
    case ':1':
      return `${value.toFixed(1)}:1`;
    case 'cents':
    case 'oct': {
      // Signed for shifts (a range below zero); whole numbers for whole steps.
      const digits = def.step >= 1 ? 0 : 1;
      return `${def.min < 0 ? signed(value, digits) : value.toFixed(digits)} ${def.unit}`;
    }
    case 'offset':
      return signed(value, 2);
    case '× 48 st':
      return `${signed(value * 48, 1)} st`;
    default:
      return minus(String(Math.round(value * 100) / 100));
  }
}

/** Readout text where it is shorter than the value text, so it fits under a knob ("20.0/s"); else undefined. */
export function shortParam(def, value) {
  if (def.unit === 'grains/s') return `${value.toFixed(1)}/s`;
  return undefined;
}

/**
 * Typed units each parameter unit accepts, with the multiplier to the parameter's unit. The empty
 * unit is a bare number in the finest unit the value text uses: Hz, milliseconds, percent.
 */
const TYPED_UNITS = {
  Hz: { '': 1, hz: 1, k: 1000, khz: 1000 },
  s: { '': 0.001, ms: 0.001, s: 1 },
  ms: { '': 1, ms: 1, s: 1000 },
  dB: { '': 1, db: 1 },
  fraction: { '': 0.01, '%': 0.01 },
  st: { '': 1, st: 1 },
  cents: { '': 1, cents: 1 },
  oct: { '': 1, oct: 1 },
  '×': { '': 1, '×': 1, x: 1 },
  Q: { '': 1, q: 1 },
  ':1': { '': 1, ':1': 1 },
  'grains/s': { '': 1, 'grains/s': 1, '/s': 1 },
  '× 48 st': { '': 1 / 48, st: 1 / 48 },
};

const NUMBER = /^(?:q\s*)?([-+]?\d*\.?\d+)\s*(khz|hz|k|ms|s|%|db|st|cents|oct|×|x|:1|q|grains\/s|\/s)?$/i;

/**
 * Parses typed text into a value of `def`: a number with an optional unit ("2.5 kHz", "2k",
 * "40 ms", "1.5 s", "−6", "Q 0.7", "L20", "C"). A unit that does not belong to the parameter makes
 * the text invalid. A bare number takes the unit of `shown`, the current value text ("2.0 kHz":
 * 5 is 5 kHz); when that lands outside the range, the finest unit instead (500 is 500 Hz).
 * Returns null for invalid text.
 */
export function parseParam(def, text, shown = '') {
  const t = text.trim().replace(/−/g, '-');
  if (def.unit === 'pan') {
    if (/^c$/i.test(t)) return 0;
    // "L20", "R20", or a bare signed percentage: 20 is R20, −20 is L20.
    const side = /^([lr])\s*(\d+(?:\.\d+)?)$/i.exec(t);
    if (side) return (side[1].toLowerCase() === 'l' ? -1 : 1) * (Number(side[2]) / 100);
    const bare = /^([-+]?\d+(?:\.\d+)?)$/.exec(t);
    return bare ? Number(bare[1]) / 100 : null;
  }
  const m = NUMBER.exec(t);
  if (!m || (/^q/i.test(t) && def.unit !== 'Q')) return null;
  const units = TYPED_UNITS[def.unit];
  const number = Number(m[1]);
  // Units without a table (counts, notes) take bare numbers only.
  if (!units) return m[2] ? null : number;
  if (m[2]) {
    const scale = units[m[2].toLowerCase()];
    return scale === undefined ? null : number * scale;
  }
  const shownScale = units[NUMBER.exec(shown.replace(/−/g, '-'))?.[2]?.toLowerCase() ?? ''];
  const inRange = (v) => v >= def.min && v <= def.max;
  if (shownScale !== undefined && inRange(number * shownScale)) return number * shownScale;
  return number * units[''];
}
