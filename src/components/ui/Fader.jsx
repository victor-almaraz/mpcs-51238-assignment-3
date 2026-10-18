'use client';

import { useRef } from 'react';
import { cx } from '@/design-systems/industrial/classes';
import { taperFraction, taperValue } from './level-scale';
import { clamp } from '@/dsp/core/math';

/** dB marks on the scale, where they fall inside the range. */
const MARKS = [6, 0, -6, -12, -24, -60];

/**
 * Vertical channel fader (MIX-01): a dB scale beside a track and cap, on a
 * square taper so the upper range has most of the travel. A
 * visually hidden native range input (aria-orientation="vertical") carries
 * the role, name (`label`), value text and keys: arrows step, Page Up/Down
 * jump by `pageStep` (10 % of the range), Home/End go to the ends and Delete
 * resets. Pointer: vertical drag moves the cap (Shift for fine), a click on
 * the track jumps there, double-click resets. `children` render beside the
 * track: the peak meter, given the same `scale={[min, max]}` so its levels
 * meet the marks.
 */
export default function Fader({ id, label, value, min, max, step = 0.1, onChange, valueText, onReset, pageStep, disabled = false, className, children }) {
  const trackRef = useRef(null);
  const inputRef = useRef(null);
  const drag = useRef(null);
  const helpId = onReset ? `${id}-reset-help` : undefined;
  const snap = (v) => clamp(Number((min + Math.round((v - min) / step) * step).toFixed(10)), min, max);
  const set = (v) => {
    const next = snap(v);
    if (next !== value) onChange(next);
  };
  const fraction = (v) => taperFraction(v, min, max);
  const valueAt = (f) => taperValue(f, min, max);
  const valueAtY = (clientY) => {
    const r = trackRef.current.getBoundingClientRect();
    return valueAt(1 - (clientY - r.top) / r.height);
  };

  function onKeyDown(e) {
    if (disabled) return;
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      set(value + (e.key === 'PageUp' ? 1 : -1) * (pageStep ?? (max - min) / 10));
    } else if (e.key === 'Delete' && onReset) {
      e.preventDefault();
      onReset();
    }
  }

  return (
    <div className={cx('relative flex min-h-16 flex-1 items-stretch gap-1 py-2', disabled && 'opacity-40', className)}>
      <div aria-hidden="true" className="relative w-6 shrink-0 text-right font-mono text-[0.5625rem] text-muted">
        {MARKS.filter((m) => m >= min && m <= max).map((m) => (
          <span key={m} className="absolute right-0 -translate-y-1/2 leading-none" style={{ top: `${(1 - fraction(m)) * 100}%` }}>
            {m > 0 ? `+${m}` : m === min ? '−∞' : String(m).replace('-', '−')}
          </span>
        ))}
      </div>
      <div
        ref={trackRef}
        className={cx('relative w-7 shrink-0 touch-none select-none', disabled ? 'cursor-not-allowed' : 'cursor-ns-resize')}
        data-help={`${label}: drag the fader (Shift for fine), double-click to reset.`}
        onPointerDown={(e) => {
          if (disabled || e.button !== 0) return;
          e.preventDefault();
          inputRef.current?.focus();
          e.currentTarget.setPointerCapture(e.pointerId);
          const onCap = e.target.closest('[data-cap]');
          drag.current = { y0: e.clientY, f0: onCap ? fraction(value) : fraction(valueAtY(e.clientY)) };
          if (!onCap) set(valueAtY(e.clientY));
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const r = trackRef.current.getBoundingClientRect();
          set(valueAt(d.f0 + (d.y0 - e.clientY) / r.height / (e.shiftKey ? 10 : 1)));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onDoubleClick={() => !disabled && onReset?.()}
      >
        <input
          ref={inputRef}
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={label}
          aria-orientation="vertical"
          aria-valuetext={valueText}
          aria-describedby={helpId}
          onChange={(e) => onChange(Number(e.target.value))}
          onKeyDown={onKeyDown}
          className="peer sr-only"
        />
        <div className="absolute inset-y-1 left-1/2 w-1.5 -translate-x-1/2 rounded-full bg-window" />
        {MARKS.filter((m) => m >= min && m <= max).map((m) => (
          <div key={m} className="absolute inset-x-1 h-px bg-border" style={{ top: `${(1 - fraction(m)) * 100}%` }} />
        ))}
        <div
          data-cap
          className="absolute left-0 h-4 w-full -translate-y-1/2 rounded-ds border border-fg bg-surface shadow-[0_1px_0_rgb(0_0_0/0.25)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus"
          style={{ top: `${(1 - fraction(value)) * 100}%` }}
        >
          <div className="mx-1 mt-[7px] h-0.5 bg-fg" />
        </div>
      </div>
      {children}
      {onReset ? (
        <span id={helpId} className="sr-only">
          Press Delete or double-click to reset
        </span>
      ) : null}
    </div>
  );
}
