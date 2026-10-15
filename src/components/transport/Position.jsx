'use client';

import { useEffect, useRef } from 'react';
import { getEngine } from '@/lib/audio/engine-client';
import { PPQ } from '@/dsp/core/constants';

/** "bar.beat.sixteenth", 1-based (TRN-01): 1.1.1 is the project start. */
export function formatPosition(tick, meter) {
  if (!meter) return '1.1.1';
  const bar = meter.barAt(tick) + 1;
  const beat = meter.beatAt(tick) + 1;
  const sixteenth = Math.floor(meter.tickInBeat(tick) / (PPQ / 4)) + 1;
  return `${bar}.${beat}.${sixteenth}`;
}

/**
 * Transport position. A requestAnimationFrame loop writes the text through a
 * ref; the position is never React state.
 */
export default function Position() {
  const textRef = useRef(null);

  useEffect(() => {
    const engine = getEngine();
    let frame = 0;
    let shown = '';
    function draw() {
      const text = formatPosition(engine.positionTick(), engine.meter());
      if (text !== shown && textRef.current) {
        textRef.current.textContent = text;
        shown = text;
      }
      frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="flex items-center gap-2">
      <span className="text-[0.6875rem] font-bold tracking-[0.04em] text-muted uppercase">Position</span>
      <span
        ref={textRef}
        data-testid="position"
        className="min-w-20 rounded-ds bg-window px-2 py-1 text-center text-sm text-lamp tabular-nums"
      >
        1.1.1
      </span>
    </div>
  );
}
