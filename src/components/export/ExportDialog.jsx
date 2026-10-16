'use client';

import { useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import RadioGroup from '@/components/ui/RadioGroup';
import Select from '@/components/ui/Select';
import Slider from '@/components/ui/Slider';
import StatusRegion from '@/components/ui/StatusRegion';
import { errorText } from '@/design-systems/industrial/classes';
import { getEngine } from '@/lib/audio/engine-client';
import { DEFAULT_TAIL_S, MAX_TAIL_S, exportFrames, renderOffline, silentClips } from '@/lib/export/render-offline';
import { FORMATS, encodeWav } from '@/lib/export/wav-writer';
import { safeFileName, saveFile } from '@/lib/files/save-file';
import { flushSaves } from '@/lib/project/store';
import { getSettings, updateSettings } from '@/lib/settings/store';

const FORMAT_OPTIONS = Object.entries(FORMATS).map(([value, f]) => ({ value, label: f.label }));
const RANGE_OPTIONS = [
  { value: 'project', label: 'Whole project' },
  { value: 'loop', label: 'Loop' },
];
const WAV_TYPE = { description: 'WAV audio', accept: { 'audio/wav': ['.wav'] } };

/**
 * Export (assignment-3-scope.md, Export): range, format and tail, the clips
 * that will be silent, and a progress bar (determinate while the engine
 * reports progress). One export runs at a time; the live transport stops
 * first. `loop` is the loop range in ticks.
 */
export default function ExportDialog({ project, loop, disabled }) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState('project');
  const [format, setFormat] = useState(() => getSettings().exportFormat);
  const [tailS, setTailS] = useState(DEFAULT_TAIL_S);
  const [progress, setProgress] = useState(undefined); // undefined idle, null indeterminate, 0–1 determinate
  const [error, setError] = useState(null);
  const [message, setMessage] = useState('');
  const buttonRef = useRef(null);
  const exportRef = useRef(null);
  const rendering = progress !== undefined;
  const fs = getEngine().decodeRate();
  // Compiled only while the dialog is open.
  const frames = open ? exportFrames(project, fs, { range, loop, tailS }) : { ok: false, error: null };
  const silent = open ? silentClips(project) : [];

  async function run() {
    setError(null);
    setMessage('');
    flushSaves();
    getEngine().stop();
    setProgress(null);
    try {
      const result = await renderOffline(project, fs, { range, loop, tailS, masterVolumeDb: getSettings().masterVolumeDb, onProgress: setProgress });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const { left, right } = result.value;
      const blob = new Blob([encodeWav(left, right, fs, format)], { type: 'audio/wav' });
      const name = safeFileName(project.name, '.wav');
      const outcome = await saveFile(blob, name, WAV_TYPE);
      if (outcome === 'saved') setMessage(`Exported ${name}`);
    } catch (err) {
      console.error(err);
      setError('The export failed. Reload the page and try again.');
    } finally {
      setProgress(undefined);
    }
  }

  return (
    <>
      <Button ref={buttonRef} onClick={() => setOpen(true)} disabled={disabled}>
        Export
      </Button>
      <Dialog open={open} onClose={() => !rendering && setOpen(false)} title="Export WAV" initialFocusRef={exportRef} returnFocusRef={buttonRef}>
        <div className="flex flex-col gap-3">
          <RadioGroup legend="Range" options={RANGE_OPTIONS} value={range} onChange={setRange} disabled={rendering} />
          <Select
            id="export-format"
            label="Format"
            value={format}
            options={FORMAT_OPTIONS}
            disabled={rendering}
            onChange={(v) => {
              setFormat(v);
              updateSettings({ exportFormat: v });
            }}
          />
          <Slider
            id="export-tail"
            label="Tail"
            min={0}
            max={MAX_TAIL_S}
            step={0.5}
            value={tailS}
            valueText={`${tailS.toFixed(1)} s`}
            disabled={rendering}
            onChange={setTailS}
            onReset={() => setTailS(DEFAULT_TAIL_S)}
          />
          {frames.ok ? (
            <p className="text-sm">Length: {(frames.value.total / fs).toFixed(1)} s including the tail, at {fs} Hz.</p>
          ) : frames.error ? (
            <p role="alert" className={errorText}>
              {frames.error}
            </p>
          ) : null}
          {silent.length > 0 ? (
            <div className="text-sm">
              <p>These clips have no loaded audio and will be silent:</p>
              <ul className="list-disc pl-5">
                {silent.map((name, i) => (
                  <li key={i}>{name}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {rendering ? (
            <div
              role="progressbar"
              aria-label="Export progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress === null ? undefined : Math.round(progress * 100)}
              aria-valuetext={progress === null ? 'Rendering…' : `${Math.round(progress * 100)} %`}
              className="h-3 overflow-hidden rounded-ds border border-border-strong bg-surface"
            >
              <div className={progress === null ? 'h-full w-1/3 bg-accent motion-safe:animate-pulse' : 'h-full bg-accent'} style={progress === null ? undefined : { width: `${progress * 100}%` }} />
            </div>
          ) : null}
          {error ? (
            <p role="alert" className={errorText}>
              {error}
            </p>
          ) : null}
          <StatusRegion className="text-sm">{message}</StatusRegion>
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => setOpen(false)} disabled={rendering}>
              Close
            </Button>
            <Button ref={exportRef} variant="primary" onClick={run} disabled={rendering || !frames.ok}>
              {rendering ? 'Exporting…' : 'Export WAV'}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
