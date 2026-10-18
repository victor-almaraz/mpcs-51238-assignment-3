'use client';

import { useRef, useState } from 'react';
import StatusRegion from '@/components/ui/StatusRegion';
import { cx, errorText, fieldLabel, focusRing } from '@/design-systems/industrial/classes';
import { validateProjectName } from '@/lib/project/validate';
import IconButton from '@/components/ui/IconButton';

/**
 * Editor header (NEW-03, SAVE-01): the project name as the page heading with
 * "Rename" for editing it in place (Enter or leaving the field commits,
 * Escape reverts), tempo and time signature, the save status, and the
 * project's file actions (`actions`).
 */
export default function EditorHeader({ name, tempo, meter, saveStatus, onRename, readOnly, actions }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState(null);
  const renameRef = useRef(null);

  function begin() {
    setDraft(name);
    setError(null);
    setEditing(true);
  }

  function finish(commit) {
    if (commit) {
      const problem = validateProjectName(draft);
      if (problem) {
        setError(problem);
        return;
      }
      if (draft.trim() !== name) onRename(draft.trim());
    }
    setEditing(false);
    setError(null);
    setTimeout(() => renameRef.current?.focus(), 0);
  }

  return (
    <div className="flex items-center gap-x-4 border-b border-border-strong bg-surface px-3 py-1.5">
      <div className="flex max-w-[45%] min-w-0 shrink-0 items-center gap-2">
        {editing ? (
          <div className="flex flex-col">
            <label htmlFor="project-name" className={cx(fieldLabel, 'sr-only')}>
              Project name
            </label>
            <input
              id="project-name"
              autoFocus
              value={draft}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? 'project-name-error' : undefined}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => finish(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') finish(true);
                else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  finish(false);
                }
              }}
              className={cx('min-h-8 w-72 rounded-ds border border-border-strong bg-bg px-2 font-sans text-base', focusRing)}
            />
            {error ? (
              <p id="project-name-error" className={errorText}>
                {error}
              </p>
            ) : null}
          </div>
        ) : (
          // The project name is the editor's heading, in the text face: the display face is for page titles.
          <h1 className="truncate font-sans text-lg leading-tight font-bold">{name}</h1>
        )}
        {!editing && !readOnly ? (
          <IconButton ref={renameRef} icon="pencil" label="Rename project" size="sm" variant="ghost" onClick={begin} />
        ) : null}
      </div>
      <p className="shrink-0 text-sm whitespace-nowrap text-muted">
        {tempo} BPM · {meter.numerator}/{meter.denominator}
      </p>
      <StatusRegion className="min-w-0 truncate text-sm">{saveStatus}</StatusRegion>
      <div role="toolbar" aria-label="Project" className="ml-auto flex shrink-0 items-center gap-2">
        {actions}
      </div>
    </div>
  );
}
