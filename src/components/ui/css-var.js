/** The value of CSS custom property `name` on the root element, or `fallback` outside the browser or when unset. */
export function cssVar(name, fallback) {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
