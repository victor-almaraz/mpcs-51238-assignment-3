'use client';

import { useState } from 'react';
import Card from '@/components/ui/Card';
import Select from '@/components/ui/Select';
import StatusRegion from '@/components/ui/StatusRegion';
import { groupHeading, sectionHeading } from '@/design-systems/industrial/classes';
import { clampParam } from '@/dsp/core/params';
import { instrumentFor } from '@/dsp/instruments/registry';
import { INSTRUMENT_LABELS } from '@/lib/project/model';
import SamplerPanel from '@/components/sampler/SamplerPanel';
import PresetPicker from '@/components/presets/PresetPicker';
import { getSource } from '@/lib/audio/decode';
import { applyPreset } from '@/lib/presets/store';
import { setInstrumentType, setSamplerSource } from '@/lib/project/clip-commands';
import DrumMachinePanel from './DrumMachinePanel';
import GranularSource from './GranularSource';
import ParamControl, { paramLabel } from './ParamControl';
import { sectionParams } from './sections';

const TYPE_OPTIONS = Object.entries(INSTRUMENT_LABELS).map(([value, label]) => ({ value, label }));

/**
 * Parameter panel for a track's instrument, generated from its ParamDefs:
 * sections with a heading (Oscillator, Filter, Envelope, Tuning) holding a
 * segmented radio group per enum and a knob with unit value text per number.
 * `onParamChange(deviceId, paramId, value)` receives plain, clamped values;
 * the sampler panel also edits the document through `onEdit`. The Instrument
 * select changes the track's instrument type in place: clips, effects and mixer
 * settings stay, the instrument starts at its defaults, and Undo restores it.
 */
export default function InstrumentPanel({ project, track, device, onParamChange, onEdit, disabled, loading }) {
  const entry = instrumentFor(device.type);
  const name = INSTRUMENT_LABELS[device.type] ?? device.type;
  const sourceDef = device.type === 'granular' ? entry?.params.find((d) => d.id === 'source') : null;
  const fileSource = sourceDef ? sourceDef.options[clampParam(sourceDef, device.params.source)] === 'sample' : false;
  const control = (def) => (
    <ParamControl
      key={def.id}
      def={def}
      idPrefix={`instrument-${device.id}`}
      value={clampParam(def, device.params[def.id])}
      onChange={(id, value) => onParamChange(device.id, id, value)}
    />
  );
  /** Applies a library preset (or the defaults); a sampler zone whose source is loaded joins the project's sources. */
  const [message, setMessage] = useState('');

  function changeType(type) {
    const result = setInstrumentType(project, track.id, type);
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }
    onEdit(result.doc);
    const label = INSTRUMENT_LABELS[type] ?? type;
    // "an FM synth", "an Additive synth", "a Sampler".
    setMessage(`${track.name} is now ${/^(fm|[aeiou])/i.test(label) ? 'an' : 'a'} ${label}`);
  }

  function apply(preset) {
    let doc = applyPreset(project, device.id, preset);
    const loaded = preset?.sampler ? getSource(preset.sampler.sourceId) : null;
    if (loaded) {
      const bound = setSamplerSource(doc, device.id, loaded);
      if (bound.ok) doc = bound.doc;
    }
    onEdit(doc);
  }
  return (
    <Card as="section" aria-labelledby="instrument-panel-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="instrument-panel-heading" className={sectionHeading}>
          {name}: {track.name}
        </h2>
        <Select
          id={`instrument-${track.id}-type`}
          label="Instrument"
          labelClassName="w-auto"
          className="w-auto"
          value={device.type}
          options={TYPE_OPTIONS}
          disabled={disabled}
          onChange={changeType}
          data-help="Instrument: changes this track's instrument; its clips, effects and mixer settings stay."
        />
      </div>
      <StatusRegion visuallyHidden>{message}</StatusRegion>
      <PresetPicker kind="instrument" device={device} onApply={apply} disabled={disabled} />
      {device.type === 'drums' ? (
        <DrumMachinePanel device={device} disabled={disabled} onParamChange={onParamChange} />
      ) : device.type === 'sampler' ? (
        <SamplerPanel project={project} device={device} onEdit={onEdit} onParamChange={onParamChange} disabled={disabled} loading={loading} />
      ) : entry ? (
        <fieldset disabled={disabled} className="flex flex-wrap items-start gap-3">
          {sectionParams(entry.params).map((item, i) => {
            // The granular File source's controls sit beside the Source selector.
            const extra = item.section === 'Source' && fileSource ? <GranularSource project={project} device={device} onEdit={onEdit} loading={loading} /> : null;
            // A section holding one control of the same name ("Source") shows that name once, on the control.
            if (item.defs.length === 1 && paramLabel(item.defs[0]) === item.section) {
              return (
                <div key={`${item.section}-${i}`} className="flex flex-col gap-3 rounded-ds border border-border p-2">
                  {control(item.defs[0])}
                  {extra}
                </div>
              );
            }
            return (
              <fieldset key={`${item.section}-${i}`} className="flex flex-wrap items-start gap-x-2 gap-y-3 rounded-ds border border-border p-2">
                <legend className={groupHeading}>{item.section}</legend>
                {item.defs.map((def) => control(def))}
                {extra}
              </fieldset>
            );
          })}
        </fieldset>
      ) : (
        <p className="text-sm text-muted">This instrument has no controls yet.</p>
      )}
    </Card>
  );
}
