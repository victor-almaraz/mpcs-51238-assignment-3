import { controlBase, buttonVariants, cx, panelShadow } from '@/design-systems/industrial/classes';

/** ID of every page's <main>; the skip link targets it. */
export const MAIN_ID = 'main';

const skipLook = cx(
  'sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:min-h-8 focus:px-3',
  controlBase,
  buttonVariants.secondary,
  panelShadow,
);

/** First focusable element on every page; visible only while focused. */
export default function SkipLink() {
  return (
    <a href={`#${MAIN_ID}`} className={skipLook}>
      Skip to main content
    </a>
  );
}

/** A skip link that runs `onClick` (moving focus into a part of the page); visible only while focused. */
export function SkipButton({ onClick, children }) {
  return (
    <button type="button" onClick={onClick} className={skipLook}>
      {children}
    </button>
  );
}
