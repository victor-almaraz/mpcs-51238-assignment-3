'use client';

import RadioGroup from '@/components/ui/RadioGroup';
import Slider from '@/components/ui/Slider';
import { clampParam, fromNorm, toNorm } from '@/dsp/core/params';

/** Slider resolution for log and pow3 parameters, in positions. */
const NORM_STEPS = 1000;

const LABELS = {
  waveform: 'Waveform',
  cutoff: 'Cutoff',
  resonance: 'Resonance',
  attack: 'Attack',
  release: 'Release',
  ratio: 'Ratio',
  index: 'Index',
  indexDecay: 'Index decay',
  damping: 'Damping',
  brightness: 'Brightness',
  decay: 'Decay (T60)',
  source: 'Source',
  grainSize: 'Grain size',
  density: 'Density',
  spray: 'Spray',
  ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`h${i + 1}`, `Harmonic ${i + 1}`])),
};

const OPTION_LABELS = {
  sine: 'Sine',
  square: 'Square',
  saw: 'Saw',
  triangle: 'Triangle',
  noise: 'Noise',
  chord: 'Chord',
  off: 'Off',
  on: 'On',
  forward: 'Forward',
  pingpong: 'Ping-pong',
  gate: 'Gate',
  trigger: 'Trigger',
  poly: 'Poly',
  mono: 'Mono',
};

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
    case 'cents':
      return minus(`${value > 0 ? '+' : ''}${value.toFixed(1)} cents`);
    case '× 48 st':
      return minus(`${value > 0 ? '+' : ''}${Math.round(value * 48)} st`);
    default:
      return minus(String(Math.round(value * 100) / 100));
  }
}

/**
 * One parameter as a labelled control: a radio group for an enum, otherwise a
 * native slider (log and pow3 params move over 1000 positions) with unit value
 * text. `label` overrides the default label for `def.id`.
 */
export default function ParamControl({ def, value, onChange, idPrefix, label: labelOverride }) {
  const label = labelOverride ?? LABELS[def.id] ?? def.id;
  if (def.scale === 'enum') {
    return (
      <RadioGroup
        legend={label}
        options={def.options.map((name, i) => ({ value: i, label: OPTION_LABELS[name] ?? name }))}
        value={value}
        onChange={(i) => onChange(def.id, i)}
      />
    );
  }
  const stepped = def.scale === 'lin';
  return (
    <Slider
      id={`${idPrefix}-${def.id}`}
      label={label}
      min={stepped ? def.min : 0}
      max={stepped ? def.max : NORM_STEPS}
      step={stepped ? (def.step ?? (def.max - def.min) / NORM_STEPS) : 1}
      value={stepped ? value : Math.round(toNorm(def, value) * NORM_STEPS)}
      valueText={formatParam(def, value)}
      onChange={(position) => onChange(def.id, stepped ? clampParam(def, position) : fromNorm(def, position / NORM_STEPS))}
      onReset={() => onChange(def.id, def.default)}
    />
  );
}
