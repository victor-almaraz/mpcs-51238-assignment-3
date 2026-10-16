'use client';

import Card from '@/components/ui/Card';
import RadioGroup from '@/components/ui/RadioGroup';
import Slider from '@/components/ui/Slider';
import { sectionHeading } from '@/design-systems/industrial/classes';
import { clampParam, fromNorm, toNorm } from '@/dsp/core/params';
import { instrumentFor } from '@/dsp/instruments/registry';
import { INSTRUMENT_LABELS } from '@/lib/project/model';

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
};

const OPTION_LABELS = { sine: 'Sine', square: 'Square', saw: 'Saw', triangle: 'Triangle' };

/** Value text with units: "440 Hz", "2.0 kHz", "10 ms", "1.20 s", "−6.0 dB", "2.5×". */
export function formatParam(def, value) {
  const minus = (s) => s.replace('-', '−');
  switch (def.unit) {
    case 'Hz':
      return value >= 1000 ? `${(value / 1000).toFixed(1)} kHz` : `${Math.round(value)} Hz`;
    case 's':
      return value < 1 ? `${Math.round(value * 1000)} ms` : `${value.toFixed(2)} s`;
    case 'dB':
      return minus(`${value.toFixed(1)} dB`);
    case '×':
      return `${value.toFixed(1)}×`;
    default:
      return minus(String(Math.round(value * 100) / 100));
  }
}

function ParamControl({ def, value, onChange, idPrefix }) {
  const label = LABELS[def.id] ?? def.id;
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

/**
 * Parameter panel for a track's instrument, generated from its ParamDefs: a
 * radio group per enum, a slider with unit value text per number.
 * `onParamChange(deviceId, paramId, value)` receives plain, clamped values.
 */
export default function InstrumentPanel({ track, device, onParamChange, disabled }) {
  const entry = instrumentFor(device.type);
  const name = INSTRUMENT_LABELS[device.type] ?? device.type;
  return (
    <Card as="section" aria-labelledby="instrument-panel-heading">
      <h2 id="instrument-panel-heading" className={sectionHeading}>
        {name}: {track.name}
      </h2>
      {entry ? (
        <fieldset disabled={disabled} className="flex flex-col gap-3">
          {entry.params.map((def) => (
            <ParamControl
              key={def.id}
              def={def}
              idPrefix={`instrument-${device.id}`}
              value={clampParam(def, device.params[def.id])}
              onChange={(id, value) => onParamChange(device.id, id, value)}
            />
          ))}
        </fieldset>
      ) : (
        <p className="text-sm text-muted">This instrument has no controls yet.</p>
      )}
    </Card>
  );
}
