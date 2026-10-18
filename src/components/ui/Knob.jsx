'use client';

import { useRef, useState } from 'react';
import { cx, focusRing, valueReadout } from '@/design-systems/industrial/classes';
import { clamp } from '@/dsp/core/math';

/** Arc sweep, degrees either side of straight up. */
const SWEEP = 135;
/** Vertical drag distance for the whole range, px; Shift divides the speed by 10. */
const DRAG_PX = 160;
const R = 18;

/** Point on the knob circle at `deg` from straight up, clockwise. */
function at(deg, r = R) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [24 + r * Math.cos(a), 24 + r * Math.sin(a)];
}

/** SVG arc path from `a0` to `a1` degrees. */
function arc(a0, a1) {
  const [x0, y0] = at(a0);
  const [x1, y1] = at(a1);
  return `M ${x0} ${y0} A ${R} ${R} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${x1} ${y1}`;
}

/**
 * Rotary knob (DEV-02): caption above, value with units below, an SVG arc in
 * between. A visually hidden native range input carries the role, name
 * (`label`), value text and keys: arrows step, Page Up/Down jump by `pageStep`
 * (10 % of the range), Home/End go to the ends, Delete resets and Enter opens
 * the value field. Pointer: vertical drag changes the value (Shift for fine),
 * double-click resets, and a click on the value opens a text field whose
 * entry `parse(text)` turns into an input value (null rejects it); with
 * `onTyped(text)` the entry goes there instead, for values between input
 * steps. In the field Enter or leaving it commits once and Escape cancels.
 * Bipolar ranges fill from the centre. `caption` is the visible label
 * (default `label`); it wraps to `captionLines` lines (1 or 2), always
 * reserved, so knobs in a row line up.
 */
export default function Knob({ id, label, caption, captionLines = 2, value, min, max, step = 1, onChange, valueText, display, onReset, pageStep, parse, onTyped, disabled = false, className }) {
  if (process.env.NODE_ENV !== 'production' && !valueText) {
    throw new Error(`Knob "${label}" requires a valueText prop with units.`);
  }
  const [editing, setEditing] = useState(null); // draft text while the value field is open
  const helpId = onReset ? `${id}-reset-help` : undefined;
  const drag = useRef(null);
  const inputRef = useRef(null);
  const fieldOpen = useRef(false); // the first of Enter, Escape and blur closes the field
  const typeable = Boolean(parse || onTyped);
  const snap = (v) => clamp(Number((step > 0 ? min + Math.round((v - min) / step) * step : v).toFixed(10)), min, max);
  const set = (v) => {
    const next = snap(v);
    if (next !== value) onChange(next);
  };

  const f = max > min ? (value - min) / (max - min) : 0;
  const angle = -SWEEP + f * 2 * SWEEP;
  const origin = min < 0 && max > 0 ? -SWEEP + ((0 - min) / (max - min)) * 2 * SWEEP : -SWEEP;
  const [px, py] = at(angle, R - 6);

  function onKeyDown(e) {
    if (disabled) return;
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      const jump = pageStep ?? (max - min) / 10;
      set(value + (e.key === 'PageUp' ? jump : -jump));
    } else if (e.key === 'Delete' && onReset) {
      e.preventDefault();
      onReset();
    } else if (e.key === 'Enter' && typeable) {
      e.preventDefault();
      openField();
    }
  }

  function openField() {
    fieldOpen.current = true;
    setEditing(display ?? valueText);
  }

  /** Closes the value field, applying `text` unless it is null; `refocus` returns focus to the knob. */
  function closeField(text, refocus) {
    if (!fieldOpen.current) return;
    fieldOpen.current = false;
    setEditing(null);
    if (text !== null) {
      if (onTyped) onTyped(text);
      else {
        const parsed = parse(text);
        if (parsed !== null && parsed !== undefined && Number.isFinite(parsed)) onChange(clamp(parsed, min, max));
      }
    }
    // Focusing the knob blurs the field, whose onBlur then finds it closed.
    if (refocus) inputRef.current?.focus();
  }

  return (
    <div className={cx('relative flex w-20 flex-col items-center gap-0.5', disabled && 'opacity-40', className)}>
      <div className={cx('flex w-full items-end justify-center text-xs leading-tight text-muted', captionLines > 1 ? 'h-[2lh]' : 'h-[1lh]')}>
        <label htmlFor={id} className={cx('min-w-0 max-w-full text-center break-words', captionLines > 1 ? 'line-clamp-2' : 'truncate')}>
          {caption ?? label}
        </label>
      </div>
      <div
        className={cx('relative size-12 touch-none select-none', disabled ? 'cursor-not-allowed' : 'cursor-ns-resize')}
        data-help={`${label}: drag up or down (Shift for fine), double-click to reset, click the value to type one.`}
        onPointerDown={(e) => {
          if (disabled || e.button !== 0) return;
          e.preventDefault();
          inputRef.current?.focus();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { y0: e.clientY, v0: value };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const speed = (max - min) / DRAG_PX / (e.shiftKey ? 10 : 1);
          set(d.v0 + (d.y0 - e.clientY) * speed);
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
          aria-label={caption && caption !== label ? label : undefined}
          aria-valuetext={valueText}
          aria-describedby={helpId}
          onChange={(e) => onChange(Number(e.target.value))}
          onKeyDown={onKeyDown}
          className="peer sr-only"
        />
        <svg aria-hidden="true" viewBox="0 0 48 48" className={cx('size-12 rounded-full', 'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus')}>
          <circle cx="24" cy="24" r="14" className="fill-surface-2 stroke-border-strong" strokeWidth="1.5" />
          <path d={arc(-SWEEP, SWEEP)} className="fill-none stroke-border" strokeWidth="4" strokeLinecap="round" />
          {angle !== origin ? (
            <path d={arc(Math.min(origin, angle), Math.max(origin, angle))} className="fill-none stroke-fg" strokeWidth="3" strokeLinecap="round" />
          ) : null}
          <line x1="24" y1="24" x2={px} y2={py} className="stroke-fg" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </div>
      {editing !== null ? (
        <input
          aria-label={`${label} value`}
          autoFocus
          value={editing}
          onChange={(e) => setEditing(e.target.value)}
          onBlur={() => closeField(editing, false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              closeField(editing, true);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              closeField(null, true);
            }
          }}
          className={cx('min-h-6 w-full rounded-ds border border-border-strong bg-surface px-1 text-center text-xs', focusRing)}
        />
      ) : (
        <span
          aria-hidden="true"
          className={cx('min-h-6 w-full truncate px-1 text-center text-xs leading-6', valueReadout, typeable && !disabled ? 'cursor-text' : '')}
          onClick={() => typeable && !disabled && openField()}
        >
          {display ?? valueText}
        </span>
      )}
      {onReset ? (
        <span id={helpId} className="sr-only">
          Press Delete or double-click to reset
        </span>
      ) : null}
    </div>
  );
}
