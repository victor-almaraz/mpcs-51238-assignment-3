'use client';

import { useEffect, useRef } from 'react';
import { cx } from '@/design-systems/industrial/classes';
import { taperFraction } from './level-scale';

/** Peak hold time, s, and fall rate, dB/s (mixer-and-routing.md, Metering). */
const HOLD_S = 1.5;
const FALL_DB_PER_S = 20;
const FLOOR_DB = -60;

const toDb = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const linearFraction = (db) => (db <= FLOOR_DB ? 0 : Math.min(1, (db - FLOOR_DB) / -FLOOR_DB));

/**
 * Stereo peak meter: two LED-window bars with a 1.5 s hold and a 20 dB/s fall,
 * drawn through refs in a requestAnimationFrame loop. `read()` returns the
 * latest linear peaks [left, right] or null. Without `scale` the bars run
 * linearly from −60 to 0 dBFS; with `scale={[min, max]}` (dB) they follow the
 * fader scale beside them (level-scale.js), 0 dBFS level with the fader's 0
 * mark, and span the full height so the marks line up. Hidden from the
 * accessibility tree (MIX-02); a level is never announced.
 */
export default function Meter({ read, scale = null, className = 'h-24 w-5' }) {
  const bars = [useRef(null), useRef(null)];
  const holds = [useRef(null), useRef(null)];
  const [lo, hi] = scale ?? [];
  const toFraction = scale ? (db) => (db <= lo ? 0 : taperFraction(db, lo, hi)) : linearFraction;
  const toFractionRef = useRef(toFraction);
  useEffect(() => {
    toFractionRef.current = toFraction;
  });

  useEffect(() => {
    const shown = [FLOOR_DB, FLOOR_DB];
    const held = [FLOOR_DB, FLOOR_DB];
    const heldAt = [0, 0];
    let frame = 0;
    let last = performance.now();
    function draw(now) {
      const dt = (now - last) / 1000;
      last = now;
      const peaks = read();
      const toFraction = toFractionRef.current;
      for (let ch = 0; ch < 2; ch++) {
        const db = peaks ? toDb(peaks[ch]) : -Infinity;
        shown[ch] = Math.max(db, shown[ch] - FALL_DB_PER_S * dt);
        if (db >= held[ch] || now - heldAt[ch] > HOLD_S * 1000) {
          held[ch] = Math.max(db, FLOOR_DB);
          heldAt[ch] = now;
        }
        if (bars[ch].current) bars[ch].current.style.transform = `scaleY(${toFraction(shown[ch])})`;
        if (holds[ch].current) holds[ch].current.style.bottom = `${toFraction(held[ch]) * 100}%`;
      }
      frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
    // `read` is a stable getter for the component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div aria-hidden="true" className={cx('flex gap-0.5 rounded-ds bg-window', scale ? 'px-0.5' : 'p-0.5', className)}>
      {[0, 1].map((ch) => (
        <div key={ch} className="relative flex-1 overflow-hidden">
          <div
            ref={bars[ch]}
            className="absolute inset-0 origin-bottom bg-gradient-to-t from-level-low via-level-mid to-level-high"
            style={{ transform: 'scaleY(0)' }}
          />
          <div ref={holds[ch]} className="absolute right-0 left-0 h-px bg-lamp" style={{ bottom: '0%' }} />
        </div>
      ))}
    </div>
  );
}
