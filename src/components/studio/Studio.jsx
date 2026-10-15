'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import StatusRegion from '@/components/ui/StatusRegion';
import Toggle from '@/components/ui/Toggle';
import Transport from '@/components/transport/Transport';
import { errorText, pageHeading, sectionHeading } from '@/design-systems/industrial/classes';
import { ticksPerBar, trackLabel } from '@/lib/project/model';
import {
  PROJECT_NEWER,
  STORAGE_FULL,
  commitEdit,
  flushSaves,
  getSaveState,
  hasUnsavedEdits,
  subscribeSaveState,
} from '@/lib/project/store';
import {
  ZOOM_MAX,
  ZOOM_MIN,
  flushView,
  getViewSaveState,
  readView,
  saveView,
  stepZoom,
  subscribeViewSaveState,
} from '@/lib/project/view-state';
import { PPQ } from '@/dsp/core/constants';

const PANEL_NAMES = { pianoroll: 'Piano roll', clip: 'Clip view' };

/** "bar 2, beat 3" for a tick position in the project's first meter. */
function barBeat(tick, meter) {
  const bar = ticksPerBar(meter.numerator, meter.denominator);
  const beatTicks = (4 * PPQ) / meter.denominator;
  return `bar ${Math.floor(tick / bar) + 1}, beat ${Math.floor((tick % bar) / beatTicks) + 1}`;
}

/** "bar 1 to bar 3" for a loop range; the end bar is exclusive. */
function barRange({ start, end }, meter) {
  const bar = ticksPerBar(meter.numerator, meter.denominator);
  return `bar ${Math.floor(start / bar) + 1} to bar ${Math.ceil(end / bar) + 1}`;
}

/** Header save status (SAVE-01). */
function saveStatusText(unsavedCopy, state) {
  if (unsavedCopy && state.status === 'idle') return 'Copy of example — saved on first edit';
  if (state.status === 'pending') return 'Saving…';
  if (state.status === 'error') return state.error === STORAGE_FULL ? 'Not saved — storage full' : 'Not saved';
  return 'Saved on this device';
}

/**
 * Placeholder editor: project header with save status, restored working state,
 * track selection, zoom and the empty-project hints. Working-state changes save
 * to w-rack:v1:view:<id>; the transport always opens stopped.
 * `unsavedCopy` marks an example copy not edited yet; `readOnly` a project
 * saved by a newer build.
 */
export default function Studio({ project: initialProject, unsavedCopy, readOnly }) {
  const [project, setProject] = useState(initialProject);
  const [view, setView] = useState(() => readView(initialProject));
  const saveState = useSyncExternalStore(subscribeSaveState, getSaveState, getSaveState);
  const viewSaveState = useSyncExternalStore(subscribeViewSaveState, getViewSaveState, getViewSaveState);

  useEffect(() => {
    function handleBeforeUnload(e) {
      flushView();
      flushSaves();
      if (hasUnsavedEdits()) e.preventDefault();
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  /** Applies an edited document: it saves after 500 ms and reaches the engine at once. */
  function edit(next) {
    if (readOnly) return;
    setProject(commitEdit(next));
  }

  function changeView(changes) {
    const next = { ...view, ...changes };
    setView(next);
    saveView(project.id, next);
  }

  const meter = project.meter[0];
  const tempo = project.tempo[0].bpm;
  const clips = Object.values(project.clips);
  const audioClips = clips.filter((c) => c.kind === 'audio');
  const failure = [saveState, viewSaveState].find((s) => s.status === 'error');

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className={pageHeading}>{project.name}</h1>
        <p className="text-sm text-muted">
          {tempo} BPM · {meter.numerator}/{meter.denominator}
        </p>
        <StatusRegion className="text-sm">{saveStatusText(unsavedCopy, saveState)}</StatusRegion>
        {readOnly ? <p className={errorText}>{PROJECT_NEWER}</p> : null}
        {failure ? (
          <p role="alert" className={errorText}>
            <span aria-hidden="true">▲</span>
            <span>{failure.error}</span>
          </p>
        ) : null}
      </div>

      {audioClips.length > 0 ? (
        <div role="toolbar" aria-label="Project" className="flex flex-wrap gap-2">
          <Button disabled>Open .wrack file to restore audio</Button>
        </div>
      ) : null}

      <Transport
        project={project}
        view={view}
        onViewChange={changeView}
        onEdit={edit}
        readOnly={readOnly}
        showExampleHint={unsavedCopy}
      />

      <section aria-labelledby="studio-view" className="flex flex-col gap-2">
        <h2 id="studio-view" className={sectionHeading}>
          View
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => changeView({ zoom: stepZoom(view.zoom, -1) })} disabled={view.zoom <= ZOOM_MIN}>
            Zoom out
          </Button>
          <output aria-live="polite" className="min-w-24 text-center tabular-nums">
            Zoom {Math.round(view.zoom * 100)}%
          </output>
          <Button onClick={() => changeView({ zoom: stepZoom(view.zoom, 1) })} disabled={view.zoom >= ZOOM_MAX}>
            Zoom in
          </Button>
        </div>
        <p>Playhead: {barBeat(view.playhead, meter)}</p>
        <p>
          Loop {view.loopEnabled ? 'on' : 'off'}
          {view.loop ? `: ${barRange(view.loop, meter)}` : null}
        </p>
        <p>Open panel: {view.openPanel ? PANEL_NAMES[view.openPanel] : 'none'}</p>
      </section>

      <Card as="section" aria-labelledby="studio-tracks">
        <h2 id="studio-tracks" className={sectionHeading}>
          Tracks
        </h2>
        <ul className="flex flex-col gap-1">
          {project.trackOrder.map((id, i) => (
            <li key={id}>
              <Toggle
                pressed={view.selectedTrackId === id}
                onClick={() => changeView({ selectedTrackId: view.selectedTrackId === id ? null : id })}
                className="justify-start normal-case"
              >
                {trackLabel(project, id, i + 1)}
              </Toggle>
            </li>
          ))}
        </ul>
        {audioClips.length > 0 ? (
          <ul aria-label="Audio clips" className="flex flex-col gap-1">
            {audioClips.map((clip) => (
              <li key={clip.id}>
                Clip: {clip.name}. <strong>Audio not loaded</strong>
              </li>
            ))}
          </ul>
        ) : null}
        {clips.length > 0 ? null : (
          <div className="flex flex-col gap-3">
            <p>Press a key or click the grid to add a note</p>
            <div>
              <Button disabled>Add audio file</Button>
            </div>
            <section aria-labelledby="studio-keyboard-map" className="flex flex-col gap-1">
              <h3 id="studio-keyboard-map" className={sectionHeading}>
                Keyboard map
              </h3>
              <p className="text-sm">
                Keys A to K play the notes C to C. Z and X move the keyboard down or up an octave.
              </p>
            </section>
          </div>
        )}
      </Card>
    </>
  );
}
