'use client';

import Link from 'next/link';
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import StatusRegion from '@/components/ui/StatusRegion';
import { buttonVariants, controlBase, controlSizes, cx, errorText } from '@/design-systems/industrial/classes';
import { deleteProject, getIndexSnapshot, listProjects, subscribeProjects } from '@/lib/project/store';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Every saved project, most recently edited first, with "Open" and "Delete".
 * Delete asks for confirmation in a dialog.
 */
export default function ProjectList() {
  const indexRaw = useSyncExternalStore(subscribeProjects, getIndexSnapshot, () => null);
  const listed = useMemo(() => (indexRaw === null ? { ok: true, value: [] } : listProjects()), [indexRaw]);
  const [pending, setPending] = useState(null); // project summary awaiting confirmation
  const [message, setMessage] = useState('');
  const [error, setError] = useState(null);
  const cancelRef = useRef(null);
  const triggerRef = useRef(null);

  function confirmDelete() {
    const result = deleteProject(pending.id);
    if (result.ok) {
      setMessage(`Deleted ${pending.name}`);
      setError(null);
    } else {
      setError(result.error);
    }
    setPending(null);
  }

  if (!listed.ok) {
    return (
      <p role="alert" className={errorText}>
        {listed.error}
      </p>
    );
  }

  return (
    <>
      <StatusRegion visuallyHidden>{message}</StatusRegion>
      {error ? (
        <p role="alert" className={errorText}>
          {error}
        </p>
      ) : null}
      {listed.value.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p>No saved projects on this device.</p>
          <div>
            <Link href="/new" className={cx(controlBase, controlSizes.md, buttonVariants.primary)}>
              Create a project
            </Link>
          </div>
        </div>
      ) : (
        <ul aria-label="Saved projects" className="flex flex-col divide-y divide-border rounded-ds border border-border-strong bg-surface">
          {listed.value.map((p) => {
            const edited = dateFormat.format(new Date(p.modifiedAt));
            return (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-bold">{p.name}</span>
                  <span className="text-xs text-muted">Edited {edited}</span>
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/projects/${p.id}`}
                    aria-label={`Open ${p.name}, edited ${edited}`}
                    className={cx(controlBase, controlSizes.md, buttonVariants.secondary)}
                  >
                    Open
                  </Link>
                  <Button aria-label={`Delete ${p.name}, edited ${edited}`} onClick={(e) => {
                      triggerRef.current = e.currentTarget;
                      setPending(p);
                    }}>
                    Delete
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending ? `Delete ${pending.name}?` : 'Delete project?'}
        initialFocusRef={cancelRef}
        returnFocusRef={triggerRef}
        actions={
          <>
            <Button ref={cancelRef} onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete}>
              Delete project
            </Button>
          </>
        }
      >
        <p>The project and its working state are removed from this device. This cannot be undone.</p>
      </Dialog>
    </>
  );
}
