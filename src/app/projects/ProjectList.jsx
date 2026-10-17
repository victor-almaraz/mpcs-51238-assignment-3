'use client';

import Link from 'next/link';
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import ProjectSummary, { describedBy } from '@/components/projects/ProjectSummary';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import Field from '@/components/ui/Field';
import StatusRegion from '@/components/ui/StatusRegion';
import { buttonVariants, controlBase, controlSizes, cx, errorText } from '@/design-systems/industrial/classes';
import { NAME_MAX, copyDocument, createId } from '@/lib/project/model';
import { deleteProject, getIndexSnapshot, listProjects, loadProject, saveProject, subscribeProjects } from '@/lib/project/store';
import { validateProjectName } from '@/lib/project/validate';
import { pruneStoredSources } from '@/lib/audio/source-cleanup';
import IconButton from '@/components/ui/IconButton';

/**
 * Every saved project, most recently edited first (RET-01), with "Open",
 * "Rename", "Duplicate" and "Delete", each named with the project. Rename
 * edits the name in a dialog; Delete asks for confirmation.
 */
export default function ProjectList() {
  const indexRaw = useSyncExternalStore(subscribeProjects, getIndexSnapshot, () => null);
  const listed = useMemo(() => (indexRaw === null ? { ok: true, value: [] } : listProjects()), [indexRaw]);
  const [pending, setPending] = useState(null); // project summary awaiting confirmation
  const [message, setMessage] = useState('');
  const [error, setError] = useState(null);
  const [renaming, setRenaming] = useState(null); // { entry, draft, error }
  const cancelRef = useRef(null);
  const triggerRef = useRef(null);
  const nameRef = useRef(null);

  /** Loads the saved document of `entry`, applies `change(doc)` and saves the result under its ID. */
  function rewrite(entry, change) {
    const loaded = loadProject(entry.id);
    if (!loaded.ok || !loaded.value) return { ok: false, error: loaded.ok ? 'The project could not be read.' : loaded.error };
    return saveProject(change(loaded.value, new Date().toISOString()));
  }

  function confirmRename() {
    const problem = validateProjectName(renaming.draft);
    if (problem) {
      setRenaming({ ...renaming, error: problem });
      nameRef.current?.focus();
      return;
    }
    const name = renaming.draft.trim();
    const result = rewrite(renaming.entry, (doc, now) => ({ ...doc, name, modifiedAt: now }));
    setRenaming(null);
    if (!result.ok) return setError(result.error);
    setError(null);
    setMessage(`Renamed ${renaming.entry.name} to ${name}`);
  }

  function duplicate(entry) {
    const name = [...`${entry.name} (copy)`].slice(0, NAME_MAX).join('');
    const result = rewrite(entry, (doc, now) => copyDocument(doc, { id: createId('prj'), name, now }));
    if (!result.ok) return setError(result.error);
    setError(null);
    setMessage(`Duplicated ${entry.name} as ${name}`);
  }

  function confirmDelete() {
    const result = deleteProject(pending.id);
    if (result.ok) {
      pruneStoredSources().catch((err) => console.error('Stored audio cleanup failed', err));
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
            const details = describedBy(p, `project-${p.id}`);
            return (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <ProjectSummary entry={p} id={`project-${p.id}`} />
                <div className="flex gap-2">
                  <Link
                    href={`/projects/${p.id}`}
                    aria-label={`Open ${p.name}`}
                    aria-describedby={details}
                    className={cx(controlBase, controlSizes.md, buttonVariants.secondary)}
                  >
                    Open
                  </Link>
                  <IconButton icon="pencil"
                    label={`Rename ${p.name}`}
                    aria-describedby={details}
                    onClick={(e) => {
                      triggerRef.current = e.currentTarget;
                      setRenaming({ entry: p, draft: p.name, error: null });
                    }} />
                  <IconButton icon="copy" label={`Duplicate ${p.name}`} aria-describedby={details} onClick={() => duplicate(p)} />
                  <IconButton icon="trash-2" label={`Delete ${p.name}`} aria-describedby={details} onClick={(e) => {
                      triggerRef.current = e.currentTarget;
                      setPending(p);
                    }} />
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
            <IconButton icon="x" label="Cancel" ref={cancelRef} onClick={() => setPending(null)} />
            <Button variant="danger" onClick={confirmDelete}>
              Delete project
            </Button>
          </>
        }
      >
        <p>The project and its working state are removed from this device. This cannot be undone.</p>
      </Dialog>
      <Dialog
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title={renaming ? `Rename ${renaming.entry.name}` : 'Rename project'}
        initialFocusRef={nameRef}
        returnFocusRef={triggerRef}
        actions={
          <>
            <IconButton icon="x" label="Cancel" onClick={() => setRenaming(null)} />
            <Button variant="primary" onClick={confirmRename}>
              Rename project
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            confirmRename();
          }}
        >
          <Field
            ref={nameRef}
            id="rename-project-name"
            label="Name"
            value={renaming?.draft ?? ''}
            error={renaming?.error ?? undefined}
            onChange={(e) => setRenaming({ ...renaming, draft: e.target.value, error: null })}
            autoComplete="off"
          />
        </form>
      </Dialog>
    </>
  );
}
