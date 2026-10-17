'use client';

import { useEffect, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import StatusRegion from '@/components/ui/StatusRegion';

/**
 * Clip indicator (MIX-02): latches once a peak from `read()` ([left, right]
 * linear, or null) passes 0 dBFS and stays lit until pressed. While lit it is a
 * button, "Clear clip indicator, Bass clipped"; the latch is announced once.
 * Clearing it removes the button, so focus moves to the element with id
 * `focusId` (the strip's fader).
 */
export default function ClipIndicator({ name, read, focusId }) {
  const [clipped, setClipped] = useState(false);
  const clippedRef = useRef(false);
  const readRef = useRef(read);
  useEffect(() => {
    readRef.current = read;
  }, [read]);

  useEffect(() => {
    let frame = 0;
    function poll() {
      const peaks = readRef.current();
      if (!clippedRef.current && peaks && (peaks[0] > 1 || peaks[1] > 1)) {
        clippedRef.current = true;
        setClipped(true);
      }
      frame = requestAnimationFrame(poll);
    }
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, []);

  function clear(e) {
    if (e.currentTarget === document.activeElement) document.getElementById(focusId)?.focus();
    clippedRef.current = false;
    setClipped(false);
  }

  return (
    <>
      {clipped ? (
        <Button size="sm" variant="danger" className="px-1 text-[0.625rem]" onClick={clear} aria-label={`Clear clip indicator, ${name} clipped`} data-help="Clip: the level passed 0 dB. Press to clear.">
          Clip
        </Button>
      ) : (
        <span aria-hidden="true" className="inline-flex min-h-6 items-center rounded-ds border border-border px-1 text-[0.625rem] text-muted uppercase">
          Clip
        </span>
      )}
      <StatusRegion visuallyHidden>{clipped ? `${name} clipped` : ''}</StatusRegion>
    </>
  );
}
