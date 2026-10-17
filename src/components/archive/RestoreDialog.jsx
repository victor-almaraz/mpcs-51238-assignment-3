'use client';

import { useRef } from 'react';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import IconButton from '@/components/ui/IconButton';

/**
 * Asked when an opened archive's project ID matches a saved project:
 * "Restore audio" loads the archive's sources and keeps the saved edits;
 * "Replace project" replaces the saved project with the archive's.
 */
export default function RestoreDialog({ open, name, onRestore, onReplace, onCancel, returnFocusRef }) {
  const restoreRef = useRef(null);
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={`${name} is already on this device`}
      initialFocusRef={restoreRef}
      returnFocusRef={returnFocusRef}
      actions={
        <>
          <IconButton icon="x" label="Cancel" onClick={onCancel} />
          <Button variant="danger" onClick={onReplace}>
            Replace project
          </Button>
          <Button ref={restoreRef} variant="primary" onClick={onRestore}>
            Restore audio
          </Button>
        </>
      }
    >
      <p>Restore audio loads the file&apos;s audio and keeps the edits saved on this device. Replace project replaces the saved project with the one in the file.</p>
    </Dialog>
  );
}
