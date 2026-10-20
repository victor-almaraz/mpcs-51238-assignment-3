import SiteHeader from '@/components/nav/SiteHeader';
import SkipLink from '@/components/nav/SkipLink';
import VolumeNotice from '@/components/VolumeNotice';
import CommandPalette from '@/components/commands/CommandPalette';
import ShortcutOverlay from '@/components/commands/ShortcutOverlay';
import TooltipLayer from '@/components/ui/TooltipLayer';
// Lighting Desk's font class includes Industrial's (its interface face), so either system switches on with data-ds alone.
import { fontClassName } from '@/design-systems/lighting-desk/fonts';
import './globals.css';

export const metadata = {
  title: {
    default: 'Wrack',
    template: '%s · Wrack',
  },
  description: 'An arrangement sketchpad that runs in the browser.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-ds="lighting-desk" className={fontClassName}>
      <body className="min-h-dvh bg-bg font-sans text-fg antialiased">
        <SkipLink />
        <SiteHeader />
        {children}
        <VolumeNotice />
        <CommandPalette />
        <ShortcutOverlay />
        <TooltipLayer />
      </body>
    </html>
  );
}
