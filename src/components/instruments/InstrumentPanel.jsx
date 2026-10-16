'use client';

import Card from '@/components/ui/Card';
import { sectionHeading } from '@/design-systems/industrial/classes';
import { clampParam } from '@/dsp/core/params';
import { instrumentFor } from '@/dsp/instruments/registry';
import { INSTRUMENT_LABELS } from '@/lib/project/model';
import SamplerPanel from '@/components/sampler/SamplerPanel';
import DrumMachinePanel from './DrumMachinePanel';
import ParamControl from './ParamControl';

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
  return (
    <Card as="section" aria-labelledby="instrument-panel-heading">
      <h2 id="instrument-panel-heading" className={sectionHeading}>
        {name}: {track.name}
      </h2>
      {device.type === 'drums' ? (
        <DrumMachinePanel device={device} disabled={disabled} onParamChange={onParamChange} />
      ) : device.type === 'sampler' ? (
        <SamplerPanel project={project} device={device} onEdit={onEdit} onParamChange={onParamChange} disabled={disabled} loading={loading} />
      ) : entry ? (
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
