import { createElement } from 'react';
import ICONS from './lucide';

/**
 * Decorative Lucide icon `name` (lucide.js) drawn in the current text color.
 * Always hidden from assistive technology: the control that holds it carries
 * the accessible name. `className` sets the size (default 16 px).
 */
export default function Icon({ name, className = 'size-4' }) {
  const shapes = ICONS[name];
  if (!shapes) throw new Error(`Unknown icon: ${name}`);
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      {shapes.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}
