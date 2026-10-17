'use client';

import { useEffect, useRef } from 'react';
import Meter from '@/components/ui/Meter';
import Slider from '@/components/ui/Slider';
import { sectionHeading } from '@/design-systems/industrial/classes';
import { MASTER_VOLUME } from '@/dsp/engine/engine';
import { getEngine } from '@/lib/audio/engine-client';
import PanSlider from './PanSlider';
import { faderText } from './TrackStrip';

/**
 * Master strip (MIX-01, MIX-02): master volume (−60 to 0 dB, default −12,
 * saved in settings), master pan (balance, saved with the project), the
 * post-limiter meter and the limiter's gain reduction ("Limiter −3.2 dB",
 * shown while above 0.5 dB and held for 1 s).
 */
export default function MasterStrip({ volumeDb, pan, onVolume, onPan, disabled }) {
  const engine = getEngine();
  const reductionRef = useRef(null);

  useEffect(() => {
    let frame = 0;
    let shownUntil = 0;
    function draw(now) {
      const reductionDb = -20 * Math.log10(Math.max(1e-6, engine.getMasterLevel().reduction));
      if (reductionDb > 0.5) shownUntil = now + 1000;
      if (reductionRef.current) {
        reductionRef.current.textContent = now < shownUntil ? `Limiter −${reductionDb.toFixed(1)} dB` : '';
      }
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
    <section aria-labelledby="master-strip-heading" className="flex w-80 shrink-0 flex-col gap-2 rounded-ds border-2 border-fg bg-surface p-2">
      <h3 id="master-strip-heading" className={sectionHeading}>
        Master
      </h3>
      <div className="flex items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Slider
            id="master-volume"
            label="Master volume"
            min={MASTER_VOLUME.min}
            max={MASTER_VOLUME.max}
            step={0.1}
            value={volumeDb}
            valueText={faderText(volumeDb)}
            onChange={onVolume}
            onReset={() => onVolume(MASTER_VOLUME.default)}
          />
          <PanSlider id="master-pan" name="Master" value={pan} onChange={onPan} disabled={disabled} />
        </div>
        <Meter read={readMeter} />
      </div>
      <p ref={reductionRef} aria-hidden="true" className="min-h-5 text-xs text-muted tabular-nums" />
    </section>
  );
}
