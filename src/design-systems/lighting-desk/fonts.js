import localFont from 'next/font/local';
import { fontClassName as industrialFonts } from '../industrial/fonts';

/*
 * Self-hosted, open-licence fonts (licence in ./fonts/):
 *   Ostrich Sans Black (SIL OFL 1.1), display: tall condensed capitals, like the signage on a
 *   Deco title card. Only page titles and the wordmark use it.
 *   Interface text is Industrial's League Mono Narrow: compact, with tabular figures.
 * Ostrich Sans defines --font-ld-display, which tokens.css reads into --ds-font-display; it is
 * not preloaded, so a page in another system never downloads it.
 */
const ostrichSans = localFont({
  src: [{ path: './fonts/OstrichSans-Black.woff', weight: '900', style: 'normal' }],
  variable: '--font-ld-display',
  display: 'swap',
  preload: false,
  fallback: ['Arial Narrow', 'sans-serif'],
});

/** Class for the element that carries data-ds="lighting-desk"; it includes Industrial's, for the interface face. */
export const fontClassName = `${ostrichSans.variable} ${industrialFonts}`;
