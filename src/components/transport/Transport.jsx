'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Button from '@/components/ui/Button';
import StatusRegion from '@/components/ui/StatusRegion';
import Toggle from '@/components/ui/Toggle';
import { errorText } from '@/design-systems/industrial/classes';
import { getEngine } from '@/lib/audio/engine-client';
import { setTempo, setTimeSignature, ticksPerBar } from '@/lib/project/model';
import LoopToggle from './LoopToggle';
import MeterSelect from './MeterSelect';
import MetronomeToggle from './MetronomeToggle';
import Position from './Position';
import TempoField from './TempoField';

const SERVER_STATE = { status: 'idle', noticeOpen: false, playing: false, metronome: false, ducked: false, error: null };
/** Space and Home keep their own meaning on these (TRN-02). */
const CONTROL_TARGETS = 'input, textarea, select, button, [contenteditable], [contenteditable="true"]';
/** Escape keeps its own meaning in text entry (SAFE-03: Panic outside text fields). */
const TEXT_TARGETS = 'input:not([type="range"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable], [contenteditable="true"]';

/** Default loop when none is stored: the first four bars. */
function loopRange(project, view) {
  if (view.loop) return view.loop;
  const { numerator, denominator } = project.meter[0];
  return { start: 0, end: 4 * ticksPerBar(numerator, denominator) };
}

/**
 * Transport toolbar (TRN-01, TRN-02): Go to start, Play, Loop, Metronome,
 * Position, Tempo and Time signature. Space plays and stops at the playhead
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

  function stop() {
    onViewChange({ playhead: engine.stop() });
  }

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
        if (engine.getState().playing) stop();
        else play();
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

  const hint = showExampleHint && !played;
  const signature = `${project.meter[0].numerator}/${project.meter[0].denominator}`;

  return (
    <section aria-labelledby="studio-transport" className="flex flex-col gap-2">
      <h2 id="studio-transport" className="sr-only">
        Transport
      </h2>
      <div role="toolbar" aria-label="Transport" className="flex flex-wrap items-center gap-2 rounded-ds border border-border-strong bg-surface p-2">
        <Button onClick={() => locate(0)}>Go to start</Button>
        <Toggle
          pressed={state.playing}
          highlighted={hint}
          aria-describedby={hint ? 'transport-play-hint' : undefined}
          onClick={state.playing ? stop : play}
        >
          Play
        </Toggle>
        <LoopToggle on={view.loopEnabled} onChange={(on) => onViewChange({ loopEnabled: on, loop })} />
        <MetronomeToggle on={state.metronome} onChange={(on) => engine.setMetronome(on)} />
        <Position />
        <TempoField bpm={project.tempo[0].bpm} disabled={readOnly} onCommit={(bpm) => onEdit(setTempo(project, bpm))} />
        <MeterSelect
          value={signature}
          disabled={readOnly}
          onChange={(value) => onEdit(setTimeSignature(project, value))}
        />
        <Button variant="danger" size="lg" onClick={panic} className="ml-auto">
          Panic
        </Button>
      </div>
      <StatusRegion visuallyHidden>{announcement}</StatusRegion>
      {state.ducked ? (
        <div role="alert" className={errorText}>
          <span>The output was loud for a long time, so W-Rack lowered it by 6 dB.</span>{' '}
          <Button size="sm" onClick={() => engine.ackDuck()}>
            Restore the level
          </Button>
        </div>
      ) : null}
      <p className="text-sm">{state.playing ? 'Playing' : 'Stopped'}</p>
      {hint ? (
        <p id="transport-play-hint" className="text-sm font-bold">
          Press Play to hear this example
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className={errorText}>
          {state.error}
        </p>
      ) : null}
    </section>
  );
}
