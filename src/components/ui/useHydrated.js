'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * False in prerendered HTML and during hydration, true afterwards. Controls whose
 * handlers or values come from the client stay disabled until then, so input
 * before hydration is never lost.
 */
export default function useHydrated() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
