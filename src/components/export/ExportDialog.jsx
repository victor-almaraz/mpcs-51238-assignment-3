'use client';

import { useEffect, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import RadioGroup from '@/components/ui/RadioGroup';
import Select from '@/components/ui/Select';
import Slider from '@/components/ui/Slider';
import StatusRegion from '@/components/ui/StatusRegion';
import useCommands from '@/components/commands/useCommands';
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

/** File size as shown: "840 KB", "12.4 MB". */
export function sizeText(bytes) {
  return bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} KB` : `${(bytes / 1e6).toFixed(1)} MB`;
}

/** Elapsed time as m:ss. */
const clockText = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Export (assignment-3-scope.md, Export; EXP-02): range, format and tail, the
 * clips that will be silent, and a progress bar with percentage, elapsed time
 * and Cancel. A finished render offers Download with the file size; nothing
 * downloads by itself. Cancel discards the render's output; a new export waits
 * until the cancelled render ends. The live transport stops first. `loop` is
 * the loop range in ticks. With `trigger` false the dialog has no button of
 * its own and opens through the project.export command (a File menu).
 */
export default function ExportDialog({ project, loop, disabled, trigger = true }) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState('project');
  const [format, setFormat] = useState(() => getSettings().exportFormat);
  const [tailS, setTailS] = useState(DEFAULT_TAIL_S);
  const [progress, setProgress] = useState(undefined); // undefined idle, null indeterminate, 0–1 determinate
  const [error, setError] = useState(null);
  const [message, setMessage] = useState('');
  const [ready, setReady] = useState(null); // { blob, name } of the finished render
  const cancelRef = useRef(null);
  const [elapsed, setElapsed] = useState(0);
  const buttonRef = useRef(null);
  const exportRef = useRef(null);
  const downloadRef = useRef(null);
  const closeRef = useRef(null);
  const runRef = useRef(0); // the current render; a cancelled render's token no longer matches
  const rendering = progress !== undefined;

  useEffect(() => {
    if (!rendering) return undefined;
    const started = Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - started) / 1000), 250);
    return () => clearInterval(timer);
  }, [rendering]);

  // Focus follows the export (EXP-02): Cancel while rendering, Download when the file is ready.
  useEffect(() => {
    if (rendering) cancelRef.current?.focus();
  }, [rendering]);
  useEffect(() => {
    if (ready) downloadRef.current?.focus();
  }, [ready]);
  useCommands([{ id: 'project.export', group: 'Project', label: 'Export WAV…', keys: 'Mod+Shift+E', global: true, run: () => setOpen(true), enabled: () => !disabled }]);
  const fs = getEngine().decodeRate();
  // Compiled only while the dialog is open.
  const frames = open ? exportFrames(project, fs, { range, loop, tailS }) : { ok: false, error: null };
  const silent = open ? silentClips(project) : [];

  /** Applies an option change; a finished render no longer matches the options. */
  const option = (set) => (value) => {
    set(value);
    setReady(null);
  };

  async function run() {
    const token = ++runRef.current;
    const current = () => runRef.current === token;
    setError(null);
    setMessage('');
    setReady(null);
    setElapsed(0);
    flushSaves();
    getEngine().stop();
    setProgress(null);
    try {
      const result = await renderOffline(project, fs, {
        range,
        loop,
        tailS,
        masterVolumeDb: getSettings().masterVolumeDb,
        onProgress: (p) => current() && setProgress(p),
      });
      if (!current()) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const { left, right } = result.value;
      const blob = new Blob([encodeWav(left, right, fs, format)], { type: 'audio/wav' });
      const name = safeFileName(project.name, '.wav');
      setReady({ blob, name });
      setMessage(`${name} is ready, ${sizeText(blob.size)}`);
    } catch (err) {
      console.error(err);
      if (current()) setError('The export failed. Reload the page and try again.');
    } finally {
      if (current()) setProgress(undefined);
    }
  }

  /**
   * Cancels the export at once. An offline render cannot be aborted, so the
   * running one finishes unseen and its result is discarded; a new export can start now.
   */
  function cancel() {
    runRef.current++;
    setProgress(undefined);
    setMessage('Export cancelled');
    requestAnimationFrame(() => exportRef.current?.focus());
  }

  async function download() {
    const outcome = await saveFile(ready.blob, ready.name, WAV_TYPE);
    if (outcome === 'saved') setMessage(`Exported ${ready.name}`);
  }

  function close() {
    if (rendering) cancel();
    setReady(null);
    setOpen(false);
  }

  const percent = progress == null ? 0 : Math.round(progress * 100);
  return (
    <>
      {trigger ? (
        <Button ref={buttonRef} size="sm" onClick={() => setOpen(true)} disabled={disabled} data-help="Export (Ctrl/Cmd+Shift+E): renders the project or the loop to a WAV file.">
          Export
        </Button>
      ) : null}
      <Dialog open={open} onClose={close} title="Export WAV" initialFocusRef={exportRef} returnFocusRef={buttonRef}>
        <div className="flex flex-col gap-3">
          <RadioGroup legend="Range" options={RANGE_OPTIONS} value={range} onChange={option(setRange)} disabled={rendering} />
          <Select
            id="export-format"
            label="Format"
            value={format}
            options={FORMAT_OPTIONS}
            disabled={rendering}
            onChange={(v) => {
              option(setFormat)(v);
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
            onChange={option(setTailS)}
            onReset={() => option(setTailS)(DEFAULT_TAIL_S)}
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
            <div className="flex items-center gap-3">
              <div
                role="progressbar"
                aria-label="Export progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress === null ? undefined : percent}
                aria-valuetext={progress === null ? 'Rendering…' : `${percent} %`}
                className="h-3 min-w-0 flex-1 overflow-hidden rounded-ds border border-border-strong bg-surface"
              >
                <div className={progress === null ? 'h-full w-1/3 bg-accent motion-safe:animate-pulse' : 'h-full bg-accent'} style={progress === null ? undefined : { width: `${percent}%` }} />
              </div>
              <span aria-hidden="true" className="w-28 shrink-0 text-right text-sm tabular-nums">
                {progress === null ? 'Starting' : `${percent} %`} · {clockText(elapsed)}
              </span>
            </div>
          ) : null}
          {/* Progress is announced at 25 % steps only. */}
          <StatusRegion visuallyHidden>{rendering && progress !== null ? `Exporting, ${Math.floor(percent / 25) * 25} %` : ''}</StatusRegion>
          {error ? (
            <p role="alert" className={errorText}>
              {error}
            </p>
          ) : null}
          <StatusRegion className="text-sm">{message}</StatusRegion>
          <div className="flex flex-wrap justify-end gap-2">
            {rendering ? (
              <Button ref={cancelRef} onClick={cancel}>Cancel</Button>
            ) : (
              <Button ref={closeRef} onClick={close}>Close</Button>
            )}
            <Button ref={exportRef} variant={ready ? 'secondary' : 'primary'} onClick={run} disabled={rendering || !frames.ok}>
              {rendering ? 'Exporting…' : 'Export WAV'}
            </Button>
            {ready ? (
              <Button ref={downloadRef} variant="primary" onClick={download}>
                Download ({sizeText(ready.blob.size)})
              </Button>
            ) : null}
          </div>
        </div>
      </Dialog>
    </>
  );
}
