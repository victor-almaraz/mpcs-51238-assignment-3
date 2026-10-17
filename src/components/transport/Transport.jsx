'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Button from '@/components/ui/Button';
import StatusRegion from '@/components/ui/StatusRegion';
import IconButton from '@/components/ui/IconButton';
import Toolbar from '@/components/ui/Toolbar';
import useCommands from '@/components/commands/useCommands';
import Meter from '@/components/ui/Meter';
import Slider from '@/components/ui/Slider';
import { faderText } from '@/components/mixer/TrackStrip';
import { cx, errorText } from '@/design-systems/industrial/classes';
import { MASTER_VOLUME } from '@/dsp/engine/engine';
import { getEngine } from '@/lib/audio/engine-client';
import { setTempo, setTimeSignature, ticksPerBar } from '@/lib/project/model';
import LoopToggle from './LoopToggle';
import MeterSelect from './MeterSelect';
import MetronomeToggle from './MetronomeToggle';
import Position from './Position';
import TempoField from './TempoField';

const SERVER_STATE = { status: 'idle', noticeOpen: false, playing: false, paused: false, metronome: false, ducked: false, error: null, masterVolumeDb: MASTER_VOLUME.default };
/** Space and Home keep their own meaning on these (TRN-02). */
const CONTROL_TARGETS = 'input, textarea, select, button, [contenteditable], [contenteditable="true"]';
/** Escape keeps its own meaning in text entry (SAFE-03: Panic outside text fields). */
const TEXT_TARGETS = 'input:not([type="range"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable], [contenteditable="true"]';

/** The loop range in ticks: the saved one, else the first four bars. */
export function loopRange(project, view) {
  if (view.loop) return view.loop;
  const { numerator, denominator } = project.meter[0];
  return { start: 0, end: 4 * ticksPerBar(numerator, denominator) };
}

/**
 * Transport toolbar (TRN-01, TRN-02): Go to start, Play/Pause, Stop, Loop,
 * Metronome, Position, Tempo and Time signature. Play/Pause is one button,
 * named for the action it performs: Pause holds the playhead and Play resumes
 * from it. Stop returns to where playback started; a Stop while stopped goes
 * to bar 1, or to the loop start with the loop on. Space plays and pauses
 * outside fields and buttons; Home locates to bar 1 and Shift+Home to the loop
 * start. Play passes through the volume notice. `showExampleHint` highlights
 * Play with "Press Play to hear this example" until the first playback.
 */
export default function Transport({ project, view, onViewChange, onEdit, readOnly, showExampleHint }) {
  const engine = getEngine();
  const state = useSyncExternalStore(engine.subscribe, engine.getState, () => SERVER_STATE);
  const [played, setPlayed] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [initialPlayhead] = useState(view.playhead);
  const loop = loopRange(project, view);
  // Stop has nothing to do when stopped at bar 1.
  const stopDisabled = !state.playing && !state.paused && view.playhead === 0;

  useEffect(() => {
    engine.setProject(project);
  }, [engine, project]);

  useEffect(() => {
    engine.locate(initialPlayhead);
  }, [engine, initialPlayhead]);

  useEffect(() => {
    engine.setLoop(view.loopEnabled, loop.start, loop.end);
  }, [engine, view.loopEnabled, loop.start, loop.end]);

  useEffect(() => () => engine.stop(), [engine]);

  function play() {
    engine.requestSound(() => {
      engine.play();
      setPlayed(true);
    });
  }

  function pause() {
    onViewChange({ playhead: engine.pause() });
  }

  /** Stop: back to the play start; when already stopped, to bar 1 or the loop start. */
  function stop() {
    const { playing, paused } = engine.getState();
    if (playing || paused) onViewChange({ playhead: engine.stop() });
    else locate(view.loopEnabled ? loop.start : 0);
  }

  const togglePlay = () => (engine.getState().playing ? pause() : play());

  /** Panic (SAFE-03): stops the transport and every sound; announces "All sound stopped". */
  function panic() {
    const wasRunning = engine.panic();
    onViewChange({ playhead: engine.positionTick() });
    // A repeated announcement needs a changed text to be read again.
    setAnnouncement((prev) => (prev === 'All sound stopped' ? 'All sound stopped.' : 'All sound stopped'));
    return wasRunning;
  }

  function locate(tick) {
    engine.locate(tick);
    if (!engine.getState().playing) onViewChange({ playhead: tick });
  }

  const keyHandler = useRef(null);
  useEffect(() => {
    keyHandler.current = (e) => {
      if (e.defaultPrevented || document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape') {
        if (e.target.closest?.(TEXT_TARGETS)) return;
        e.preventDefault();
        panic();
        return;
      }
      if (e.target.closest?.(CONTROL_TARGETS)) return;
      if (e.key === ' ' && !e.repeat) {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'Home') {
        e.preventDefault();
        locate(e.shiftKey ? loop.start : 0);
      }
    };
  });
  useEffect(() => {
    const onKeyDown = (e) => keyHandler.current?.(e);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useCommands([
    { id: 'transport.play', group: 'Transport', label: state.playing ? 'Pause' : 'Play', keys: 'Space', run: togglePlay },
    { id: 'transport.stop', group: 'Transport', label: 'Stop', run: stop, enabled: () => !stopDisabled },
    { id: 'transport.start', group: 'Transport', label: 'Go to start', keys: 'Home', run: () => locate(0) },
    { id: 'transport.loop-start', group: 'Transport', label: 'Go to loop start', keys: 'Shift+Home', run: () => locate(loop.start) },
    { id: 'transport.loop', group: 'Transport', label: view.loopEnabled ? 'Turn loop off' : 'Turn loop on', keys: 'L', global: true, run: () => onViewChange({ loopEnabled: !view.loopEnabled, loop }) },
    { id: 'transport.metronome', group: 'Transport', label: state.metronome ? 'Turn metronome off' : 'Turn metronome on', keys: 'K', global: true, run: () => engine.setMetronome(!engine.getState().metronome) },
    { id: 'transport.panic', group: 'Transport', label: 'Panic: stop all sound', keys: 'Escape', run: () => panic() },
  ]);

  const hint = showExampleHint && !played;
  const status = state.playing ? 'Playing' : state.paused ? 'Paused' : 'Stopped';
  const signature = `${project.meter[0].numerator}/${project.meter[0].denominator}`;

  const readMaster = () => {
    const level = engine.getMasterLevel();
    return [level.peakL, level.peakR];
  };

  return (
    <section aria-labelledby="studio-transport" className="flex flex-col border-b border-border-strong bg-surface-2">
      <h2 id="studio-transport" className="sr-only">
        Transport
      </h2>
      {/* TRN-01 order: locate, play/pause, stop, loop, metronome, position, tempo, meter, master volume and meter, Panic. */}
      <Toolbar label="Transport" className="flex items-center gap-2 overflow-x-auto px-3 py-1.5 [&>*]:shrink-0">
        <IconButton icon="skip-back" label="Go to start" shortcut="Home" onClick={() => locate(0)} data-help="Go to start (Home): moves the playhead to bar 1; Shift+Home goes to the loop start." />
        <IconButton
          icon={state.playing ? 'pause' : 'play'}
          label={state.playing ? 'Pause' : 'Play'}
          shortcut="Space"
          variant={hint ? 'primary' : 'secondary'}
          aria-describedby={hint ? 'transport-play-hint' : undefined}
          onClick={togglePlay}
          data-help={state.playing ? 'Pause (Space): holds the playhead where it is.' : 'Play (Space): plays from the playhead.'}
        />
        <IconButton
          icon="square"
          label="Stop"
          disabled={stopDisabled}
          onClick={stop}
          data-help="Stop: returns to where playback started; press again to go to bar 1, or to the loop start with the loop on."
        />
        <LoopToggle on={view.loopEnabled} onChange={(on) => onViewChange({ loopEnabled: on, loop })} />
        <MetronomeToggle on={state.metronome} onChange={(on) => engine.setMetronome(on)} />
        <Position />
        <TempoField bpm={project.tempo[0].bpm} disabled={readOnly} onCommit={(bpm) => onEdit(setTempo(project, bpm))} />
        <MeterSelect
          value={signature}
          disabled={readOnly}
          onChange={(value) => onEdit(setTimeSignature(project, value))}
        />
        {/* When the bar is short, the status line gives up width first, then the volume. */}
        <div className="flex w-80 min-w-56" style={{ flexShrink: 1 }}>
          <Slider
            id="transport-master-volume"
            label="Master volume"
            className="w-full"
            min={MASTER_VOLUME.min}
            max={MASTER_VOLUME.max}
            step={0.1}
            value={state.masterVolumeDb}
            valueText={faderText(state.masterVolumeDb)}
            onChange={(db) => engine.setMasterVolume(db)}
            onReset={() => engine.setMasterVolume(MASTER_VOLUME.default)}
            data-help="Master volume: the level of everything W-Rack plays, at most 0 dB."
          />
        </div>
        <Meter read={readMaster} className="h-8 w-4 shrink-0" />
        <Button variant="danger" onClick={panic} data-help="Panic (Escape): stops the transport and every sound at once.">
          Panic
        </Button>
        {/* The status line may shorten to its first word. */}
        <span className="min-w-[4.5rem] truncate text-sm whitespace-nowrap" style={{ flexShrink: 10 }}>
          {status}
          {hint ? (
            <>
              {' · '}
              <strong id="transport-play-hint">Press Play to hear this example</strong>
            </>
          ) : null}
        </span>
      </Toolbar>
      <StatusRegion visuallyHidden>{announcement}</StatusRegion>
      {state.ducked ? (
        <div role="alert" className={cx(errorText, 'px-3 pb-1.5')}>
          <span>The output was loud for a long time, so W-Rack lowered it by 6 dB.</span>{' '}
          <Button size="sm" onClick={() => engine.ackDuck()}>
            Restore the level
          </Button>
        </div>
      ) : null}
      {state.error ? (
        <p role="alert" className={cx(errorText, 'px-3 pb-1.5')}>
          {state.error}
        </p>
      ) : null}
    </section>
  );
}
