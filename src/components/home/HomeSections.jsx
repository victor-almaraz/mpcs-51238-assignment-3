'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { errorText } from '@/design-systems/industrial/classes';
import { hasAnyWrackKey } from '@/lib/storage/storage';
import { getIndexSnapshot, listProjects, subscribeProjects } from '@/lib/project/store';
import CreateCard from './CreateCard';
import ExampleCards from './ExampleCards';
import LoadCard from './LoadCard';
import RecentList from './RecentList';

/**
 * Home sections in order: Recent (return visits with saved projects), Create,
 * Load, Examples. A first visit (no W-Rack keys) opens with a one-sentence
 * description. Before hydration neither the description nor Recent renders.
 */
export default function HomeSections() {
  const returning = useSyncExternalStore(subscribeProjects, hasAnyWrackKey, () => null);
  const indexRaw = useSyncExternalStore(subscribeProjects, getIndexSnapshot, () => null);
  const listed = useMemo(() => (indexRaw === null ? null : listProjects()), [indexRaw]);

  return (
    <>
      {returning === false ? (
        <p className="max-w-2xl text-lg">
          W-Rack is a music sketchpad in your browser: play built-in instruments, arrange MIDI and audio clips, and
          export the result as a WAV file.
        </p>
      ) : null}
      {listed && !listed.ok ? (
        <p role="alert" className={errorText}>
          {listed.error}
        </p>
      ) : null}
      {listed?.ok && listed.value.length > 0 ? <RecentList projects={listed.value} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <CreateCard />
        <LoadCard />
      </div>
      <ExampleCards />
    </>
  );
}
