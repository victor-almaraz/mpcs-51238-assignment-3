/*
 * Shared class strings for the UI components (not a component), used by both
 * design systems: Industrial and Lighting Desk (the app's), whose tokens set the colours.
 * Class names are written out in full so Tailwind's scanner finds them.
 * Selected (pressed/checked) styling is chosen in JS from the component's
 * props rather than with aria-pressed:/peer-checked: variants, so it can never
 * lose a specificity tie against hover:/active: (both would be 0-2-0).
 *
 * The look: flat panel faces and key caps. Flair follows mechanical
 * importance (design-patterns.md, Visual hierarchy): indicator lamps, readout
 * windows and the emergency-stop Panic belong to the transport, the master
 * level and safety; everything else is quiet: sentence-case regular legends,
 * filled pressed caps and plain values. Bold is kept for page
 * and panel titles; small capitals mark structure (group headings), not controls.
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

/** Control legends: regular weight, sentence case. */
export const controlType = 'text-[0.8125rem]';

export const controlBase = `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-ds border text-center ${controlType} select-none enabled:cursor-pointer motion-safe:transition-colors motion-safe:duration-100 ${focusRing} ${disabledState}`;


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

/** Indicator lamp along the top edge of a transport toggle (tier 1 only); pair with lampOn or lampOff. */
export const lamp =
  "relative before:pointer-events-none before:absolute before:top-[3px] before:left-1/2 before:h-[3px] before:w-3 before:-translate-x-1/2 before:rounded-full before:content-['']";
/* A lit lamp sits in a window-coloured bezel, so it holds on a light pressed cap as on a dark one. */
export const lampOn = 'before:bg-lamp before:shadow-[0_0_0_1px_var(--ds-window)]';
export const lampOff = 'before:bg-lamp-off';

/** Hard shadow under floating panels (menus, toasts, dialogs); each system sets --ds-panel-shadow. */
export const panelShadow = 'shadow-(--ds-panel-shadow)';

export const buttonVariants = {
  /* The accent with an fg outline, so its edge holds where the accent alone is low on the ground. */
  primary:
    'border-fg bg-accent text-accent-fg enabled:hover:bg-accent-hover enabled:active:bg-accent enabled:active:shadow-[inset_0_2px_4px_rgb(0_0_0/0.35)]',
  secondary:
    'border-border-strong bg-surface text-fg enabled:hover:border-fg enabled:hover:bg-hover enabled:active:bg-active',
  ghost: 'border-transparent bg-transparent text-fg enabled:hover:bg-hover enabled:active:bg-active',
  /*
   * Panic: an emergency stop. Red cap, light legend (danger-fg), and a yellow collar drawn inside the
   * button's own 44 px box (a 2 px border) with a 1 px dark edge, so Panic matches the height
   * of its neighbours; the focus ring sits just outside the edge.
   */
  danger:
    'border-2 border-collar bg-danger text-danger-fg shadow-[0_0_0_1px_var(--ds-fg)] focus-visible:outline-offset-[3px]! enabled:hover:bg-[color-mix(in_oklch,var(--ds-danger)_88%,white)] enabled:active:shadow-[inset_0_2px_5px_rgb(0_0_0/0.4),0_0_0_1px_var(--ds-fg)]',
};

/** Pressed / checked look: ink cap, light legend. Transport toggles add a lit lamp. */
export const selectedLook = 'border-selected bg-selected text-selected-fg';

/** Unpressed toggle look (button elements only, uses :enabled). */
export const unselectedLook = 'border-border-strong bg-surface text-fg enabled:hover:border-fg enabled:hover:bg-hover enabled:active:bg-active';


/** Field labels beside sliders, selects and segmented controls: small, regular, muted. */
export const fieldLabel = 'w-24 shrink-0 text-xs text-muted';

/** Field labels above their control (one-column forms). */
export const fieldLabelStacked = 'text-xs text-muted';

/** A readout window: dark glass, lamp-coloured digits. Tier 1 only: transport position, master level. */
export const readout = 'rounded-ds bg-window text-lamp tabular-nums';

/** A plain value readout (parameters, track levels): ink digits on the panel. */
export const valueReadout = 'rounded-ds bg-bg text-fg tabular-nums';

/**
 * Type: page titles in the display face; panel and dialog titles in bold sentence case; small
 * capitals (groupHeading) only for structure and status badges; 0.625rem only for meter and
 * fader scales.
 */

/** Page title (h1 of a route page): the display face, like a panel's model legend. Only page titles and the wordmark use it. */
export const pageHeading =
  'font-display text-[1.75rem] leading-none font-bold uppercase tracking-[0.01em] sm:text-5xl';

/** Panel and dialog heading (h2): compact bold, sentence case. */
export const sectionHeading = 'font-sans text-sm leading-tight font-bold';

/** Group heading (h3, h4, legends inside a panel, list group labels, status badges): small regular capitals, muted. */
export const groupHeading = 'font-sans text-[0.6875rem] leading-tight uppercase tracking-[0.06em] text-muted';

/** Error text: danger ink on the danger tint (4.9:1); danger ink on the page ground is 4.4:1. */
export const errorText = 'flex items-start gap-1 rounded-ds bg-danger-bg px-2 py-1 text-sm text-danger';
