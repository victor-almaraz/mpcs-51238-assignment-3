'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import Dialog from '@/components/ui/Dialog';
import { cx, focusRing } from '@/design-systems/industrial/classes';
import { getCommands, getPaletteRequests, matchesQuery, requestPalette, subscribeCommands } from '@/lib/commands/registry';
import useCommands from './useCommands';

const EMPTY = [];

/** True for Ctrl+Shift+P (Cmd+Shift+P on macOS). */
const isPaletteKey = (e) => (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p';

/**
 * Command palette (accessibility.md, Command system): Ctrl+Shift+P
 * (Cmd+Shift+P on macOS) or the header's Commands button opens a dialog with
 * a search field (a combobox) over the commands registered on the page. Up
 * and Down move through the matches, Enter runs one, Escape closes. Unavailable
 * commands are listed as disabled. Navigation commands are always present.
 */
export default function CommandPalette() {
  const router = useRouter();
  const all = useSyncExternalStore(subscribeCommands, getCommands, () => EMPTY);
  const requests = useSyncExternalStore(subscribeCommands, getPaletteRequests, () => 0);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [seenRequests, setSeenRequests] = useState(requests);
  const inputRef = useRef(null);
  const listId = useId();

  if (requests !== seenRequests) {
    setSeenRequests(requests);
    setOpen(true);
    setQuery('');
    setActive(0);
  }

  useCommands([
    { id: 'nav.home', group: 'Go to', label: 'Home', run: () => router.push('/') },
    { id: 'nav.projects', group: 'Go to', label: 'Projects', run: () => router.push('/projects') },
    { id: 'nav.new', group: 'Go to', label: 'New project', run: () => router.push('/new') },
    { id: 'nav.settings', group: 'Go to', label: 'Settings', run: () => router.push('/settings') },
  ]);

  useEffect(() => {
    function onKeyDown(e) {
      if (!isPaletteKey(e)) return;
      e.preventDefault();
      requestPalette();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const matches = all.filter((c) => matchesQuery(c, query));
  const current = Math.min(active, Math.max(0, matches.length - 1));

  function run(command) {
    if (!command || !command.enabled()) return;
    setOpen(false);
    // Run after the dialog closes, so a command that opens its own dialog or moves focus keeps it.
    setTimeout(() => command.run(), 0);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') setActive((current + 1) % Math.max(1, matches.length));
    else if (e.key === 'ArrowUp') setActive((current - 1 + matches.length) % Math.max(1, matches.length));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(Math.max(0, matches.length - 1));
    else if (e.key === 'Enter') run(matches[current]);
    else return;
    e.preventDefault();
  }

  const optionId = (i) => `${listId}-option-${i}`;

  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="Commands" initialFocusRef={inputRef} className="w-[min(36rem,95vw)]">
      <div className="flex flex-col gap-2">
        <label htmlFor={`${listId}-input`} className="text-sm font-bold">
          Search commands
        </label>
        <input
          ref={inputRef}
          id={`${listId}-input`}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={matches.length > 0 ? optionId(current) : undefined}
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className={cx('min-h-8 rounded-ds border border-border-strong bg-surface px-2 text-sm', focusRing)}
        />
        <ul id={listId} role="listbox" aria-label="Commands" className="flex max-h-80 flex-col overflow-y-auto rounded-ds border border-border">
          {matches.map((c, i) => {
            const enabled = c.enabled();
            return (
              <li
                key={c.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === current}
                aria-disabled={!enabled || undefined}
                onPointerMove={() => setActive(i)}
                onClick={() => run(c)}
                className={cx(
                  'flex min-h-8 cursor-pointer items-center justify-between gap-4 px-2 text-sm',
                  i === current ? 'bg-selected text-selected-fg' : '',
                  enabled ? '' : 'opacity-50',
                )}
              >
                <span>
                  <span className={i === current ? '' : 'text-muted'}>{c.group}: </span>
                  {c.label}
                </span>
                {c.keys ? <kbd className="font-mono text-xs">{c.keys}</kbd> : null}
              </li>
            );
          })}
        </ul>
        <p aria-live="polite" className="text-sm text-muted">
          {matches.length === 0 ? 'No matching commands.' : `${matches.length} ${matches.length === 1 ? 'command' : 'commands'}`}
        </p>
      </div>
    </Dialog>
  );
}
