'use client';

import { useEffect, useRef } from 'react';
import Meter from '@/components/ui/Meter';
import Fader from '@/components/ui/Fader';
import { MASTER_VOLUME } from '@/dsp/engine/engine';
import { getEngine } from '@/lib/audio/engine-client';
import PanKnob from './PanKnob';
import { faderText } from './TrackStrip';

/** How long the limiter readout holds its deepest reduction, ms. */
const HOLD_MS = 1000;

/**
 * Master strip (MIX-01, MIX-02), laid out like the track strips: master pan
 * (balance, saved with the project), the limiter's gain reduction ("Limiter
 * −3.2 dB", shown while above 0.5 dB and held for 1 s), the master volume
 * fader (−60 to 0 dB, default −12, saved in settings) beside the
 * post-limiter meter, the dB readout and the name.
 */
export default function MasterStrip({ volumeDb, pan, onVolume, onPan, disabled }) {
  const engine = getEngine();
  const reductionRef = useRef(null);

  useEffect(() => {
    let frame = 0;
    let held = 0; // dB of reduction on show, 0 for none
    let heldUntil = 0;
    function draw(now) {
      const reductionDb = -20 * Math.log10(Math.max(1e-6, engine.getMasterLevel().reduction));
      // The deepest reduction holds for 1 s; a lighter one replaces it only after that.
      if (reductionDb > 0.5 && (reductionDb >= held || now >= heldUntil)) {
        held = reductionDb;
        heldUntil = now + HOLD_MS;
      } else if (now >= heldUntil) held = 0;
      const text = held > 0 ? `Limiter −${held.toFixed(1)} dB` : '';
      if (reductionRef.current && reductionRef.current.textContent !== text) reductionRef.current.textContent = text;
      frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [engine]);

  const readMeter = () => {
    const level = engine.getMasterLevel();
    return [level.peakL, level.peakR];
  };

  return (
    <section aria-labelledby="master-strip-heading" className="flex h-full w-28 shrink-0 flex-col items-center gap-1.5 rounded-ds border-2 border-fg bg-surface px-1.5 py-2">
      <PanKnob id="master-pan" name="Master" value={pan} onChange={onPan} disabled={disabled} />
      <p ref={reductionRef} aria-hidden="true" className="min-h-6 text-center text-[0.6875rem] leading-6 text-muted tabular-nums" />
      <Fader
        id="master-volume"
        label="Master volume"
        min={MASTER_VOLUME.min}
        max={MASTER_VOLUME.max}
        step={0.1}
        value={volumeDb}
        valueText={faderText(volumeDb)}
        onChange={onVolume}
        onReset={() => onVolume(MASTER_VOLUME.default)}
      >
        <Meter read={readMeter} scale={[MASTER_VOLUME.min, MASTER_VOLUME.max]} className="h-full w-3" />
      </Fader>
      <output aria-hidden="true" className="min-h-6 w-full rounded-ds bg-window text-center font-mono text-xs leading-6 text-lamp">
        {faderText(volumeDb)}
      </output>
      <h3 id="master-strip-heading" className="w-full text-center text-xs">
        Master
      </h3>
    </section>
  );
}
