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
      <body className="min-h-dvh bg-bg font-sans text-fg antialiased">{children}</body>
    </html>
  );
}
