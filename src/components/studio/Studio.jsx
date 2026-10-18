'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Transport, { loopRange } from '@/components/transport/Transport';
import InstrumentPanel from '@/components/instruments/InstrumentPanel';
import LiveInputControls from '@/components/input/LiveInputControls';
import PianoRollGrid from '@/components/pianoroll/PianoRollGrid';
import MasterStrip from '@/components/mixer/MasterStrip';
import TrackStrip from '@/components/mixer/TrackStrip';
import Timeline from '@/components/timeline/Timeline';
import ClipProperties from '@/components/timeline/ClipProperties';
import RadioGroup from '@/components/ui/RadioGroup';
import Dock, { DOCK_MIN } from './Dock';
import EditorHeader from './EditorHeader';
import InfoStrip from './InfoStrip';
import EffectChain from '@/components/effects/EffectChain';
import OpenArchive from '@/components/archive/OpenArchive';
import useCommands from '@/components/commands/useCommands';
import SaveArchive from '@/components/archive/SaveArchive';
import ExportDialog from '@/components/export/ExportDialog';
import MenuButton from '@/components/ui/MenuButton';
import { commandEnabled, runCommand } from '@/lib/commands/registry';
import { effectFor } from '@/dsp/effects/registry';
import { setEffectBypass } from '@/lib/project/effect-commands';
import { sourceStatus } from '@/components/timeline/layout';
import { getSource } from '@/lib/audio/decode';
import { pruneStoredSources } from '@/lib/audio/source-cleanup';
import useProjectSources from './useProjectSources';
import { getEngine } from '@/lib/audio/engine-client';
import { engineTrackIds } from '@/lib/audio/param-changes';
import ProjectContext from '@/components/presets/ProjectContext';
import { METER_FIELDS } from '@/dsp/mixer/meter';
import { errorText } from '@/design-systems/industrial/classes';
import { setDeviceParam, setTrack } from '@/lib/project/model';
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

/** Header save status (SAVE-01). */
function saveStatusText(unsavedCopy, state) {
  if (unsavedCopy && state.status === 'idle') return 'Copy of example — saved on first edit';
  if (state.status === 'pending') return 'Saving…';
  if (state.status === 'error') return state.error === STORAGE_FULL ? 'Not saved — storage full' : 'Not saved';
  return 'Saved on this device';
}

/**
 * The editor workspace, one screen tall: the header (name, save status, file
 * actions), the transport, banners, the arrangement (track headers and the
 * timeline), the dock (Editor, Devices and Mixer tabs) and the info strip.
 * Working-state changes save to w-rack:v1:view:<id>; the transport always
 * opens stopped.
 * `unsavedCopy` marks an example copy not edited yet; `readOnly` a project
 * saved by a newer build.
 */
/** Undo history: steps kept, and the gap in ms within which edits join one step. */
const UNDO_LIMIT = 200;
const UNDO_GROUP_MS = 600;
/** Milliseconds for grouping edits (read in event handlers only). */
const clock = () => performance.now();

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
      // Session-only audio (not stored on this device) missing from the last .wrack save would be lost.
      const sessionOnly = (id) => {
        const source = getSource(id);
        return Boolean(source) && source.stored !== 'device';
      };
      const unarchived = archiveState(projectRef.current, sessionOnly).unarchived;
      if (hasUnsavedEdits() || unarchived.length > 0) e.preventDefault();
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // The tab names the project.
  useEffect(() => {
    document.title = `${project.name} · W-Rack`;
  }, [project.name]);

  const pruneTimer = useRef(0);
  useEffect(() => () => clearTimeout(pruneTimer.current), []);

  /**
   * Applies an edited document: it saves after 500 ms and reaches the engine
   * at once. Handlers build edits on projectRef.current, the newest document,
   * so several edits in one event all take effect. An edit that drops a source removes stored audio no saved
   * project uses, once the save has happened.
   */
  /*
   * Undo and redo (project-model.md, Commands and undo): documents are immutable, so the
   * history keeps whole documents. Edits within UNDO_GROUP_MS of the last one join its step,
   * so a knob or fader drag undoes as one.
   */
  const history = useRef({ past: [], future: [], last: 0 });

  function edit(next, fromHistory = false) {
    if (readOnly) return;
    const prev = projectRef.current;
    if (!fromHistory && next !== prev) {
      const h = history.current;
      const now = clock();
      if (now - h.last > UNDO_GROUP_MS || h.past.length === 0) h.past = [...h.past.slice(-(UNDO_LIMIT - 1)), prev];
      h.future = [];
      h.last = now;
    }
    const saved = commitEdit(next);
    projectRef.current = saved;
    setProject(saved);
    if (Object.keys(prev.sources).some((id) => !saved.sources[id])) {
      clearTimeout(pruneTimer.current);
      pruneTimer.current = setTimeout(() => {
        flushSaves();
        // Audio that an undo step could bring back stays stored.
        const kept = new Set([projectRef.current, ...history.current.past, ...history.current.future].flatMap((d) => Object.keys(d.sources)));
        pruneStoredSources([...kept]).catch((err) => console.error('Stored audio cleanup failed', err));
      }, SAVE_DELAY_MS + 100);
    }
  }

  // Several view changes in one event (clear the selection, move the cursor) build on each other.
  const viewRef = useRef(view);
  function changeView(changes) {
    const next = { ...viewRef.current, ...changes };
    viewRef.current = next;
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

  /** "File" menu items: the registered save, open and export commands. */
  const fileItems = () =>
    [
      ['project.save-wrack', 'Save .wrack file', 'Mod+S', 'save'],
      ['project.open-wrack', 'Open .wrack file…', 'Mod+O', 'folder-open'],
      ['project.export', 'Export WAV…', 'Mod+Shift+E', 'download'],
    ].map(([id, label, keys, icon]) => ({ label, keys, icon, disabled: !commandEnabled(id), run: () => runCommand(id) }));

  /** Opens dock tab `dock`, expanded, and focuses the first match of `selector` once it renders. */
  const goTo = (dock, selector) => {
    changeView({ dock, dockCollapsed: false });
    setTimeout(() => document.querySelector(selector)?.focus(), 50);
  };
  function undo() {
    const h = history.current;
    if (h.past.length === 0) return;
    h.future = [projectRef.current, ...h.future];
    h.last = 0;
    edit(h.past[h.past.length - 1], true);
    h.past = h.past.slice(0, -1);
  }

  function redo() {
    const h = history.current;
    if (h.future.length === 0) return;
    h.past = [...h.past, projectRef.current];
    h.last = 0;
    edit(h.future[0], true);
    h.future = h.future.slice(1);
  }

  useCommands([
    { id: 'edit.undo', group: 'Edit', label: 'Undo', keys: 'Mod+Z', global: true, inFields: false, run: undo, enabled: () => !readOnly && history.current.past.length > 0 },
    { id: 'edit.redo', group: 'Edit', label: 'Redo', keys: 'Mod+Shift+Z', altKeys: ['Mod+Y'], global: true, inFields: false, run: redo, enabled: () => !readOnly && history.current.future.length > 0 },
  ]);

  useCommands([
    { id: 'view.zoom-in', group: 'View', label: 'Zoom in', keys: 'Alt+=', run: () => changeView({ zoom: stepZoom(view.zoom, 1) }), enabled: () => view.zoom < ZOOM_MAX },
    { id: 'view.zoom-out', group: 'View', label: 'Zoom out', keys: 'Alt+-', run: () => changeView({ zoom: stepZoom(view.zoom, -1) }), enabled: () => view.zoom > ZOOM_MIN },
    { id: 'go.pianoroll', group: 'Go to', label: 'Piano roll', run: () => goTo('editor', '[role="grid"][aria-label="Notes"] [tabindex="0"]'), enabled: () => Boolean(panelDevice) },
    { id: 'go.mixer', group: 'Go to', label: 'Mixer', run: () => goTo('mixer', '[aria-label="Track strips"] input, [aria-label="Track strips"] button') },
    { id: 'go.effects', group: 'Go to', label: 'Track effects', run: () => goTo('devices', 'section[aria-labelledby^="chain-"] select, section[aria-labelledby^="chain-"] button') },
    { id: 'view.dock', group: 'View', label: view.dockCollapsed ? 'Expand the panels' : 'Collapse the panels', run: () => changeView({ dockCollapsed: !view.dockCollapsed }) },
  ]);

  // Alt+= and Alt+- zoom (ARR-06); Ctrl/Cmd with +/- stays with the browser. e.code, since Alt changes e.key on macOS.
  const zoomKeys = useRef(null);
  useEffect(() => {
    zoomKeys.current = (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.target.closest?.('input:not([type="range"]), textarea, select')) return;
      if (e.code === 'Equal' && view.zoom < ZOOM_MAX) changeView({ zoom: stepZoom(view.zoom, 1) });
      else if (e.code === 'Minus' && view.zoom > ZOOM_MIN) changeView({ zoom: stepZoom(view.zoom, -1) });
      else return;
      e.preventDefault();
    };
  });
  useEffect(() => {
    const onKeyDown = (e) => zoomKeys.current?.(e);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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

  // Live input (keyboard and MIDI) plays on the armed instrument tracks, else on the track being edited.
  const armedIds = view.armedTrackIds.filter((id) => project.tracks[id]?.kind === 'instrument');
  const armedIndices = armedIds.map((id) => mixerTrackIds.indexOf(id)).filter((i) => i >= 0);
  const armedKey = armedIndices.join(',');
  useEffect(() => {
    engine.setArmedTargets(armedKey ? armedKey.split(',').map(Number) : []);
  }, [engine, armedKey]);
  const inputTo = armedIds.length > 0 ? armedIds.map((id) => project.tracks[id].name).join(', ') : panelTrack ? `${panelTrack.name} (selected)` : null;

  // Lower dock: the active tab is part of the working state; its height follows the window.
  const rootRef = useRef(null);
  const [dockHeight, setDockHeight] = useState(360);
  const [maxDock, setMaxDock] = useState(600);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    let sized = false;
    const observer = new ResizeObserver(() => {
      // The arrangement keeps room for about three tracks; the dock opens at 42 % of the workspace.
      const max = Math.max(DOCK_MIN, el.clientHeight - 340);
      setMaxDock(max);
      if (!sized) setDockHeight(Math.min(max, Math.max(DOCK_MIN, Math.round(el.clientHeight * 0.42))));
      else setDockHeight((h) => Math.min(h, max));
      sized = true;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const [chainView, setChainView] = useState('track');
  // Another track opens on its own chain, scrolled to the top.
  const [chainFor, setChainFor] = useState(view.selectedTrackId);
  if (chainFor !== view.selectedTrackId) {
    setChainFor(view.selectedTrackId);
    setChainView('track');
  }
  useEffect(() => {
    document.getElementById('dock-panel-devices')?.scrollTo(0, 0);
  }, [view.selectedTrackId]);

  // The Editor tab follows the selected track: a selected clip on another track does not hold it.
  const lastClip = project.clips[view.selectedClipIds[view.selectedClipIds.length - 1]] ?? null;
  const selectedClip = lastClip && (!view.selectedTrackId || lastClip.trackId === view.selectedTrackId) ? lastClip : null;
  const statusFor = (clip) => sourceStatus(clip.sourceId, getSource, loading);
  const missing = audioClips.filter((c) => statusFor(c) === 'Audio not loaded');

  /** Opens the Editor tab and focuses one of its fields once it renders. */
  function openProperties(field) {
    changeView({ dock: 'editor', dockCollapsed: false });
    setTimeout(() => {
      const id = view.selectedClipIds[view.selectedClipIds.length - 1];
      document.getElementById(field === 'name' && id ? `clip-${id}-name` : 'dock-tab-editor')?.focus();
    }, 50);
  }

  let editorPanel;
  if (selectedClip?.kind === 'audio') {
    editorPanel = (
      <ClipProperties
        key={selectedClip.id}
        project={project}
        clip={selectedClip}
        status={statusFor(selectedClip)}
        editCursor={view.playhead}
        onEdit={edit}
        readOnly={readOnly}
      />
    );
  } else if (panelDevice) {
    editorPanel = (
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
    );
  } else {
    editorPanel = <p className="text-sm">Select an instrument track to open its piano roll, or an audio clip to edit its fades, gain and envelope.</p>;
  }

  const chainTrack = chainTrackId ? project.tracks[chainTrackId] : null;
  const devicesPanel = (
    <div className="flex min-h-0 flex-col gap-2">
      <RadioGroup
        legend="Chain"
        options={[
          { value: 'track', label: chainTrack ? `${chainTrack.name}` : 'Track' },
          { value: 'master', label: 'Master' },
        ]}
        value={chainView}
        onChange={setChainView}
        disabled={!chainTrack}
        className="max-w-md"
      />
      {chainView === 'master' || !chainTrack ? (
        <div className="flex items-start gap-3">
          <div className="w-fit shrink-0">
            <EffectChain project={project} trackId={project.masterTrackId} title="Master effects" onCommand={command} onParam={setParam} disabled={readOnly} />
          </div>
        </div>
      ) : (
        // DEV-01: the instrument, then its effects, left to right; each card is as wide as its controls and the panel scrolls sideways.
        <div className="flex items-start gap-3">
          {panelDevice && chainTrackId === panelTrackId ? (
            <div className="w-fit max-w-full shrink-0">
              <InstrumentPanel
                project={project}
                track={panelTrack}
                device={panelDevice}
                onEdit={edit}
                loading={loading}
                disabled={readOnly}
                onParamChange={setParam}
              />
            </div>
          ) : null}
          <div className="w-fit shrink-0">
            <EffectChain
              key={`chain-${chainTrackId}`}
              project={project}
              trackId={chainTrackId}
              title={`Effects: ${chainTrack.name}`}
              onCommand={command}
              onParam={setParam}
              disabled={readOnly}
            />
          </div>
        </div>
      )}
    </div>
  );

  const mixerPanel = (
    <section aria-labelledby="studio-mixer" className="flex min-h-[18rem] flex-1 flex-col">
      <h2 id="studio-mixer" className="sr-only">
        Mixer
      </h2>
      {/* Vertical strips side by side; the master stays at the right. */}
      <div className="flex min-h-0 flex-1 items-stretch gap-2">
        <ul aria-label="Track strips" className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
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
  );

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
      <EditorHeader
        name={project.name}
        tempo={tempo}
        meter={meter}
        saveStatus={saveStatusText(unsavedCopy, saveState)}
        readOnly={readOnly}
        onRename={(name) => edit({ ...projectRef.current, name })}
        actions={
          <>
            <MenuButton label="File" icon="file" items={fileItems} help="File: save or open a .wrack file, or export WAV." />
            <SaveArchive project={project} disabled={readOnly} trigger={false} />
            <OpenArchive inline trigger={false} currentId={project.id} />
            <ExportDialog project={project} loop={loopRange(project, view)} trigger={false} />
          </>
        }
      />

      <Transport project={project} view={view} onViewChange={changeView} onEdit={edit} readOnly={readOnly} showExampleHint={unsavedCopy} />

      {readOnly || faultNotices.length > 0 || failure || missing.length > 0 ? (
        <div className="flex shrink-0 flex-col gap-1 border-b border-border-strong bg-warning-bg px-3 py-1.5 text-sm">
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
          {missing.length > 0 ? (
            <section aria-label="Missing audio" className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p>
                <strong>Audio not loaded</strong> for {missing.map((c) => c.name).join(', ')}.
              </p>
              <OpenArchive label="Open .wrack file to restore audio" size="sm" inline command={false} currentId={project.id} />
            </section>
          ) : null}
        </div>
      ) : null}

      <Timeline project={project} view={view} onViewChange={changeView} onEdit={edit} readOnly={readOnly} loading={loading} onOpenProperties={openProperties} />

      <Dock
        tab={view.dock}
        onTab={(t) => changeView({ dock: t })}
        collapsed={view.dockCollapsed}
        onCollapse={(c) => changeView({ dockCollapsed: c })}
        height={dockHeight} maxHeight={maxDock} onHeight={setDockHeight}>
        <ProjectContext value={project}>{view.dock === 'editor' ? editorPanel : view.dock === 'devices' ? devicesPanel : mixerPanel}</ProjectContext>
      </Dock>

      <InfoStrip rootRef={rootRef}>
        <LiveInputControls inputTo={inputTo} onNote={(pitch) => stepInsertRef.current?.(pitch)} />
      </InfoStrip>
    </div>
  );
}
