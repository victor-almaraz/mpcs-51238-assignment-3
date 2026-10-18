'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Dialog from '@/components/ui/Dialog';
import Field from '@/components/ui/Field';
import StatusRegion from '@/components/ui/StatusRegion';
import { errorText, groupHeading, sectionHeading } from '@/design-systems/industrial/classes';
import { deletePreset, getPresets, renamePreset, subscribePresets } from '@/lib/presets/store';
import { MAX_PRESETS } from '@/lib/presets/validate';
import { typeLabel } from './labels';
import { focusAfterRemoval } from '@/components/ui/focusAfterRemoval';
import IconButton from '@/components/ui/IconButton';

const EMPTY = [];

/**
 * The preset library in /settings (assignment-3-scope.md, Presets): presets
 * grouped by instrument or effect type, each with Rename and Delete; Delete
 * asks for confirmation.
 */
export default function PresetList() {
  const presets = useSyncExternalStore(subscribePresets, getPresets, () => EMPTY);
  const [renaming, setRenaming] = useState(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(null);
  const trigger = useRef(null);
  const nameRef = useRef(null);
  const cancelRef = useRef(null);

  const groups = new Map();
  for (const p of presets) {
    const key = `${p.kind}:${p.type}`;
    if (!groups.has(key)) groups.set(key, { label: typeLabel(p.kind, p.type), items: [] });
    groups.get(key).items.push(p);
  }

  function submitRename(e) {
    e.preventDefault();
    const result = renamePreset(renaming.id, name, typeLabel(renaming.kind, renaming.type));
    if (result.ok) {
      setMessage(`Renamed ${renaming.name} to ${name.trim()}`);
      setRenaming(null);
    } else if (result.error.field === 'name') {
      setNameError(result.error.message);
      nameRef.current?.focus();
    } else {
      setError(result.error.message);
      setRenaming(null);
    }
  }

  function confirmDelete() {
    const group = [...groups.values()].find((g) => g.items.some((x) => x.id === deleting.id));
    const index = group.items.findIndex((x) => x.id === deleting.id);
    const label = group.label;
    const result = deletePreset(deleting.id);
    focusAfterRemoval(
      () => document.querySelector(`[aria-label="${label} presets"] ul`),
      index,
      '[aria-label^="Delete "]',
      () => document.getElementById('settings-presets'),
    );
    if (result.ok) setMessage(`Deleted ${deleting.name}`);
    else setError(result.error.message);
    setDeleting(null);
  }

  return (
    <Card as="section" aria-labelledby="settings-presets">
      <h2 id="settings-presets" tabIndex={-1} className={sectionHeading}>
        Presets
      </h2>
      <p className="text-sm">
        {presets.length} of {MAX_PRESETS} presets. Presets are shared by every project on this device.
      </p>
      {error ? (
        <p role="alert" className={errorText}>
          {error}
        </p>
      ) : null}
      {presets.length === 0 ? <p className="text-sm">No presets. Use Save preset on an instrument or effect.</p> : null}
      {[...groups.values()].map((group) => (
        <section key={group.label} aria-label={`${group.label} presets`} className="flex flex-col gap-1">
          <h3 className={groupHeading}>{group.label}</h3>
          <ul className="flex flex-col divide-y divide-border rounded-ds border border-border-strong bg-surface">
            {group.items.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                <span>{p.name}</span>
                <span className="flex gap-2">
                  <IconButton icon="pencil"
                    size="sm"
                    label={`Rename ${p.name}`}
                    onClick={(e) => {
                      trigger.current = e.currentTarget;
                      setName(p.name);
                      setNameError(null);
                      setRenaming(p);
                    }} />
                  <IconButton icon="trash-2"
                    size="sm"
                    label={`Delete ${p.name}`}
                    onClick={(e) => {
                      trigger.current = e.currentTarget;
                      setDeleting(p);
                    }} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <StatusRegion visuallyHidden>{message}</StatusRegion>
      <Dialog open={renaming !== null} onClose={() => setRenaming(null)} title={renaming ? `Rename ${renaming.name}` : 'Rename preset'} initialFocusRef={nameRef} returnFocusRef={trigger}>
        <form noValidate onSubmit={submitRename} className="flex flex-col gap-3">
          <Field id="rename-preset-name" ref={nameRef} label="Name" value={name} error={nameError} autoComplete="off" onChange={(e) => setName(e.target.value)} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => setRenaming(null)}>Cancel</Button>
            <Button type="submit" variant="primary">
              Rename
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={deleting ? `Delete ${deleting.name}?` : 'Delete preset?'}
        initialFocusRef={cancelRef}
        returnFocusRef={trigger}
        actions={
          <>
            <Button ref={cancelRef} onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmDelete}>
              Delete preset
            </Button>
          </>
        }
      >
        <p>The preset is removed from every project on this device. Devices keep their current settings.</p>
      </Dialog>
    </Card>
  );
}
