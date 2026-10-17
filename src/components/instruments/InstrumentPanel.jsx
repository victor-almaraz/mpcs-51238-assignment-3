'use client';

import Card from '@/components/ui/Card';
import { sectionHeading } from '@/design-systems/industrial/classes';
import { clampParam } from '@/dsp/core/params';
import { instrumentFor } from '@/dsp/instruments/registry';
import { INSTRUMENT_LABELS } from '@/lib/project/model';
import SamplerPanel from '@/components/sampler/SamplerPanel';
import PresetPicker from '@/components/presets/PresetPicker';
import { getSource } from '@/lib/audio/decode';
import { applyPreset } from '@/lib/presets/store';
import { setSamplerSource } from '@/lib/project/clip-commands';
import DrumMachinePanel from './DrumMachinePanel';
import GranularSource from './GranularSource';
import ParamControl from './ParamControl';
import { sectionParams } from './sections';


/**
 * Parameter panel for a track's instrument, generated from its ParamDefs:
 * sections with a heading (Oscillator, Filter, Envelope, Tuning) holding a
 * segmented radio group per enum and a knob with unit value text per number.
 * `onParamChange(deviceId, paramId, value)` receives plain, clamped values;
 * the sampler panel also edits the document through `onEdit`.
 */
export default function InstrumentPanel({ project, track, device, onParamChange, onEdit, disabled, loading }) {
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
  /** Applies a library preset (or the defaults); a sampler zone whose source is loaded joins the project's sources. */
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
      <h2 id="instrument-panel-heading" className={sectionHeading}>
        {name}: {track.name}
      </h2>
      <PresetPicker kind="instrument" device={device} onApply={apply} disabled={disabled} />
      {device.type === 'drums' ? (
        <DrumMachinePanel device={device} disabled={disabled} onParamChange={onParamChange} />
      ) : device.type === 'sampler' ? (
        <SamplerPanel project={project} device={device} onEdit={onEdit} onParamChange={onParamChange} disabled={disabled} loading={loading} />
      ) : entry ? (
        <fieldset disabled={disabled} className="flex flex-wrap items-start gap-3">
          {sectionParams(entry.params).map((item, i) => (
            <fieldset key={`${item.section}-${i}`} className="flex flex-wrap items-start gap-x-2 gap-y-3 rounded-ds border border-border p-2">
              <legend className={sectionHeading}>{item.section}</legend>
              {item.defs.map((def) => control(def))}
            </fieldset>
          ))}
          {device.type === 'granular' && entry.params[0].options[clampParam(entry.params[0], device.params.source)] === 'sample' ? (
            <GranularSource project={project} device={device} onEdit={onEdit} loading={loading} />
          ) : null}
        </fieldset>
      ) : (
        <p className="text-sm text-muted">This instrument has no controls yet.</p>
      )}
    </Card>
  );
}
