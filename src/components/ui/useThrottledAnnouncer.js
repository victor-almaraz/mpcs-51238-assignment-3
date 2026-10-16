'use client';

import { useEffect, useRef, useState } from 'react';

/** At most one announcement per 250 ms; the latest wins (accessibility.md, project limit). */
export const ANNOUNCE_MS = 250;

/**
 * Polite announcements throttled to one per 250 ms, latest wins. Returns
 * [text, announce]; render `text` in a StatusRegion.
 */
export default function useThrottledAnnouncer() {
  const [text, setText] = useState('');
  const last = useRef(0);
  const pending = useRef(null);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  function emit(message) {
    last.current = performance.now();
    // A repeated message needs changed text to be read again.
    setText((prev) => (prev === message ? `${message}.` : message));
  }
  function announce(message) {
    const wait = ANNOUNCE_MS - (performance.now() - last.current);
    if (wait <= 0 && !timer.current) {
      emit(message);
      return;
    }
    pending.current = message;
    if (!timer.current) {
      timer.current = setTimeout(() => {
        timer.current = 0;
        emit(pending.current);
      }, Math.max(0, wait));
    }
  }
  return [text, announce];
}
