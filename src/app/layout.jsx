import SiteHeader from '@/components/nav/SiteHeader';
import SkipLink from '@/components/nav/SkipLink';
import VolumeNotice from '@/components/VolumeNotice';
import CommandPalette from '@/components/commands/CommandPalette';
import ShortcutOverlay from '@/components/commands/ShortcutOverlay';
import TooltipLayer from '@/components/ui/TooltipLayer';
import { fontClassName } from '@/design-systems/industrial/fonts';
import './globals.css';

export const metadata = {
  title: {
    default: 'W-Rack',
    template: '%s · W-Rack',
  },
  description: 'An arrangement sketchpad that runs in the browser.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-ds="industrial" className={fontClassName}>
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
