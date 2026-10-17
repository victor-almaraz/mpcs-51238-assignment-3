/*
 * Shared class strings for the Industrial components (not a component).
 * Class names are written out in full so Tailwind's scanner finds them.
 * Selected (pressed/checked) styling is chosen in JS from the component's
 * props rather than with aria-pressed:/peer-checked: variants, so it can never
 * lose a specificity tie against hover:/active: (both would be 0-2-0).
 *
 * The look: flat panel faces with silkscreened capitals, light key caps, and an
 * indicator lamp along the top edge of every toggle that lights when it is on.
 */

/** Joins truthy class names; the caller's className is passed last. */
export function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export const peerFocusRing =
  'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus';

export const disabledState = 'disabled:cursor-not-allowed disabled:opacity-40';

/** Silkscreened legends: compact monospace capitals. */
export const controlType = 'text-[0.8125rem] font-bold uppercase tracking-[0.06em]';

export const controlBase = `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-ds border text-center ${controlType} select-none enabled:cursor-pointer motion-safe:transition-colors motion-safe:duration-100 ${focusRing} ${disabledState}`;

/** Chips: the same legends a step smaller, so a widget header fits on one row. */
export const chipBase = `inline-flex items-center justify-center gap-2 rounded-ds border text-center text-xs font-bold uppercase tracking-[0.04em] select-none enabled:cursor-pointer motion-safe:transition-colors motion-safe:duration-100 ${focusRing} ${disabledState}`;

/** sm 24 px, md 32 px, lg 44 px minimum targets. */
export const controlSizes = {
  sm: 'min-h-6 min-w-6 px-2',
  md: 'min-h-8 min-w-8 px-3',
  lg: 'min-h-11 min-w-11 px-4 lg:px-5',
};

export const iconSizes = {
  sm: 'min-h-6 min-w-6',
  md: 'min-h-8 min-w-8',
  lg: 'min-h-11 min-w-11',
};

/** Indicator lamp along the top edge of a toggle; pair with lampOn or lampOff. */
export const lamp =
  "relative before:pointer-events-none before:absolute before:top-[3px] before:left-1/2 before:h-[3px] before:w-3 before:-translate-x-1/2 before:rounded-full before:content-['']";
export const lampOn = 'before:bg-lamp';
export const lampOff = 'before:bg-lamp-off';

/** Hard, short shadow under floating panels (menus, toasts, dialogs). */
export const panelShadow = 'shadow-[3px_3px_0_rgb(30_32_26/0.22)]';

export const buttonVariants = {
  /* Signal orange with an ink outline, so its edge holds on the light ground. */
  primary:
    'border-fg bg-accent text-accent-fg enabled:hover:bg-accent-hover enabled:active:bg-accent enabled:active:shadow-[inset_0_2px_4px_rgb(0_0_0/0.35)]',
  secondary:
    'border-border-strong bg-surface text-fg enabled:hover:border-fg enabled:hover:bg-hover enabled:active:bg-active',
  ghost: 'border-transparent bg-transparent text-fg enabled:hover:bg-hover enabled:active:bg-active',
  /*
   * Panic: an emergency stop. Red cap, white legend, and a yellow collar drawn inside the
   * button's own 44 px box (a 2 px border) with a 1 px dark edge, so Panic matches the height
   * of its neighbours; the focus ring sits just outside the edge.
   */
  danger:
    'border-2 border-collar bg-danger text-white shadow-[0_0_0_1px_var(--ds-fg)] focus-visible:outline-offset-[3px]! enabled:hover:bg-[color-mix(in_oklch,var(--ds-danger)_88%,white)] enabled:active:shadow-[inset_0_2px_5px_rgb(0_0_0/0.4),0_0_0_1px_var(--ds-fg)]',
};

/** Pressed / checked look: ink cap, light legend, lit lamp. */
export const selectedLook = `border-selected bg-selected text-selected-fg ${lampOn}`;

/** Unpressed toggle look (button elements only, uses :enabled); the lamp is off. */
export const unselectedLook = `border-border-strong bg-surface text-fg enabled:hover:border-fg enabled:hover:bg-hover enabled:active:bg-active ${lampOff}`;

/** Secondary look for non-button elements (labels) that have no :enabled state. */
export const secondaryLabelLook =
  'border-border-strong bg-surface text-fg hover:border-fg hover:bg-hover active:bg-active';

/** Field labels beside sliders, selects and segmented controls: small silkscreened capitals. */
export const fieldLabel = 'w-24 shrink-0 text-[0.6875rem] font-bold uppercase tracking-[0.04em] text-muted';

/** Field labels above their control (one-column forms). */
export const fieldLabelStacked = 'text-[0.6875rem] font-bold uppercase tracking-[0.04em] text-muted';

/** A readout window: dark glass, amber digits. */
export const readout = 'rounded-ds bg-window text-lamp tabular-nums';

/** Page title (h1): the wide display face, like a panel's model legend. */
export const pageHeading =
  'font-display text-[1.75rem] leading-none font-bold uppercase tracking-[0.01em] sm:text-5xl';

/** Section heading (h2 and below): compact bold capitals. */
export const sectionHeading = 'font-sans text-sm leading-tight font-bold uppercase';

/** Error text: danger ink on the danger tint (4.9:1); danger ink on the page ground is 4.4:1. */
export const errorText = 'flex items-start gap-1 rounded-ds bg-danger-bg px-2 py-1 text-sm text-danger';
