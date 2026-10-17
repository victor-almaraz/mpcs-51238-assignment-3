'use client';

import { usePathname } from 'next/navigation';
import { useRef, useState, useSyncExternalStore } from 'react';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import { cx, focusRing } from '@/design-systems/industrial/classes';
import { displayKeys, getCommands, subscribeCommands } from '@/lib/commands/registry';
import useCommands from './useCommands';
import IconButton from '@/components/ui/IconButton';

const EMPTY = [];

/** Keys of the focused editors, which handle them themselves (accessibility.md, Keyboard). */
const EDITOR_KEYS = [
  {
    title: 'Tracks and clips',
    keys: [
      ['Up, Down, Home, End', 'Move between tracks and clips'],
      ['Right, Left', 'Open or close a track'],
      ['M, S', 'Mute or solo the focused track'],
      ['Delete on a track', 'Delete the track'],
      ['Space', 'Select the focused clip'],
      ['Enter', 'Open the selected clip in the editor'],
      ['Left, Right', 'Move the clip by the grid'],
      ['Alt+Left, Alt+Right', 'Trim the clip start'],
      ['Alt+Shift+Left, Alt+Shift+Right', 'Trim the clip end'],
      ['Alt+Up, Alt+Down', 'Move the clip or track up or down'],
      ['Comma, Period', 'Move the edit cursor by the grid; with Shift, by a bar'],
      ['Shift+F10, Menu', 'Open the clip menu'],
      ['Delete', 'Delete the selected clips'],
    ],
  },
  {
    title: 'Piano roll',
    keys: [
      ['Arrows, Home, End', 'Move the cursor'],
      ['Enter', 'Add or remove a note'],
      ['Delete', 'Remove the note'],
      ['Alt+Arrows', 'Move the note'],
      ['Shift+Left, Shift+Right', 'Shorten or lengthen the note'],
      ['Shift+Up, Shift+Down', 'Raise or lower the velocity'],
      ['Q', 'Quantize the clip'],
      ['Up, Down, Page Up, Page Down', 'Velocity lane: change the selected note'],
      ['Shift+Left, Shift+Right', 'Velocity lane: previous or next note'],
    ],
  },
  {
    title: 'Keyboard notes',
    keys: [
      ['A W S E D F T G Y H U J K', 'Play C to C on the selected track'],
      ['Z, X', 'Octave down or up'],
    ],
    note: 'While Play with keyboard is on, these letters play notes, so G and K act as shortcuts only when it is off.',
  },
];

/** Commands with a shortcut, grouped by command group in registration order. */
function groupsOf(commands) {
  const groups = new Map();
  for (const c of commands) {
    if (!c.keys) continue;
    if (!groups.has(c.group)) groups.set(c.group, []);
    groups.get(c.group).push([displayKeys(c.keys), c.label]);
  }
  return [...groups].map(([title, keys]) => ({ title, keys }));
}

function KeyList({ title, keys, note }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-xs uppercase tracking-[0.06em] text-muted">{title}</h3>
      {/* One key-column width for every section, so the descriptions line up. */}
      <dl className="grid grid-cols-[12rem_1fr] gap-x-3 gap-y-0.5 text-sm">
        {keys.map(([key, text]) => (
          <div key={`${key}|${text}`} className="contents">
            <dt>
              <kbd className="font-mono text-xs">{key}</kbd>
            </dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
      {note ? <p className="text-xs text-muted">{note}</p> : null}
    </section>
  );
}

/**
 * Shortcut overlay (HELP-02): `?` opens a dialog listing every registered
 * command's shortcut by group, then, in the editor, the keys of the focused editors.
 */
export default function ShortcutOverlay() {
  const all = useSyncExternalStore(subscribeCommands, getCommands, () => EMPTY);
  // The focused-editor keys apply only in the editor (/projects/<id>).
  const inEditor = /^\/projects\/[^/]+/.test(usePathname() ?? '');
  const [open, setOpen] = useState(false);
  const closeRef = useRef(null);

  useCommands([{ id: 'help.shortcuts', group: 'Help', label: 'Keyboard shortcuts', keys: '?', global: true, run: () => setOpen(true) }]);

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      title="Keyboard shortcuts"
      initialFocusRef={closeRef}
      className="w-[min(60rem,95vw)]"
      actions={
        <Button ref={closeRef} onClick={() => setOpen(false)}>Close</Button>
      }
    >
      {/* The list scrolls on short windows, so it takes focus for keyboard scrolling. */}
      <div role="group" aria-label="Shortcut list" tabIndex={0} className={cx('grid max-h-[70dvh] gap-4 overflow-y-auto md:grid-cols-2', focusRing)}>
        {[...groupsOf(all), ...(inEditor ? EDITOR_KEYS : [])].map((g) => (
          <KeyList key={g.title} {...g} />
        ))}
      </div>
    </Dialog>
  );
}
