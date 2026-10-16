'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { getSourcesVersion, loadStoredSources, subscribeSources } from '@/lib/audio/decode';

/**
 * Loads the project's stored sources that are not in memory (decoding them at
 * `rate`) when the project opens. Returns { loading, version }: the sourceIds
 * still loading, and the source registry version, which changes whenever a
 * source loads, so callers re-render with current storage status.
 */
export default function useProjectSources(projectId, sources, rate) {
  const version = useSyncExternalStore(subscribeSources, getSourcesVersion, () => 0);
  const [loading, setLoading] = useState(() => new Set(Object.keys(sources ?? {})));
  const [opened] = useState(() => sources);
  useEffect(() => {
    let live = true;
    loadStoredSources(opened, rate)
      .catch((err) => console.error('Stored audio could not be loaded', err))
      .finally(() => {
        if (live) setLoading(new Set());
      });
    return () => {
      live = false;
    };
  }, [projectId, opened, rate]);
  return { loading, version };
}
