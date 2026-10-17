'use client';

import { useEffect, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Select from '@/components/ui/Select';
import StatusRegion from '@/components/ui/StatusRegion';
import Toggle from '@/components/ui/Toggle';
import ParamControl from '@/components/instruments/ParamControl';
import PresetPicker from '@/components/presets/PresetPicker';
import { applyPreset } from '@/lib/presets/store';
import { sectionHeading } from '@/design-systems/industrial/classes';
import { clampParam } from '@/dsp/core/params';
import { EFFECTS, effectFor } from '@/dsp/effects/registry';
import { MAX_EFFECTS } from '@/dsp/protocol';
import { addEffect, addEffectBlocker, chainIds, moveEffect, removeEffect, setEffectBypass } from '@/lib/project/effect-commands';

const LABELS = {
  lowFreq: 'Low frequency',
  lowGain: 'Low gain',
  midFreq: 'Mid frequency',
  midGain: 'Mid gain',
  midQ: 'Mid Q',
  highFreq: 'High frequency',
  highGain: 'High gain',
  mode: 'Mode',
  cutoff: 'Cutoff',
  resonance: 'Resonance',
  threshold: 'Threshold',
  ratio: 'Ratio',
  attack: 'Attack',
  release: 'Release',
  makeup: 'Makeup',
  drive: 'Drive',
  tone: 'Tone',
  mix: 'Mix',
  output: 'Output',
  time: 'Time',
  sync: 'Tempo sync',
  feedback: 'Feedback',
  highCut: 'High cut',
  size: 'Size',
  decay: 'Decay',
  damping: 'Damping',
  bias: 'Bias',
  preDelay: 'Pre-delay',
};

/** "1/4 dotted", "1/8 triplet", "Off" for a delay sync option. */
function syncLabel(option) {
  if (option === 'off') return 'Off (time in ms)';
  if (option.endsWith('d')) return `${option.slice(0, -1)} dotted`;
  if (option.endsWith('t')) return `${option.slice(0, -1)} triplet`;
  return option;
}

const TYPE_OPTIONS = Object.entries(EFFECTS).map(([value, e]) => ({ value, label: e.label }));

/**
 * One device of the chain (DEV-01): a group named "Delay, 3 of 5" with
 * Bypass, Move left, Move right, a preset picker and Remove. `name` is the
 * device's name in the chain ("Delay", or "Delay 2" when the type repeats).
 */
function EffectSlot({ device, name, position, count, onCommand, onParam, disabled }) {
  const entry = effectFor(device.type);
  const groupLabel = `${name}, ${position} of ${count}`;
  const keep = (role) => `${device.id}:${role}`;
  if (!entry) {
    return (
      <li>
        <div role="group" aria-label={groupLabel} className="flex flex-col gap-2 rounded-ds border border-border p-2">
        <p className="text-sm">Unknown effect “{String(device.type)}”. It passes the signal through unchanged.</p>
        <div>
          <Button size="sm" data-focus={keep('remove')} disabled={disabled} aria-label={`Remove ${name}`} onClick={() => onCommand((doc, trackId) => removeEffect(doc, trackId, device.id), `Removed ${name}`, { removed: device.id })}>
            Remove
          </Button>
        </div>
        </div>
      </li>
    );
  }
  return (
    <li>
      <div role="group" aria-label={groupLabel} className="flex w-full flex-col gap-2 rounded-ds border border-border-strong bg-surface p-2 sm:w-[26rem]">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className={sectionHeading}>{name}</h3>
        {device.bypass ? <span className="text-sm font-bold text-muted">Bypassed</span> : null}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Toggle size="sm" data-focus={keep('bypass')} pressed={device.bypass === true} disabled={disabled} aria-label={`Bypass ${name}`} onClick={() => onCommand((doc) => setEffectBypass(doc, device.id, !device.bypass), `${name} ${device.bypass ? 'on' : 'bypassed'}`)}>
          Bypass
        </Toggle>
        <Button size="sm" data-focus={keep('left')} disabled={disabled || position === 1} aria-label={`Move ${name} left`} onClick={() => onCommand((doc, trackId) => moveEffect(doc, trackId, device.id, -1), `${name} moved to position ${position - 1}`, { focus: `${device.id}:left` })}>
          Left
        </Button>
        <Button size="sm" data-focus={keep('right')} disabled={disabled || position === count} aria-label={`Move ${name} right`} onClick={() => onCommand((doc, trackId) => moveEffect(doc, trackId, device.id, 1), `${name} moved to position ${position + 1}`, { focus: `${device.id}:right` })}>
          Right
        </Button>
        <Button size="sm" data-focus={keep('remove')} disabled={disabled} aria-label={`Remove ${name}`} onClick={() => onCommand((doc, trackId) => removeEffect(doc, trackId, device.id), `Removed ${name}`, { removed: device.id })}>
          Remove
        </Button>
      </div>
      <PresetPicker
        kind="effect"
        device={device}
        label={`${name} preset`}
        owner={name}
        disabled={disabled}
        onApply={(preset) => onCommand((doc) => ({ ok: true, doc: applyPreset(doc, device.id, preset) }), `Applied ${preset?.name ?? 'Default settings'} to ${name}`)}
      />
      <fieldset disabled={disabled} className="flex flex-col gap-2">
        <legend className="sr-only">{name} settings</legend>
        {entry.params.map((def) =>
          def.id === 'sync' ? (
            <Select
              key={def.id}
              id={`effect-${device.id}-sync`}
              label={LABELS.sync}
              aria-label={`${name} ${LABELS.sync.toLowerCase()}`}
              value={String(clampParam(def, device.params[def.id]))}
              options={def.options.map((o, i) => ({ value: String(i), label: syncLabel(o) }))}
              onChange={(v) => onParam(device.id, 'sync', Number(v))}
            />
          ) : (
            <ParamControl
              key={def.id}
              def={def}
              idPrefix={`effect-${device.id}`}
              label={`${name} ${LABELS[def.id].toLowerCase()}`}
              value={clampParam(def, device.params[def.id])}
              onChange={(id, value) => onParam(device.id, id, value)}
            />
          ),
        )}
      </fieldset>
      </div>
    </li>
  );
}

/** Chain names: the effect label, numbered when the type appears more than once ("Delay 2"). */
function chainNames(devices) {
  const totals = new Map();
  for (const d of devices) totals.set(d?.type, (totals.get(d?.type) ?? 0) + 1);
  const seen = new Map();
  return devices.map((d) => {
    const label = effectFor(d?.type)?.label ?? 'Unknown effect';
    const n = (seen.get(d?.type) ?? 0) + 1;
    seen.set(d?.type, n);
    return totals.get(d?.type) > 1 ? `${label} ${n}` : label;
  });
}

/**
 * Insert chain of one track or the master (assignment-3-scope.md, Effects;
 * DEV-01): devices left to right, up to 8 (at most 4 reverbs per project),
 * each with bypass, move, preset and remove, every control a labelled native
 * input. Focus follows a moved device and moves on from a removed one.
 * `onCommand(fn)` applies fn(latestDoc) when it succeeds and returns its
 * result; `onParam(deviceId, id, value)` edits one parameter.
 */
export default function EffectChain({ project, trackId, title, onCommand, onParam, disabled }) {
  const [type, setType] = useState('eq3');
  const [message, setMessage] = useState('');
  const listRef = useRef(null);
  const addRef = useRef(null);
  const pendingFocus = useRef(null);
  const track = project.tracks[trackId];
  const ids = chainIds(track).filter((id) => project.devices[id]);
  const devices = ids.map((id) => project.devices[id]);
  const names = chainNames(devices);
  const blocker = addEffectBlocker(project, trackId, type);
  const full = ids.length >= MAX_EFFECTS;
  const headingId = `chain-${trackId}-heading`;

  useEffect(() => {
    const key = pendingFocus.current;
    if (!key) return;
    pendingFocus.current = null;
    const find = (k) => listRef.current?.querySelector(`[data-focus="${k}"]:not(:disabled)`);
    // A move that reaches either end disables its button; the other move button takes focus.
    const other = key.endsWith(':left') ? key.replace(':left', ':right') : key.replace(':right', ':left');
    (find(key) ?? find(other) ?? addRef.current)?.focus();
  });

  function run(fn, success, { focus, removed } = {}) {
    const result = onCommand((doc) => fn(doc, trackId));
    setMessage(result.ok ? success : result.error.message);
    if (!result.ok) return;
    if (focus) pendingFocus.current = focus;
    if (removed) {
      const i = ids.indexOf(removed);
      const next = ids[i + 1] ?? ids[i - 1];
      pendingFocus.current = next ? `${next}:remove` : 'add';
    }
  }

  return (
    <Card as="section" aria-labelledby={headingId}>
      <h2 id={headingId} className={sectionHeading}>
        {title}
      </h2>
      {ids.length === 0 ? <p className="text-sm">No effects. The signal passes through unchanged.</p> : null}
      <ol ref={listRef} className="flex flex-wrap items-start gap-2">
        {devices.map((device, i) => (
          <EffectSlot
            key={device.id}
            device={device}
            name={names[i]}
            position={i + 1}
            count={ids.length}
            disabled={disabled}
            onParam={onParam}
            onCommand={run}
          />
        ))}
      </ol>
      <div className="flex flex-wrap items-end gap-2">
        <Select id={`chain-${trackId}-type`} label="Effect" value={type} options={TYPE_OPTIONS} onChange={setType} disabled={disabled} />
        <Button ref={addRef} disabled={disabled || blocker !== null} aria-describedby={`chain-${trackId}-limit`} onClick={() => run((doc, id) => addEffect(doc, id, type), `Added ${effectFor(type).label}`)}>
          Add effect
        </Button>
      </div>
      <p id={`chain-${trackId}-limit`} className="text-sm text-muted">
        {full ? `Chain full (${MAX_EFFECTS} of ${MAX_EFFECTS})` : (blocker ?? `${ids.length} of ${MAX_EFFECTS} slots used.`)}
      </p>
      <StatusRegion visuallyHidden>{message}</StatusRegion>
    </Card>
  );
}
