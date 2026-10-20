'use client';

import Knob from '@/components/ui/Knob';
import RadioGroup from '@/components/ui/RadioGroup';
import { clampParam, fromNorm, toNorm } from '@/dsp/core/params';
import { formatParam, parseParam, shortParam } from './param-text';

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
