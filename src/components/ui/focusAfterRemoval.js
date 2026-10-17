/**
 * Keeps keyboard focus in place after a list row is removed: once the list
 * has rendered, focuses the control matching `selector` in the row that took
 * index `index` (else the new last row), or `fallback` when the list is empty.
 * `list` is a function returning the list element, which may be re-created.
 */
export function focusAfterRemoval(list, index, selector, fallback) {
  // Two frames: React commits the removal, then the dialog that asked finishes closing.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const rows = [...(list()?.querySelectorAll(':scope > li') ?? [])];
      const row = rows[Math.min(index, rows.length - 1)];
      (row?.querySelector(selector) ?? fallback())?.focus();
    }),
  );
}
