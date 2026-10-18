'use client';

import { useState, useSyncExternalStore } from 'react';
import Button from '@/components/ui/Button';
import StatusRegion from '@/components/ui/StatusRegion';
import useCommands from '@/components/commands/useCommands';
import { errorText } from '@/design-systems/industrial/classes';
import { buildArchive } from '@/lib/archive/archive';
import { getSource, getSourcesVersion, subscribeSources } from '@/lib/audio/decode';
import { safeFileName, saveFile } from '@/lib/files/save-file';
import { archiveState, flushSaves, getIndexSnapshot, markArchiveSaved, subscribeProjects } from '@/lib/project/store';

const WRACK_TYPE = { description: 'Wrack project', accept: { 'application/zip': ['.wrack'] } };

/** "<name>.wrack" with characters file systems reject replaced. */
export const archiveFileName = (name) => safeFileName(name, '.wrack');

/**
 * "Save .wrack file" (assignment-3-scope.md, .wrack archive): the project and
 * every loaded source in one STORE-only ZIP, with the "Not saved to file"
 * indicator beside it. `project` is the open document. With `trigger` false
 * there is no button and the project.save-wrack command saves (a File menu).
 */
export default function SaveArchive({ project, disabled, trigger = true }) {
  useSyncExternalStore(subscribeProjects, getIndexSnapshot, () => null);
  useSyncExternalStore(subscribeSources, getSourcesVersion, () => 0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const state = archiveState(project, (id) => Boolean(getSource(id)));
  useCommands([{ id: 'project.save-wrack', group: 'Project', label: 'Save .wrack file', keys: 'Mod+S', global: true, run: () => save(), enabled: () => !disabled && !busy }]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      flushSaves();
      const sources = Object.keys(project.sources)
        .map((id) => getSource(id))
        .filter(Boolean)
        .map((s) => ({ sourceId: s.sourceId, bytes: s.bytes }));
      const built = await buildArchive(project, sources);
      if (!built.ok) {
        setError(built.error.message);
        return;
      }
      const outcome = await saveFile(built.value.blob, archiveFileName(project.name), WRACK_TYPE);
      if (outcome === 'cancelled') return;
      const carried = Object.keys(project.sources).filter((id) => !built.value.missing.includes(id));
      markArchiveSaved(project, carried);
      const missing = built.value.missing.length;
      setMessage(
        missing === 0
          ? `Saved ${archiveFileName(project.name)}`
          : `Saved ${archiveFileName(project.name)} without ${missing} audio ${missing === 1 ? 'file' : 'files'} that ${missing === 1 ? 'is' : 'are'} not loaded.`,
      );
    } catch (err) {
      console.error(err);
      setError('The file could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {trigger ? (
        <Button size="sm" onClick={save} disabled={disabled || busy} aria-describedby="save-archive-help" data-help="Save .wrack file (Ctrl/Cmd+S). Edits save in this browser automatically. A .wrack file is a copy of the project and its audio, for backups and other devices.">
          {busy ? 'Saving file…' : 'Save .wrack file'}
        </Button>
      ) : null}
      <span className="text-xs whitespace-nowrap" data-help="A .wrack file is a copy of the project and its audio, for backups and other devices; edits save in this browser automatically.">
        {busy ? 'Saving file…' : state.saved ? 'Saved to file' : 'Not saved to file'}
      </span>
      <p id="save-archive-help" className="sr-only">
        Edits save in this browser automatically. A .wrack file is a copy of the project and its audio, for backups and other devices.
      </p>
      <StatusRegion className="text-xs">{message}</StatusRegion>
      {error ? (
        <p role="alert" className={errorText}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
