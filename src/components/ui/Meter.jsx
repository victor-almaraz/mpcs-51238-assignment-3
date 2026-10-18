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
  // The latest getter: a strip's track index changes when tracks move or one before it is deleted.
  const readRef = useRef(read);
  useEffect(() => {
    toFractionRef.current = toFraction;
    readRef.current = read;
  });

  useEffect(() => {
    const shown = [FLOOR_DB, FLOOR_DB];
    const held = [FLOOR_DB, FLOOR_DB];
    const heldAt = [0, 0];
    // Last written styles: an unchanged meter (silence, a stopped transport) writes nothing.
    const written = [['', ''], ['', '']];
    let frame = 0;
    let last = performance.now();
    function draw(now) {
      const dt = (now - last) / 1000;
      last = now;
      const peaks = readRef.current();
      const toFraction = toFractionRef.current;
      for (let ch = 0; ch < 2; ch++) {
        const db = peaks ? toDb(peaks[ch]) : -Infinity;
        shown[ch] = Math.max(db, shown[ch] - FALL_DB_PER_S * dt);
        if (db >= held[ch] || now - heldAt[ch] > HOLD_S * 1000) {
          held[ch] = Math.max(db, FLOOR_DB);
          heldAt[ch] = now;
        }
        // Transforms only: they move the bar and the hold line without a layout.
        // Rounded below a pixel at meter heights (< 200 px), so a steady level writes nothing.
        const bar = `scaleY(${toFraction(shown[ch]).toFixed(2)})`;
        const hold = `translateY(${Math.round((1 - toFraction(held[ch])) * 200) / 2}%)`;
        if (bar !== written[ch][0] && bars[ch].current) bars[ch].current.style.transform = written[ch][0] = bar;
        if (hold !== written[ch][1] && holds[ch].current) holds[ch].current.style.transform = written[ch][1] = hold;
      }
      frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
    // One loop per mount: the getter, the scale and the elements are all read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div aria-hidden="true" className={cx('flex gap-0.5 rounded-ds bg-window', scale ? 'px-0.5' : 'p-0.5', className)}>
      {[0, 1].map((ch) => (
        <div key={ch} className="relative flex-1 overflow-hidden">
          <div
            ref={bars[ch]}
            className="absolute inset-0 origin-bottom bg-gradient-to-t from-level-low via-level-mid to-level-high will-change-transform"
            style={{ transform: 'scaleY(0)' }}
          />
          {/* The hold line is the top edge of a full-height layer moved by translateY. */}
          <div ref={holds[ch]} className="pointer-events-none absolute inset-0 border-t border-lamp will-change-transform" style={{ transform: 'translateY(100%)' }} />
        </div>
      ))}
    </div>
  );
}
