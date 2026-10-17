'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import StatusRegion from '@/components/ui/StatusRegion';
import useThrottledAnnouncer from '@/components/ui/useThrottledAnnouncer';
import ParamControl from '@/components/instruments/ParamControl';
import { sectionParams } from '@/components/instruments/sections';
import { cx, focusRing, sectionHeading } from '@/design-systems/industrial/classes';
import { clampParam } from '@/dsp/core/params';
import { LOOP_OFF, MAX_TRANSPOSE, SAMPLER_DEF, SAMPLER_PARAMS } from '@/dsp/instruments/sampler-zones';
import { getSource, importFiles } from '@/lib/audio/decode';
import { getEngine } from '@/lib/audio/engine-client';
import { noteName } from '@/lib/audio/keyboard-input';
import { setSamplerSource } from '@/lib/project/clip-commands';
import { loopMarkersFor, markerFrames, ZONE_REASONS } from './markers';
import SampleEditor from './SampleEditor';
import IconButton from '@/components/ui/IconButton';

const MARKER_IDS = ['start', 'end', 'loopStart', 'loopEnd', 'loopCrossfade', 'rootNote'];
const LABELS = {
  fineTune: 'Fine tune',
  loopMode: 'Loop mode',
  loopCrossfade: 'Loop crossfade',
  trigger: 'Trigger mode',
  attack: 'Attack',
  decay: 'Decay',
  sustain: 'Sustain',
  release: 'Release',
  cutoff: 'Cutoff',
  resonance: 'Resonance',
  filterEnvAmount: 'Filter envelope',
  velSens: 'Velocity sensitivity',
  voiceMode: 'Voices',
  glide: 'Glide',
  pan: 'Pan',
  level: 'Level',
};

/** Root note as a spin button showing the note name (DEV-03): Up/Down ±1, Page Up/Down ±12. */
function RootNote({ id, value, onChange, disabled }) {
  const def = SAMPLER_DEF.rootNote;
  const set = (v) => onChange(Math.min(def.max, Math.max(def.min, v)));
  function onKeyDown(e) {
    const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 12, PageDown: -12 }[e.key];
    if (e.key === 'Home') set(def.min);
    else if (e.key === 'End') set(def.max);
    else if (step) set(value + step);
    else return;
    e.preventDefault();
  }
  return (
    <div className="flex items-center gap-2">
      <span id={`${id}-label`} className="text-sm font-bold">
        Root note
      </span>
      <Button size="sm" aria-label="Root note down" disabled={disabled || value <= def.min} onClick={() => set(value - 1)}>
        −
      </Button>
      <div
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={`${id}-label`}
        aria-valuemin={def.min}
        aria-valuemax={def.max}
        aria-valuenow={value}
        aria-valuetext={noteName(value)}
        aria-disabled={disabled || undefined}
        onKeyDown={disabled ? undefined : onKeyDown}
        className={cx('min-w-12 rounded-ds border border-border-strong bg-surface px-2 py-1 text-center tabular-nums', focusRing)}
      >
        {noteName(value)}
      </div>
      <Button size="sm" aria-label="Root note up" disabled={disabled || value >= def.max} onClick={() => set(value + 1)}>
        +
      </Button>
    </div>
  );
}

/**
 * Sampler device panel: the zone source ("Load sample…", "Choose project
 * source", "Remove sample"), its status ("Audio not loaded: <source name>"
 * when it is in neither memory nor the store), the sample editor (DEV-03),
 * "Preview root note" and the remaining parameters.
 */
export default function SamplerPanel({ project, device, onEdit, onParamChange, disabled, loading }) {
  const engine = getEngine();
  const engineState = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [announcement, announce] = useThrottledAnnouncer();
  const fileRef = useRef(null);
  const zone = device.sampler ?? null;
  const source = zone ? getSource(zone.sourceId) : null;
  const params = Object.fromEntries(SAMPLER_PARAMS.map((d) => [d.id, clampParam(d, device.params[d.id])]));
  const reason = engineState.samplers?.[device.id]?.reason;
  const latest = useRef(project);
  useEffect(() => {
    latest.current = project;
  }, [project]);

  function choose(entry) {
    const result = setSamplerSource(latest.current, device.id, entry);
    if (!result.ok) {
      setMessage(result.error.message);
      return false;
    }
    onEdit(result.doc);
    return true;
  }

  async function load(files) {
    if (files.length === 0) return;
    setBusy(true);
    try {
      await importFiles(files.slice(0, 1), {
        rate: engine.decodeRate(),
        projectSources: latest.current.sources,
        onResult(result) {
          if (!result.ok) setMessage(result.message);
          else if (choose(result.source)) setMessage(result.message ?? `Loaded ${result.source.name}. Saved on this device.`);
        },
      });
    } finally {
      setBusy(false);
    }
  }

  function chooseProjectSource(id) {
    if (!id) return;
    const loaded = getSource(id);
    const ref = latest.current.sources[id];
    const entry = loaded ?? { sourceId: id, name: ref.name, frames: ref.frames, rate: ref.sampleRate, channels: ref.channels, mimeType: ref.format };
    if (choose(entry)) setMessage(`Sample: ${entry.name}`);
  }

  function setLoopMode(mode) {
    if (mode !== LOOP_OFF && source) {
      const m = markerFrames(params, source.frames);
      const fixed = loopMarkersFor(m);
      if (fixed !== m) {
        onParamChange(device.id, 'loopStart', fixed.loopStart / source.frames);
        onParamChange(device.id, 'loopEnd', fixed.loopEnd / source.frames);
      }
    }
    onParamChange(device.id, 'loopMode', mode);
  }

  let status;
  if (!zone) status = 'No sample. Load a sample file or choose a project source.';
  else if (source) status = `Sample: ${zone.sourceName}, ${(source.frames / source.rate).toFixed(2)} s, ${source.stored === 'device' ? 'Saved on this device' : 'Session only'}`;
  else if (loading?.has(zone.sourceId)) status = `Loading ${zone.sourceName}…`;
  else status = `Audio not loaded: ${zone.sourceName}`;

  const sourceOptions = Object.values(project.sources).map((ref) => ({ value: ref.id, label: ref.name }));
  const control = (id) => (
    <ParamControl
      key={id}
      def={SAMPLER_DEF[id]}
      idPrefix={`instrument-${device.id}`}
      label={LABELS[id]}
      value={params[id]}
      onChange={(pid, value) => (pid === 'loopMode' ? setLoopMode(value) : onParamChange(device.id, pid, value))}
    />
  );

  return (
    <fieldset disabled={disabled} className="flex flex-col gap-3">
      <section aria-labelledby={`sampler-${device.id}-sample`} className="flex flex-col gap-2">
        <h3 id={`sampler-${device.id}-sample`} className={sectionHeading}>
          Sample
        </h3>
        <p className={cx('text-sm', !source && zone ? 'font-bold' : '')}>{status}</p>
        {reason ? (
          <p role="alert" className="text-sm text-danger">
            {ZONE_REASONS[reason] ?? `The sample zone is not valid (${reason}).`}
          </p>
        ) : null}
        <div className="flex flex-wrap items-end gap-2">
          <IconButton icon="upload" label={busy ? 'Loading sample…' : 'Load sample…'} onClick={() => fileRef.current?.click()} disabled={busy} data-help="Load sample: a WAV, MP3, M4A, FLAC or OGG file." />
          {sourceOptions.length > 0 ? (
            <Select
              id={`sampler-${device.id}-source`}
              label="Choose project source"
              labelClassName="w-auto whitespace-nowrap"
              value={zone?.sourceId && project.sources[zone.sourceId] ? zone.sourceId : ''}
              options={[{ value: '', label: 'None' }, ...sourceOptions]}
              onChange={chooseProjectSource}
            />
          ) : null}
          {zone ? <IconButton icon="x" label="Remove sample" onClick={() => choose(null) && setMessage('Sample removed')} /> : null}
          <IconButton icon="volume-2" label="Preview root note" disabled={!source} onClick={() => engine.preview(params.rootNote)} />
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.oga"
          hidden
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            const files = [...e.target.files];
            e.target.value = '';
            load(files);
          }}
        />
        <StatusRegion className="text-sm">{message}</StatusRegion>
        <StatusRegion visuallyHidden>{announcement}</StatusRegion>
      </section>
      {source ? (
        <SampleEditor
          deviceId={device.id}
          source={source}
          params={params}
          loopMode={params.loopMode}
          announce={announce}
          disabled={disabled}
          onMarkers={(changes) => Object.entries(changes).forEach(([id, v]) => onParamChange(device.id, id, v))}
          onCrossfade={(ms) => onParamChange(device.id, 'loopCrossfade', ms)}
        />
      ) : null}
      <RootNote id={`sampler-${device.id}-root`} value={params.rootNote} disabled={disabled} onChange={(v) => onParamChange(device.id, 'rootNote', v)} />
      <p className="text-sm text-muted">Notes play up to {MAX_TRANSPOSE} semitones from the root note.</p>
      <div className="flex flex-wrap items-start gap-3">
        {sectionParams(SAMPLER_PARAMS.filter((d) => !MARKER_IDS.includes(d.id))).map((item, i) => (
          <fieldset key={`${item.section}-${i}`} className="flex flex-wrap items-start gap-x-2 gap-y-3 rounded-ds border border-border p-2">
            <legend className={sectionHeading}>{item.section}</legend>
            {item.defs.map((d) => control(d.id))}
          </fieldset>
        ))}
      </div>
    </fieldset>
  );
}
