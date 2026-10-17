'use client';

import { useEffect, useState } from 'react';
import { sectionHeading } from '@/design-systems/industrial/classes';
import { getEngine } from '@/lib/audio/engine-client';

/** Readout refresh, ms: the group name changes at most this often. */
const REFRESH_MS = 250;

/** Gain reduction text from a linear limiter gain: "0.0 dB", "3.2 dB". */
export function reductionText(gain) {
  const db = -20 * Math.log10(Math.max(1e-6, gain));
  return `${Math.max(0, db).toFixed(1)} dB`;
}

/**
 * The fixed safety limiter that ends the master chain (SAFE-02,
 * audio-safety.md): a −1 dBFS ceiling that cannot be removed, moved or
 * bypassed and takes no device slot. The group name carries the current gain
 * reduction, "Safety limiter, always on, gain reduction 0.0 dB".
 */
export default function SafetyLimiter() {
  const engine = getEngine();
  const [reduction, setReduction] = useState('0.0 dB');

  useEffect(() => {
    const timer = setInterval(() => setReduction(reductionText(engine.getMasterLevel().reduction)), REFRESH_MS);
    return () => clearInterval(timer);
  }, [engine]);

  return (
    <div
      role="group"
      aria-label={`Safety limiter, always on, gain reduction ${reduction}`}
      className="flex w-full flex-col gap-1 rounded-ds border-2 border-fg bg-surface-2 p-2 sm:w-80"
    >
      <h3 className={sectionHeading} aria-hidden="true">
        Safety limiter (always on)
      </h3>
      <p className="text-sm" aria-hidden="true">
        Ceiling −1 dBFS · Gain reduction <span className="tabular-nums">{reduction}</span>
      </p>
      <p className="text-xs text-muted" aria-hidden="true">
        Last in the chain; it takes no slot and cannot be bypassed.
      </p>
    </div>
  );
}
