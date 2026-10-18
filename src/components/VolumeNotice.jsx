'use client';

import { useId, useRef, useState, useSyncExternalStore } from 'react';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import { getEngine } from '@/lib/audio/engine-client';

const engine = getEngine();
const serverState = { noticeOpen: false };

/**
 * Volume notice (assignment-3-scope.md, Volume notice; SAFE-01): shown before
 * the first sound of a page session. Continue starts audio inside its click
 * handler and performs the waiting action; Cancel and Escape perform nothing.
 */
export default function VolumeNotice() {
  const state = useSyncExternalStore(engine.subscribe, engine.getState, () => serverState);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const continueRef = useRef(null);
  const checkboxId = useId();

  function cancel() {
    setDontShowAgain(false);
    engine.cancelNotice();
  }

  function confirm() {
    engine.confirmNotice(dontShowAgain);
    setDontShowAgain(false);
  }

  return (
    <Dialog
      role="alertdialog"
      open={state.noticeOpen}
      onClose={cancel}
      title="Volume notice"
      initialFocusRef={continueRef}
      actions={
        <>
          <Button onClick={cancel}>Cancel</Button>
          <Button ref={continueRef} variant="primary" onClick={confirm}>
            Continue
          </Button>
        </>
      }
    >
      <p>Turn your device volume down. Wrack is about to play sound.</p>
      <div className="flex items-center gap-2">
        <input
          id={checkboxId}
          type="checkbox"
          checked={dontShowAgain}
          onChange={(e) => setDontShowAgain(e.target.checked)}
          className="size-5 accent-fg"
        />
        <label htmlFor={checkboxId}>Don&apos;t show this again on this device</label>
      </div>
    </Dialog>
  );
}
