'use client';

import { useEffect, useRef, useState } from 'react';
import Slider from '@/components/ui/Slider';
import { cx, focusRing } from '@/design-systems/industrial/classes';
import { LOOP_FORWARD, LOOP_OFF, MAX_CROSSFADE_MS } from '@/dsp/instruments/sampler-zones';
import { levelFor, peaksFor } from '@/lib/audio/peaks-client';
import { MARKERS, loopMarkersFor, markerFrames, markerRange, markerText, nearestZeroCrossing } from './markers';
import IconToggle from '@/components/ui/IconToggle';

const WAVE_H = 96;

function cssVar(name, fallback) {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** The source waveform with the region, loop and marker lines; hidden from assistive technology. */
function Waveform({ source, markers, loopOn, crossfade }) {
  const ref = useRef(null);
  const [, setTick] = useState(0);
  const levels = peaksFor(source);
  useEffect(() => {
    if (levels) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), 100);
    return () => clearInterval(id);
  }, [levels]);
  useEffect(() => {
    const canvas = ref.current;
    const w = canvas.clientWidth || 600;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(WAVE_H * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = cssVar('--ds-window', '#191c16');
    ctx.fillRect(0, 0, w, WAVE_H);
    const x = (frame) => (frame / source.frames) * w;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x(markers.start), 0, x(markers.end) - x(markers.start), WAVE_H);
    if (loopOn) {
      ctx.fillStyle = 'rgba(249,173,38,0.18)';
      ctx.fillRect(x(markers.loopStart), 0, x(markers.loopEnd) - x(markers.loopStart), WAVE_H);
      if (crossfade > 0) {
        ctx.fillStyle = 'rgba(249,173,38,0.35)';
        ctx.fillRect(x(markers.loopEnd - crossfade), WAVE_H - 12, x(markers.loopEnd) - x(markers.loopEnd - crossfade), 12);
      }
    }
    if (levels) {
      const level = levelFor(levels, source.frames / w);
      ctx.fillStyle = cssVar('--ds-level-low', '#68d36f');
      for (let px = 0; px < w; px++) {
        const a = Math.floor(((px / w) * source.frames) / level.bucket);
        const b = Math.max(a + 1, Math.floor((((px + 1) / w) * source.frames) / level.bucket));
        let lo = 0;
        let hi = 0;
        for (let i = a; i < b && i < level.min.length; i++) {
          if (level.min[i] < lo) lo = level.min[i];
          if (level.max[i] > hi) hi = level.max[i];
        }
        ctx.fillRect(px, WAVE_H / 2 - (hi * WAVE_H) / 2, 1, Math.max(1, ((hi - lo) * WAVE_H) / 2));
      }
    }
    ctx.fillStyle = cssVar('--ds-lamp', '#f9ad26');
    ctx.font = '10px ui-monospace, monospace';
    for (const { id, label } of MARKERS) {
      if (!loopOn && (id === 'loopStart' || id === 'loopEnd')) continue;
      // The line stays on the canvas at the last frame; its label sits right of it, or left where it would run off.
      const lx = Math.min(w - 1, x(markers[id]));
      const tw = ctx.measureText(label).width;
      ctx.fillRect(lx, 0, 1, WAVE_H);
      ctx.fillText(label, lx + 4 + tw <= w ? lx + 3 : lx - 3 - tw, id.startsWith('loop') ? WAVE_H - 4 : 11);
    }
  });
  return <canvas ref={ref} aria-hidden="true" className="block w-full rounded-ds" style={{ height: WAVE_H }} />;
}

/**
 * A marker position in seconds: typing edits a draft, Enter or leaving the
 * field commits it, and the field stays mounted so focus stays put.
 */
function SecondsInput({ label, frame, rate, max, disabled, onCommit }) {
  const [draft, setDraft] = useState(null);
  function commit() {
    if (draft === null) return;
    const seconds = Number(draft);
    setDraft(null);
    if (draft.trim() !== '' && Number.isFinite(seconds)) onCommit(Math.round(seconds * rate));
  }
  return (
    <input
      type="number"
      aria-label={label}
      min={0}
      max={max.toFixed(3)}
      step={0.001}
      value={draft ?? (frame / rate).toFixed(3)}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
      className={cx(
        'min-h-8 w-28 rounded-ds border border-border-strong bg-surface px-2 text-sm tabular-nums enabled:hover:border-fg',
        'disabled:cursor-not-allowed disabled:opacity-40',
        focusRing,
      )}
    />
  );
}

/**
 * Sample editor (DEV-03): the waveform with Start, Loop start, Loop end and
 * End as sliders over source frames, and the loop crossfade (forward loops)
 * limited to half the loop and the region before it. Left/Right move 1 ms, Shift+Left/Right 1
 * frame, Page Up/Down 100 ms, Home/End to the nearest constraint, Z to the
 * nearest zero crossing within 2048 frames; "Snap to zero crossings" applies Z
 * after every move. A table repeats the markers as numeric fields in seconds.
 * Constraints hold; a blocked move is announced through `announce`. `onMarkers(changes)` receives fractions for the device params.
 */
export default function SampleEditor({ deviceId, source, params, loopMode, onMarkers, onCrossfade, announce, disabled }) {
  const [snapZero, setSnapZero] = useState(false);
  const frames = source.frames;
  const rate = source.rate;
  const m = markerFrames(params, frames);
  const loopOn = loopMode !== LOOP_OFF;
  const shown = loopOn ? loopMarkersFor(m) : m;
  const ms = Math.max(1, Math.round(rate / 1000));
  // The crossfade fits inside the loop's first half and the region before it.
  const maxCrossfadeMs = Math.max(0, Math.min(MAX_CROSSFADE_MS, ((shown.loopEnd - shown.loopStart) / 2 / rate) * 1000, ((shown.loopStart - shown.start) / rate) * 1000));
  const crossfadeMs = Math.min(params.loopCrossfade, maxCrossfadeMs);
  const crossfadeFrames = loopMode === LOOP_FORWARD ? Math.round((crossfadeMs / 1000) * rate) : 0;

  function setMarker(id, wanted, zero = snapZero) {
    const [lo, hi] = markerRange(id, shown, frames, loopMode);
    let frame = zero ? nearestZeroCrossing(source.channels[0], wanted) : wanted;
    const label = MARKERS.find((k) => k.id === id).label;
    if (frame < lo || frame > hi) {
      announce(`${label} cannot move past ${frame < lo ? 'the marker before it' : 'the marker after it'}`);
      frame = frame < lo ? lo : hi;
    }
    if (frame === shown[id]) return;
    onMarkers({ [id]: frame / frames });
  }

  function onKeyDown(id, e) {
    const at = shown[id];
    const [lo, hi] = markerRange(id, shown, frames, loopMode);
    let next = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = at - (e.shiftKey ? 1 : ms);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = at + (e.shiftKey ? 1 : ms);
    else if (e.key === 'PageDown') next = at - 100 * ms;
    else if (e.key === 'PageUp') next = at + 100 * ms;
    else if (e.key === 'Home') next = lo;
    else if (e.key === 'End') next = hi;
    else if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      setMarker(id, at, true);
      return;
    }
    if (next === null) return;
    e.preventDefault();
    setMarker(id, next);
  }

  return (
    <div className="flex flex-col gap-2">
      <Waveform source={source} markers={shown} loopOn={loopOn} crossfade={crossfadeFrames} />
      <div className="grid gap-2 md:grid-cols-2">
        {MARKERS.map(({ id, label }) => {
          const off = !loopOn && (id === 'loopStart' || id === 'loopEnd');
          return (
            <Slider
              key={id}
              id={`sampler-${deviceId}-${id}`}
              label={label}
              min={0}
              max={frames}
              step={1}
              value={shown[id]}
              valueText={markerText(shown[id], rate)}
              display={`${(shown[id] / rate).toFixed(3)} s`}
              disabled={disabled || off}
              onKeyDown={(e) => onKeyDown(id, e)}
              onChange={(frame) => setMarker(id, frame)}
            />
          );
        })}
      </div>
      <Slider
        id={`sampler-${deviceId}-crossfade`}
        label="Loop crossfade"
        min={0}
        max={Math.max(1, Math.floor(maxCrossfadeMs))}
        step={1}
        value={Math.round(crossfadeMs)}
        valueText={`${Math.round(crossfadeMs)} ms, ${crossfadeFrames} frames`}
        display={`${Math.round(crossfadeMs)} ms`}
        disabled={disabled || loopMode !== LOOP_FORWARD}
        onChange={(v) => onCrossfade(Math.min(v, maxCrossfadeMs))}
      />
      <table className="text-sm">
        <caption className="text-left font-bold">Markers in seconds</caption>
        <thead>
          <tr>
            <th scope="col" className="pr-3 text-left">
              Marker
            </th>
            <th scope="col" className="text-left">
              Seconds
            </th>
          </tr>
        </thead>
        <tbody>
          {MARKERS.map(({ id, label }) => {
            const off = !loopOn && (id === 'loopStart' || id === 'loopEnd');
            return (
              <tr key={id}>
                <th scope="row" className="pr-3 text-left font-normal">
                  {label}
                </th>
                <td>
                  <SecondsInput
                    label={`${label} in seconds`}
                    frame={shown[id]}
                    rate={rate}
                    max={frames / rate}
                    disabled={disabled || off}
                    onCommit={(frame) => setMarker(id, frame)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div>
        <IconToggle icon="magnet" label="Snap to zero crossings" pressed={snapZero} disabled={disabled} onClick={() => setSnapZero(!snapZero)} />
      </div>
    </div>
  );
}
