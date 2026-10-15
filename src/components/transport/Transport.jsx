'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Button from '@/components/ui/Button';
import Toggle from '@/components/ui/Toggle';
import { errorText } from '@/design-systems/industrial/classes';
import { getEngine } from '@/lib/audio/engine-client';
import { setTempo, setTimeSignature, ticksPerBar } from '@/lib/project/model';
import LoopToggle from './LoopToggle';
import MeterSelect from './MeterSelect';
import MetronomeToggle from './MetronomeToggle';
import Position from './Position';
import TempoField from './TempoField';

const SERVER_STATE = { status: 'idle', noticeOpen: false, playing: false, metronome: false, error: null };
const IGNORED_TARGETS = 'input, textarea, select, button, [contenteditable], [contenteditable="true"]';

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

  function locate(tick) {
    engine.locate(tick);
    if (!engine.getState().playing) onViewChange({ playhead: tick });
  }

  const keyHandler = useRef(null);
  useEffect(() => {
    keyHandler.current = (e) => {
      if (e.defaultPrevented || e.target.closest?.(IGNORED_TARGETS) || document.querySelector('dialog[open]')) return;
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
      </div>
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
