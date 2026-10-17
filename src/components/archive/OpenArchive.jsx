'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import StatusRegion from '@/components/ui/StatusRegion';
import useCommands from '@/components/commands/useCommands';
import { errorText } from '@/design-systems/industrial/classes';
import { openArchive } from '@/lib/archive/archive';
import { loadArchiveSources } from '@/lib/audio/decode';
import { getEngine } from '@/lib/audio/engine-client';
import { loadProject, saveProject } from '@/lib/project/store';
import { migrate } from '@/lib/storage/migrate';
import { isProjectDoc } from '@/lib/storage/schema';
import RestoreDialog from './RestoreDialog';

export const NOT_A_PROJECT = 'project.json is not a W-Rack project.';

/**
 * "Open .wrack file" (assignment-3-scope.md, .wrack archive). A valid archive
 * whose project ID matches a saved project asks "Restore audio" or "Replace
 * project"; any other is imported as a new saved project and opened. A
 * failing archive imports nothing and lists its errors. `label` names the
 * button; `currentId` is the open project in the editor, where Restore audio
 * stays on the page. `inline` lays the button and its messages in a row;
 * `command` registers the Open command (Mod+O) — one instance per page does;
 * with `trigger` false there is no button and the command opens the picker.
 */
export default function OpenArchive({ label = 'Open .wrack file', size = 'md', currentId = null, disabled, inline = false, command = true, trigger = true }) {
  const router = useRouter();
  const inputRef = useRef(null);
  const buttonRef = useRef(null);
  const [errors, setErrors] = useState([]); // validation errors: nothing was imported
  const [warnings, setWarnings] = useState([]); // audio that did not decode after an import
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null); // { project, audio } awaiting the restore choice

  useCommands(
    command
      ? [{ id: 'project.open-wrack', group: 'Project', label: 'Open .wrack file…', keys: 'Mod+O', global: true, run: () => inputRef.current?.click(), enabled: () => !disabled && !busy }]
      : [],
  );

  async function loadAudio(project, audio) {
    const { loaded, failed } = await loadArchiveSources(audio, project.sources, getEngine().decodeRate());
    setWarnings(failed);
    return loaded.length;
  }

  function open(id) {
    if (id === currentId) return;
    router.push(`/projects/${id}`);
  }

  async function onFile(file) {
    setBusy(true);
    setErrors([]);
    setWarnings([]);
    setMessage('');
    try {
      const result = await openArchive(file);
      if (!result.ok) {
        setErrors(result.error.errors.map((e) => e.message));
        return;
      }
      const { project, audio } = result.value;
      const migrated = isProjectDoc(project) ? migrate(project) : { ok: false };
      if (!migrated.ok) {
        setErrors([NOT_A_PROJECT]);
        return;
      }
      const existing = loadProject(project.id);
      if (existing.ok && existing.value) {
        setPending({ project: migrated.value, audio });
        return;
      }
      const saved = saveProject(migrated.value);
      if (!saved.ok) {
        setErrors([saved.error]);
        return;
      }
      const count = await loadAudio(migrated.value, audio);
      setMessage(`Opened ${migrated.value.name} with ${count} audio ${count === 1 ? 'file' : 'files'}`);
      open(migrated.value.id);
    } catch (err) {
      console.error(err);
      setErrors(['The file could not be read.']);
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    const { project, audio } = pending;
    setPending(null);
    const count = await loadAudio(project, audio);
    setMessage(`Restored ${count} audio ${count === 1 ? 'file' : 'files'} for ${project.name}`);
    open(project.id);
  }

  async function replace() {
    const { project, audio } = pending;
    setPending(null);
    const saved = saveProject(project);
    if (!saved.ok) {
      setErrors([saved.error]);
      return;
    }
    await loadAudio(project, audio);
    // A full load reopens the editor on the replaced document.
    window.location.replace(`/projects/${project.id}`);
  }

  return (
    <div className={inline ? 'flex flex-wrap items-center gap-2' : 'flex flex-col gap-2'}>
      {trigger ? (
        <div>
          <Button ref={buttonRef} size={size} disabled={disabled || busy} onClick={() => inputRef.current?.click()} data-help="Open .wrack file (Ctrl/Cmd+O): opens a saved archive as a project, or restores this project's audio.">
            {busy ? 'Opening file…' : label}
          </Button>
        </div>
      ) : busy ? (
        <span className="text-xs">Opening file…</span>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept=".wrack,application/zip"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files[0];
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
      {errors.length > 0 ? (
        <div role="alert" className={errorText}>
          <p>Nothing was imported:</p>
          <ul className="list-disc pl-5">
            {errors.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <ul role="alert" className={errorText}>
          {warnings.map((text, i) => (
            <li key={i}>{text}</li>
          ))}
        </ul>
      ) : null}
      <StatusRegion className={inline ? 'text-xs' : 'text-sm'}>{message}</StatusRegion>
      <RestoreDialog
        open={pending !== null}
        name={pending?.project.name ?? ''}
        returnFocusRef={buttonRef}
        onRestore={restore}
        onReplace={replace}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
