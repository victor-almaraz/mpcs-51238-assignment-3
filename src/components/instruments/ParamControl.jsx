'use client';

import Knob from '@/components/ui/Knob';
import RadioGroup from '@/components/ui/RadioGroup';
import { clampParam, fromNorm, toNorm } from '@/dsp/core/params';

/** Slider resolution for log and pow3 parameters, in positions. */
const NORM_STEPS = 1000;

const LABELS = {
  waveform: 'Waveform',
  cutoff: 'Cutoff',
  resonance: 'Resonance',
  envAmount: 'Filter env',
  attack: 'Attack',
  decay: 'Decay',
  sustain: 'Sustain',
  release: 'Release',
  ratio: 'Ratio',
  fine: 'Fine',
  index: 'Index',
  indexDecay: 'Index decay',
  vibratoRate: 'Vibrato rate',
  vibratoDepth: 'Vibrato',
  damping: 'Damping',
  brightness: 'Brightness',
  pickPosition: 'Pick position',
  source: 'Source',
  position: 'Position',
  grainSize: 'Grain size',
  density: 'Density',
  spray: 'Spray',
  pitchSpread: 'Pitch spread',
  octave: 'Octave',
  cents: 'Cents',
  ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`h${i + 1}`, `Harmonic ${i + 1}`])),
};

const OPTION_LABELS = {
  sine: 'Sine',
  square: 'Square',
  saw: 'Saw',
  triangle: 'Triangle',
  noise: 'Noise',
  chord: 'Chord',
  sample: 'File',
  off: 'Off',
  on: 'On',
  softclip: 'Soft clip',
  hardclip: 'Hard clip',
  foldback: 'Foldback',
  lowpass: 'Lowpass',
  highpass: 'Highpass',
  bandpass: 'Bandpass',
  forward: 'Forward',
  pingpong: 'Ping-pong',
  gate: 'Gate',
  trigger: 'Trigger',
  poly: 'Poly',
  mono: 'Mono',
};

/** The default label of `def`: its own label, else the label for its id ("Cutoff"). */
export function paramLabel(def) {
  return def.label ?? LABELS[def.id] ?? def.id;
}

/** Value text with units: "440 Hz", "2.0 kHz", "10 ms", "1.20 s", "−6.0 dB", "2.5×", "50 %", "+2.0 st", "L20". */
export function formatParam(def, value) {
  const minus = (s) => s.replace('-', '−');
  switch (def.unit) {
    case 'Hz':
      return value >= 1000 ? `${(value / 1000).toFixed(1)} kHz` : `${Math.round(value)} Hz`;
    case 's':
      return value < 1 ? `${Math.round(value * 1000)} ms` : `${value.toFixed(2)} s`;
    case 'dB':
      return minus(`${value.toFixed(1)} dB`);
    case 'grains/s':
      return `${value.toFixed(1)} grains/s`;
    case 'fraction':
      return `${Math.round(value * 100)} %`;
    case 'st':
      return minus(`${value > 0 ? '+' : ''}${value.toFixed(1)} st`);
    case 'pan': {
      const p = Math.round(value * 100);
      return p === 0 ? 'C' : p < 0 ? `L${-p}` : `R${p}`;
    }
    case '×':
      return `${value.toFixed(1)}×`;
    case 'ms':
      return value < 1000 ? `${value < 10 ? value.toFixed(1) : Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
    case 'Q':
      return `Q ${value.toFixed(2)}`;
    case ':1':
      return `${value.toFixed(1)}:1`;
    case 'cents':
    case 'oct':
      // Signed for shifts (a range below zero); whole numbers for whole steps.
      return minus(`${value > 0 && def.min < 0 ? '+' : ''}${value.toFixed(def.step >= 1 ? 0 : 1)} ${def.unit}`);
    case 'offset':
      return minus(`${value > 0 ? '+' : ''}${value.toFixed(2)}`);
    case '× 48 st':
      return minus(`${value > 0 ? '+' : ''}${Math.round(value * 48)} st`);
    default:
      return minus(String(Math.round(value * 100) / 100));
  }
}

/** Readout text where it is shorter than the value text, so it fits under a knob ("20.0/s"); else undefined. */
export function shortParam(def, value) {
  if (def.unit === 'grains/s') return `${value.toFixed(1)}/s`;
  return undefined;
}

/** Multipliers from a typed unit to the def's unit ("2 kHz" → 2000 Hz, "20 ms" → 0.02 s). */
function unitScale(def, unit) {
  const u = unit.toLowerCase();
  if (u === 'khz') return 1000;
  if (u === 'ms') return def.unit === 's' ? 0.001 : 1;
  if (u === 's') return def.unit === 'ms' ? 1000 : 1;
  if (u === '%') return def.unit === 'fraction' ? 0.01 : 1;
  if (u === 'st' && def.unit === '× 48 st') return 1 / 48;
  return 1;
}

/**
 * Parses typed text into a value of `def`: a number with an optional unit
 * ("2.5 kHz", "40 ms", "−6", "L20", "C"). A number without a unit takes the
 * unit of `shown`, the current value text. Returns null for other text.
 */
export function parseParam(def, text, shown = '') {
  const t = text.trim().replace(/−/g, '-');
  if (def.unit === 'pan') {
    const m = /^([lr])?\s*([-+]?\d+(?:\.\d+)?)$/i.exec(t);
    if (/^c$/i.test(t)) return 0;
    if (!m) return null;
    // A bare number is a percentage: 20 is R20, −20 is L20.
    return (m[1]?.toLowerCase() === 'l' ? -1 : 1) * (Number(m[2]) / 100);
  }
  const m = /^([-+]?\d*\.?\d+)\s*(khz|hz|ms|s|%|db|st|cents|oct|×|x|:1|q|grains\/s|\/s)?$/i.exec(t);
  if (!m) return null;
  const typed = m[2] ?? /(khz|hz|ms|s|%|db|st|cents|oct)\s*$/i.exec(shown)?.[1] ?? '';
  return Number(m[1]) * unitScale(def, typed);
}

/**
 * One parameter as a labelled control (DEV-02): segmented radio buttons for
 * an enum, otherwise a knob (log and pow3 params move over 1000 positions)
 * with unit value text and a typed-value field; a typed value is set exactly,
 * clamped, rather than at the nearest position. `label` overrides the def's
 * own label and the default label for `def.id` as the accessible name; the
 * knob's caption stays the short label.
 */
export default function ParamControl({ def, value, onChange, idPrefix, label: labelOverride, caption: captionOverride }) {
  const label = labelOverride ?? paramLabel(def);
  if (def.scale === 'enum') {
    return (
      <div className="basis-full">
        {/* Content-sized, with roomy segments, so every segmented control looks alike. */}
        <RadioGroup
          className="max-w-full sm:w-fit [&_label]:px-3"
          legend={label}
          options={def.options.map((name, i) => ({ value: i, label: OPTION_LABELS[name] ?? name }))}
          value={value}
          onChange={(i) => onChange(def.id, i)}
        />
      </div>
    );
  }
  const stepped = def.scale === 'lin';
  const valueText = formatParam(def, value);
  return (
    <Knob
      id={`${idPrefix}-${def.id}`}
      label={label}
      caption={captionOverride ?? def.label ?? LABELS[def.id] ?? labelOverride ?? def.id}
      min={stepped ? def.min : 0}
      max={stepped ? def.max : NORM_STEPS}
      step={stepped ? (def.step ?? (def.max - def.min) / NORM_STEPS) : 1}
      value={stepped ? value : Math.round(toNorm(def, value) * NORM_STEPS)}
      valueText={valueText}
      display={shortParam(def, value)}
      onTyped={(text) => {
        const v = parseParam(def, text, valueText);
        if (v !== null && Number.isFinite(v)) onChange(def.id, clampParam(def, v));
      }}
      onChange={(position) => onChange(def.id, stepped ? clampParam(def, position) : fromNorm(def, position / NORM_STEPS))}
      onReset={() => onChange(def.id, def.default)}
    />
  );
}
