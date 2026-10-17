/*
 * Command registry (accessibility.md, Command system): every operation the
 * palette lists is a named command { id, label, group, keys, run, enabled }.
 * Components register the commands they own while mounted; the palette reads
 * the current set. `keys` is the shortcut as shown ("Mod+E", "Space").
 */
const commands = new Map(); // id → command
const listeners = new Set();
let snapshot = [];
let paletteRequests = 0;

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

/** Asks the palette to open (the header button and the shortcut). */
export function requestPalette() {
  paletteRequests++;
  for (const listener of listeners) listener();
}

/** Counts palette requests (a useSyncExternalStore snapshot). */
export const getPaletteRequests = () => paletteRequests;

/** Words of `query` that all occur in the command's label or group, case-insensitively. */
export function matchesQuery(command, query) {
  const text = `${command.group} ${command.label}`.toLocaleLowerCase();
  return query
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word));
}
