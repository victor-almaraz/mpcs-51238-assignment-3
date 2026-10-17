'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Dialog from '@/components/ui/Dialog';
import StatusRegion from '@/components/ui/StatusRegion';
import { errorText, sectionHeading } from '@/design-systems/industrial/classes';
import { removeStoredSource, storedSources } from '@/lib/audio/source-cleanup';
import { deleteDatabase, usage } from '@/lib/storage/audio-store';
import { listWrackKeys, removeKey } from '@/lib/storage/storage';
import { focusAfterRemoval } from '@/components/ui/focusAfterRemoval';
import IconButton from '@/components/ui/IconButton';

const noSubscription = () => () => {};
const mb = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** True in Safari (desktop and iOS), which can delete site data after 7 days without a visit. */
function isSafari() {
  return /^((?!chrome|chromium|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);
}

/**
 * Stored audio in /settings (assignment-3-scope.md, Audio persistence):
 * origin usage from navigator.storage.estimate(), the stored sources with the
 * projects that use them and a Delete action each, the Safari 7-day note, and
 * "Clear all data", which removes every W-Rack localStorage key and the
 * w-rack IndexedDB database after confirmation.
 */
export default function StoredAudio() {
  const [estimate, setEstimate] = useState(null);
  const [sources, setSources] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState('');
  const safari = useSyncExternalStore(noSubscription, isSafari, () => false);
  const [confirming, setConfirming] = useState(false);
  const [version, setVersion] = useState(0);
  const cancelRef = useRef(null);
  const clearRef = useRef(null);

  useEffect(() => {
    let live = true;
    Promise.all([usage(), storedSources()]).then(([u, s]) => {
      if (!live) return;
      setEstimate(u.ok ? u.value : null);
      if (s.ok) setSources(s.value);
      else {
        setSources([]);
        setError(s.error.code === 'unavailable' ? 'This browser does not allow W-Rack to store audio.' : 'Stored audio could not be read.');
      }
    });
    return () => {
      live = false;
    };
  }, [version]);

  async function remove(source, index) {
    const result = await removeStoredSource(source.sourceId);
    focusAfterRemoval(() => document.querySelector('[aria-label="Stored audio files"]'), index, '[aria-label^="Delete "]', () => document.getElementById('settings-audio'));
    setMessage(result.ok ? `Deleted ${source.name} from this device` : `${source.name} could not be deleted`);
    setVersion((v) => v + 1);
  }

  async function clearAll() {
    for (const key of listWrackKeys()) removeKey(key);
    const result = await deleteDatabase();
    setConfirming(false);
    if (!result.ok) {
      setError('Stored audio could not be deleted. Close other W-Rack tabs and try again.');
      return;
    }
    // A full load also empties the in-memory audio sources.
    window.location.replace('/');
  }

  return (
    <Card as="section" aria-labelledby="settings-audio">
      <h2 id="settings-audio" tabIndex={-1} className={sectionHeading}>
        Stored audio
      </h2>
      {estimate ? (
        <p className="text-sm">
          This site uses about {mb(estimate.used)} of {mb(estimate.quota)} available to it, including stored audio.
        </p>
      ) : null}
      {safari ? (
        <p className="text-sm">Safari can delete this site&apos;s stored data after 7 days without a visit. Save .wrack files as backups.</p>
      ) : null}
      {error ? (
        <p role="alert" className={errorText}>
          {error}
        </p>
      ) : null}
      {sources === null ? (
        <p className="text-sm">Reading stored audio…</p>
      ) : sources.length === 0 ? (
        <p className="text-sm">No audio is stored on this device.</p>
      ) : (
        <ul aria-label="Stored audio files" className="flex flex-col divide-y divide-border rounded-ds border border-border-strong bg-surface">
          {sources.map((s, i) => (
            <li key={s.sourceId} className="flex flex-wrap items-center justify-between gap-2 p-2">
              <div className="flex flex-col">
                <span className="font-bold">{s.name}</span>
                <span className="text-sm text-muted">
                  {mb(s.size)} · {s.projects.length === 0 ? 'Used by no saved project' : `Used by ${s.projects.join(', ')}`}
                </span>
              </div>
              <IconButton icon="trash-2" size="sm" label={`Delete ${s.name} from this device`} onClick={() => remove(s, i)} />
            </li>
          ))}
        </ul>
      )}
      <StatusRegion visuallyHidden>{message}</StatusRegion>
      <div>
        <Button ref={clearRef} variant="danger" onClick={() => setConfirming(true)}>
          Clear all data
        </Button>
      </div>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Clear all data?"
        initialFocusRef={cancelRef}
        returnFocusRef={clearRef}
        actions={
          <>
            <Button ref={cancelRef} onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="danger" onClick={clearAll}>
              Clear all data
            </Button>
          </>
        }
      >
        <p>Every project, preset, setting and stored audio file is removed from this device. This cannot be undone.</p>
      </Dialog>
    </Card>
  );
}
