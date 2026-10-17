'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { cx, errorText, fieldLabel, focusRing } from '@/design-systems/industrial/classes';
import { validateTempo, parseTempo } from '@/lib/project/validate';

/**
 * Tempo in the transport (NEW-03): an integer 40–240 under the New project
 * form rules. Commits on Enter or blur; an invalid entry shows the form's
 * error and keeps the text.
 */
export default function TempoField({ bpm, onCommit, disabled }) {
  const [text, setText] = useState(null); // null while showing `bpm`
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const [errorAt, setErrorAt] = useState(undefined);
  useLayoutEffect(() => {
    if (!error || !inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    setErrorAt({ left: r.left, top: r.bottom + 4 });
  }, [error]);
  const value = text ?? String(bpm);

  function commit() {
    if (text === null) return;
    const message = validateTempo(text);
    setError(message);
    if (message) return;
    setText(null);
    const next = parseTempo(text);
    if (next !== bpm) onCommit(next);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <label htmlFor="transport-tempo" className={cx(fieldLabel, 'w-auto')}>
          Tempo (BPM)
        </label>
        <input
          id="transport-tempo"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          disabled={disabled}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'transport-tempo-error' : undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') {
              // Escape reverts the typed text (and, being in a field, does not panic).
              setText(null);
              setError(null);
            }
          }}
          ref={inputRef}
          className={cx(
            'min-h-8 w-16 rounded-ds border bg-surface px-2 text-sm text-fg tabular-nums',
            error ? 'border-danger' : 'border-border-strong',
            focusRing,
          )}
        />
      </div>
      {error ? (
        // Anchored under the field without growing the transport bar, which scrolls sideways and would clip it.
        <p id="transport-tempo-error" className={cx(errorText, 'fixed z-50 whitespace-nowrap shadow-md')} style={errorAt}>
          <span aria-hidden="true">▲</span>
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
