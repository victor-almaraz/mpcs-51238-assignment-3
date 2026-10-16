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
  damping: 'Damping',
  brightness: 'Brightness',
  decay: 'Decay (T60)',
  source: 'Source',
  grainSize: 'Grain size',
  density: 'Density',
  spray: 'Spray',
  ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`h${i + 1}`, `Harmonic ${i + 1}`])),
};

const OPTION_LABELS = { sine: 'Sine', square: 'Square', saw: 'Saw', triangle: 'Triangle', noise: 'Noise', chord: 'Chord' };

/** Value text with units: "440 Hz", "2.0 kHz", "10 ms", "1.20 s", "−6.0 dB", "2.5×", "50 %". */
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

/** Consecutive defs sharing a `group` become one { group, defs } item; others are { def }. */
function groupParams(defs) {
  const items = [];
  for (const def of defs) {
    const last = items[items.length - 1];
    if (def.group && last?.group === def.group) last.defs.push(def);
    else if (def.group) items.push({ group: def.group, defs: [def] });
    else items.push({ def });
  }
  return items;
}

/**
 * Parameter panel for a track's instrument, generated from its ParamDefs: a
 * radio group per enum, a slider with unit value text per number.
 * `onParamChange(deviceId, paramId, value)` receives plain, clamped values.
 */
export default function InstrumentPanel({ track, device, onParamChange, disabled }) {
  const entry = instrumentFor(device.type);
  const name = INSTRUMENT_LABELS[device.type] ?? device.type;
  const control = (def) => (
    <ParamControl
      key={def.id}
      def={def}
      idPrefix={`instrument-${device.id}`}
      value={clampParam(def, device.params[def.id])}
      onChange={(id, value) => onParamChange(device.id, id, value)}
    />
  );
  return (
    <Card as="section" aria-labelledby="instrument-panel-heading">
      <h2 id="instrument-panel-heading" className={sectionHeading}>
        {name}: {track.name}
      </h2>
      {entry ? (
        <fieldset disabled={disabled} className="flex flex-col gap-3">
          {groupParams(entry.params).map((item) =>
            item.group ? (
              <fieldset key={item.group} className="flex flex-col gap-2 rounded-ds border border-border p-2">
                <legend className={sectionHeading}>{item.group}</legend>
                {item.defs.map((def) => control(def))}
              </fieldset>
            ) : (
              control(item.def)
            ),
          )}
        </fieldset>
      ) : (
        <p className="text-sm text-muted">This instrument has no controls yet.</p>
      )}
    </Card>
  );
}
