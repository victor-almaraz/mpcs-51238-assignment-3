import localFont from 'next/font/local';

/*
 * Self-hosted, open-licence fonts (licence in ./fonts/):
 *   League Mono Extended Bold (SIL OFL 1.1), display: wide capitals, like the silkscreened
 *   legends on a synth or control panel.
 *   League Mono Narrow (SIL OFL 1.1), interface text: a compact monospace in the manner of
 *   the technical manuals and typewriters.
 * Each defines a CSS variable that tokens.css reads into --ds-font-display and --ds-font-sans.
 */
const leagueMonoExtended = localFont({
  src: [{ path: './fonts/LeagueMono-ExtendedBold.woff2', weight: '700', style: 'normal' }],
  variable: '--font-ind-display',
  display: 'swap',
  fallback: ['ui-monospace', 'monospace'],
});

const leagueMonoNarrow = localFont({
  src: [
    { path: './fonts/LeagueMono-NarrowRegular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/LeagueMono-NarrowBold.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-ind-sans',
  display: 'swap',
  fallback: ['ui-monospace', 'monospace'],
});

/** Class for the element that carries data-ds="industrial". */
export const fontClassName = `${leagueMonoExtended.variable} ${leagueMonoNarrow.variable}`;
