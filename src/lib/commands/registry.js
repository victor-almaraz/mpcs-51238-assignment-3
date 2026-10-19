/*
 * Command registry (accessibility.md, Command system): every operation the
 * palette lists is a named command { id, label, group, keys, global, run,
 * enabled }. Components register the commands they own while mounted; the
 * palette reads the current set. `keys` is the shortcut as shown ("Mod+E",
 * "Space"); `altKeys` lists further shortcuts for the same command. A
 * `global` command's shortcut works anywhere on the page
 * (design-patterns.md, Keyboard shortcuts); other shortcuts belong to the
 * focused editor, which handles them itself.
 */
const commands = new Map(); // id → command
const listeners = new Set();
const claims = new Set(); // predicates for keys another handler takes first
let snapshot = [];
let paletteRequests = 0;
let paletteOpener = null;
let commandOpener = null;

function changed() {
  snapshot = [...commands.values()];
  for (const listener of listeners) listener();
}

/** Adds or replaces commands; returns a function that removes them. */
export function registerCommands(list) {
  for (const c of list) commands.set(c.id, c);
  changed();
  return () => {
    for (const c of list) if (commands.get(c.id) === c) commands.delete(c.id);
    changed();
  };
}

/** The registered commands, in registration order (a stable array between changes). */
export const getCommands = () => snapshot;

/** Subscribes to registry changes and palette requests. Returns an unsubscribe function. */
export function subscribeCommands(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True when command `id` is registered and enabled. */
export const commandEnabled = (id) => commands.get(id)?.enabled() ?? false;

/**
 * Runs command `id` when it is registered and enabled; returns whether it ran.
 * `opener` is the control that invoked it (a header button): a command that
 * opens a dialog reads it with getCommandOpener() while running and returns
 * focus to it on close.
 */
export function runCommand(id, opener = null) {
  if (!commandEnabled(id)) return false;
  commandOpener = opener;
  try {
    commands.get(id).run();
  } finally {
    commandOpener = null;
  }
  return true;
}

/** The opener passed to the runCommand call in progress, or null. */
export const getCommandOpener = () => commandOpener;

/**
 * Asks the palette to open (the header button and the shortcut). `opener` is
 * the element that receives focus when the palette closes; without one, focus
 * returns to the element focused before it opened.
 */
export function requestPalette(opener = null) {
  paletteRequests++;
  paletteOpener = opener;
  for (const listener of listeners) listener();
}

/** Counts palette requests (a useSyncExternalStore snapshot). */
export const getPaletteRequests = () => paletteRequests;

/** The opener of the latest palette request, or null. */
export const getPaletteOpener = () => paletteOpener;

/** Words of `query` that all occur in the command's label or group, case-insensitively. */
export function matchesQuery(command, query) {
  const text = `${command.group} ${command.label}`.toLocaleLowerCase();
  return query
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word));
}

/**
 * The shortcut text of keyboard event `e`, as written in `keys`: "Mod+Shift+E",
 * "Mod+,", "N", "?", "+". Ctrl and Cmd are both Mod. Shift is written only with
 * letters and named keys, since it already shapes symbols ("?" is Shift+/);
 * "=" reads as "+" and "_" as "-", so the plus and minus keys need no Shift.
 */
export function shortcutOf(e) {
  let key = e.key === ' ' ? 'Space' : e.key;
  if (key === '=') key = '+';
  else if (key === '_') key = '-';
  const letter = /^[a-z]$/i.test(key);
  if (letter) key = key.toUpperCase();
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Mod');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey && (letter || key.length > 1)) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

/**
 * Lets another handler take unmodified keys first while `predicate(e)` is true
 * (computer-keyboard notes take their letters). Returns a function that ends the claim.
 */
export function claimKeys(predicate) {
  claims.add(predicate);
  return () => claims.delete(predicate);
}

const TEXT_ENTRY = 'input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]), textarea, select, [contenteditable="true"], [role="combobox"], [role="menu"], [role="listbox"]';

/**
 * Runs the enabled global command whose shortcut is `e` and returns true.
 * Nothing runs for a key already handled, while a dialog is open, for a held
 * repeat, or for an unmodified key typed into a field, menu or list, or
 * claimed by another handler.
 */
export function dispatchShortcut(e) {
  if (e.defaultPrevented || e.repeat || e.isComposing) return false;
  if (typeof document !== 'undefined' && document.querySelector('dialog[open]')) return false;
  const modified = e.ctrlKey || e.metaKey || e.altKey;
  const inField = e.target?.closest?.(TEXT_ENTRY);
  if (!modified && (inField || [...claims].some((claimed) => claimed(e)))) return false;
  const key = shortcutOf(e);
  const command = snapshot.find((c) => c.global && (c.keys === key || c.altKeys?.includes(key)));
  // A field keeps the keys it uses itself (its own undo), for commands marked inFields: false.
  if (!command || (inField && command.inFields === false)) return false;
  e.preventDefault();
  if (command.enabled()) command.run();
  return true;
}

/** `keys` as shown to the user: Mod reads "Cmd" on Apple platforms and "Ctrl" elsewhere. */
export function displayKeys(keys) {
  const apple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return keys.replace(/\bMod\b/g, apple ? 'Cmd' : 'Ctrl');
}
