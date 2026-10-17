'use client';

import { cx, fieldLabel, focusRing, readout } from '@/design-systems/industrial/classes';

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/**
 * Native range input with a visible label and a value readout.
 * `valueText` is required: it is the aria-valuetext with units ("−6.0 dB") and
 * the readout text; a missing valueText throws outside production builds.
 * `display` replaces the readout text when it should be shorter ("L20" for "Left 20").
 * PageUp/PageDown jump by `pageStep` (default 10 % of the range). With `onReset`,
 * Delete and double-click reset the value. `className` goes on the row, other
 * props on the <input>.
 */
export default function Slider({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  valueText,
  display,
  onReset,
  pageStep,
  disabled = false,
  labelHidden = false,
  className,
  onKeyDown,
  onDoubleClick,
  'aria-describedby': describedBy,
  ref,
  ...rest
}) {
  if (process.env.NODE_ENV !== 'production' && !valueText) {
    throw new Error(`Slider "${label}" requires a valueText prop with units.`);
  }
  const helpId = onReset ? `${id}-reset-help` : undefined;
  const describedByIds = [describedBy, helpId].filter(Boolean).join(' ') || undefined;

  function handleKeyDown(e) {
    onKeyDown?.(e);
    if (e.defaultPrevented || disabled) return;
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      const jump = pageStep ?? (max - min) / 10;
      const raw = value + (e.key === 'PageUp' ? jump : -jump);
      const snapped = step > 0 ? min + Math.round((raw - min) / step) * step : raw;
      const next = clamp(Number(snapped.toFixed(10)), min, max);
      if (next !== value) onChange(next);
    } else if (e.key === 'Delete' && onReset) {
      e.preventDefault();
      onReset();
    }
  }

  function handleDoubleClick(e) {
    onDoubleClick?.(e);
    if (!disabled) onReset?.();
  }

  return (
    <div className={cx('relative flex min-w-0 items-center gap-2', className)}>
      <label htmlFor={id} className={labelHidden ? 'sr-only' : fieldLabel}>
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={valueText}
        aria-describedby={describedByIds}
        onChange={(e) => onChange(Number(e.target.value))}
        onKeyDown={handleKeyDown}
        onDoubleClick={handleDoubleClick}
        className={cx(
          'h-6 min-h-6 min-w-0 flex-1 cursor-pointer rounded-ds bg-transparent disabled:cursor-not-allowed disabled:opacity-40',
          focusRing,
        )}
        {...rest}
      />
      <output htmlFor={id} aria-hidden="true" className={cx('min-h-6 w-20 shrink-0 px-1 text-right text-sm leading-6', readout)}>
        {display ?? valueText}
      </output>
      {onReset ? (
        <span id={helpId} className="sr-only">
          Press Delete or double-click to reset
        </span>
      ) : null}
    </div>
  );
}
