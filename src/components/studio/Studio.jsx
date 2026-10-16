'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import StatusRegion from '@/components/ui/StatusRegion';
import Toggle from '@/components/ui/Toggle';
import Transport, { loopRange } from '@/components/transport/Transport';
import InstrumentPanel from '@/components/instruments/InstrumentPanel';
import LiveInputControls from '@/components/input/LiveInputControls';
import PianoRollGrid from '@/components/pianoroll/PianoRollGrid';
import MasterStrip from '@/components/mixer/MasterStrip';
import TrackStrip from '@/components/mixer/TrackStrip';
import Timeline from '@/components/timeline/Timeline';
import EffectChain from '@/components/effects/EffectChain';
import OpenArchive from '@/components/archive/OpenArchive';
import SaveArchive from '@/components/archive/SaveArchive';
import ExportDialog from '@/components/export/ExportDialog';
import { effectFor } from '@/dsp/effects/registry';
import { setEffectBypass } from '@/lib/project/effect-commands';
import { sourceStatus } from '@/components/timeline/layout';
import { getSource } from '@/lib/audio/decode';
import { pruneStoredSources } from '@/lib/audio/source-cleanup';
import useProjectSources from './useProjectSources';
import { getEngine } from '@/lib/audio/engine-client';
import { engineTrackIds } from '@/lib/audio/param-changes';
import { METER_FIELDS } from '@/dsp/mixer/meter';
import { errorText, pageHeading, sectionHeading } from '@/design-systems/industrial/classes';
import { setDeviceParam, setTrack, ticksPerBar, trackLabel } from '@/lib/project/model';
import {
  PROJECT_NEWER,
  SAVE_DELAY_MS,
  archiveState,
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
  const stepInsertRef = useRef(null);
  const saveState = useSyncExternalStore(subscribeSaveState, getSaveState, getSaveState);
  const viewSaveState = useSyncExternalStore(subscribeViewSaveState, getViewSaveState, getViewSaveState);

  const projectRef = useRef(project);
  useEffect(() => {
    function handleBeforeUnload(e) {
      flushView();
      flushSaves();
      // Loaded audio missing from the last .wrack save would be lost with session-only storage.
      const unarchived = archiveState(projectRef.current, (id) => Boolean(getSource(id))).unarchived;
      if (hasUnsavedEdits() || unarchived.length > 0) e.preventDefault();
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const pruneTimer = useRef(0);
  useEffect(() => () => clearTimeout(pruneTimer.current), []);

  /**
   * Applies an edited document: it saves after 500 ms and reaches the engine
   * at once. Handlers build edits on projectRef.current, the newest document,
   * so several edits in one event all take effect. An edit that drops a source removes stored audio no saved
   * project uses, once the save has happened.
   */
  function edit(next) {
    if (readOnly) return;
    const prev = projectRef.current;
    const saved = commitEdit(next);
    projectRef.current = saved;
    setProject(saved);
    if (Object.keys(prev.sources).some((id) => !saved.sources[id])) {
      clearTimeout(pruneTimer.current);
      pruneTimer.current = setTimeout(() => {
        flushSaves();
        pruneStoredSources(Object.keys(projectRef.current.sources)).catch((err) => console.error('Stored audio cleanup failed', err));
      }, SAVE_DELAY_MS + 100);
    }
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
  const engine = getEngine();
  const { loading } = useProjectSources(project.id, initialProject.sources, engine.decodeRate());
  const anyMissing = audioClips.some((c) => sourceStatus(c.sourceId, getSource, loading) === 'Audio not loaded');
  const engineState = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
  const mixerTrackIds = engineTrackIds(project);
  const meterFor = (index) => () => {
    const m = engine.getMeters();
    return m ? [m[METER_FIELDS * index], m[METER_FIELDS * index + 1]] : null;
  };
  const panelTrackId = view.selectedTrackId ?? project.trackOrder.find((id) => project.tracks[id].kind === 'instrument');
  const panelTrack = panelTrackId ? project.tracks[panelTrackId] : null;
  const panelDevice = panelTrack?.kind === 'instrument' ? project.devices[panelTrack.deviceIds[0]] : null;
  const liveTargetIndex = Math.max(0, mixerTrackIds.indexOf(panelTrackId));
  const chainTrackId = view.selectedTrackId && project.tracks[view.selectedTrackId] ? view.selectedTrackId : panelTrackId;

  /** Applies fn(newest document) when it succeeds; returns its result (effect chains). */
  function command(fn) {
    const result = fn(projectRef.current);
    if (result.ok) edit(result.doc);
    return result;
  }
  const setParam = (deviceId, id, value) => edit(setDeviceParam(projectRef.current, deviceId, id, value));

  // An effect the engine reset after non-finite output is bypassed in the document too.
  // Faults are taken from the client once, so a later visit never replays them.
  const [faultNotices, setFaultNotices] = useState([]);
  useEffect(() => {
    if ((engineState.faults ?? []).length === 0) return;
    const notices = [];
    for (const f of engine.takeFaults()) {
      const doc = projectRef.current;
      const device = doc.devices[f.deviceId];
      if (!device) continue;
      const trackName = f.trackId === 'master' ? 'Master' : (doc.tracks[f.trackId]?.name ?? 'a track');
      notices.push(`Effect ${effectFor(device.type)?.label ?? device.type} on ${trackName} was reset and bypassed.`);
      if (!readOnly && !device.bypass) edit(setEffectBypass(doc, f.deviceId, true).doc);
    }
    if (notices.length > 0) setFaultNotices((prev) => [...prev, ...notices]);
  }, [engineState.faults]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    engine.setLiveTarget(liveTargetIndex);
  }, [engine, liveTargetIndex]);

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className={pageHeading}>{project.name}</h1>
        <p className="text-sm text-muted">
          {tempo} BPM · {meter.numerator}/{meter.denominator}
        </p>
        <StatusRegion className="text-sm">{saveStatusText(unsavedCopy, saveState)}</StatusRegion>
        {readOnly ? <p className={errorText}>{PROJECT_NEWER}</p> : null}
        {faultNotices.length > 0 ? (
          <ul role="alert" className={errorText}>
            {faultNotices.map((text, i) => (
              <li key={i}>
                <span aria-hidden="true">▲</span> {text}
              </li>
            ))}
          </ul>
        ) : null}
        {failure ? (
          <p role="alert" className={errorText}>
            <span aria-hidden="true">▲</span>
            <span>{failure.error}</span>
          </p>
        ) : null}
      </div>

      <div role="toolbar" aria-label="Project" className="flex flex-wrap items-start gap-4">
        <SaveArchive project={project} disabled={readOnly} />
        <ExportDialog project={project} loop={loopRange(project, view)} />
        {anyMissing ? <OpenArchive label="Open .wrack file to restore audio" currentId={project.id} /> : null}
      </div>

      <Transport
        project={project}
        view={view}
        onViewChange={changeView}
        onEdit={edit}
        readOnly={readOnly}
        showExampleHint={unsavedCopy}
      />

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
        {clips.length > 0 ? null : (
          <div className="flex flex-col gap-3">
            <p>Press a key or click the grid to add a note, or add an audio file in the timeline</p>
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

      <Timeline project={project} view={view} onViewChange={changeView} onEdit={edit} readOnly={readOnly} loading={loading} />

      {panelDevice ? (
        <PianoRollGrid
          key={panelTrackId}
          project={project}
          trackId={panelTrackId}
          view={view}
          onViewChange={changeView}
          onEdit={edit}
          readOnly={readOnly}
          stepInsertRef={stepInsertRef}
        />
      ) : null}

      {panelDevice ? (
        <InstrumentPanel
          project={project}
          track={panelTrack}
          device={panelDevice}
          onEdit={edit}
          loading={loading}
          disabled={readOnly}
          onParamChange={setParam}
        />
      ) : null}

      {chainTrackId ? (
        <EffectChain
          key={`chain-${chainTrackId}`}
          project={project}
          trackId={chainTrackId}
          title={`Effects: ${project.tracks[chainTrackId].name}`}
          onCommand={command}
          onParam={setParam}
          disabled={readOnly}
        />
      ) : null}


      <section aria-labelledby="studio-mixer" className="flex flex-col gap-2">
        <h2 id="studio-mixer" className={sectionHeading}>
          Mixer
        </h2>
        <div className="flex flex-wrap items-start gap-2">
          <ul aria-label="Track strips" className="flex flex-wrap gap-2">
            {mixerTrackIds.map((id, index) => (
              <TrackStrip
                key={id}
                track={project.tracks[id]}
                readMeter={meterFor(index)}
                disabled={readOnly}
                onChange={(changes) => edit(setTrack(projectRef.current, id, changes))}
              />
            ))}
          </ul>
          <MasterStrip
            volumeDb={engineState.masterVolumeDb}
            pan={project.tracks[project.masterTrackId].pan}
            disabled={readOnly}
            onVolume={(db) => engine.setMasterVolume(db)}
            onPan={(pan) => edit(setTrack(projectRef.current, project.masterTrackId, { pan }))}
          />
        </div>
      </section>

      <EffectChain project={project} trackId={project.masterTrackId} title="Master effects" onCommand={command} onParam={setParam} disabled={readOnly} />

      <LiveInputControls onNote={(pitch) => stepInsertRef.current?.(pitch)} />

      <section aria-labelledby="studio-view" className="flex flex-col gap-2">
        <h2 id="studio-view" className={sectionHeading}>
          View
        </h2>
        <p className="text-sm text-muted">Zoom, playhead, loop and the open panel return when this project opens again.</p>
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
        <p>Playhead: {barBeat(view.playhead, meter)} (where playback starts)</p>
        <p>
          Loop {view.loopEnabled ? 'on' : 'off'}
          {view.loop ? `: ${barRange(view.loop, meter)}` : null}
        </p>
        <p>Open panel: {view.openPanel ? PANEL_NAMES[view.openPanel] : panelDevice ? PANEL_NAMES.pianoroll : 'none'}</p>
      </section>
    </>
  );
}
