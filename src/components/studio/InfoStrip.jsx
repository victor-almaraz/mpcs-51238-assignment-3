'use client';

import { useEffect, useState } from 'react';

/** Shown when the pointer and focus rest on nothing with help text. */
const IDLE = 'Space plays and stops · Escape stops all sound · Ctrl+K (Cmd+K) lists every command · ? shows shortcuts';

/**
 * Info strip (HELP-01): one line describing the hovered or focused control,
 * from its `data-help` text (or its accessible description), and the editor's
 * live-input controls at the right. It is not a live region: the same text
 * reaches assistive technology through each control's description.
 */
export default function InfoStrip({ rootRef, children }) {
  const [text, setText] = useState(IDLE);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const helpOf = (el) => {
      const owner = el?.closest?.('[data-help]');
      return owner ? owner.getAttribute('data-help') : null;
    };
    let focusedHelp = null;
    const onFocus = (e) => {
      focusedHelp = helpOf(e.target);
      setText(focusedHelp ?? IDLE);
    };
    const onOver = (e) => setText(helpOf(e.target) ?? focusedHelp ?? IDLE);
    root.addEventListener('focusin', onFocus);
    root.addEventListener('pointerover', onOver);
    return () => {
      root.removeEventListener('focusin', onFocus);
      root.removeEventListener('pointerover', onOver);
    };
  }, [rootRef]);

  return (
    <div className="flex h-9 shrink-0 items-center gap-4 border-t border-border-strong bg-surface px-3">
      <p aria-hidden="true" className="min-w-0 flex-1 truncate text-xs text-muted">
        {text}
      </p>
      {children}
    </div>
  );
}
