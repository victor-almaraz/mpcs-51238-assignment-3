'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import IconButton from '@/components/ui/IconButton';
import { controlBase, controlSizes, cx, lamp, lampOff, selectedLook } from '@/design-systems/industrial/classes';
import { requestPalette, runCommand } from '@/lib/commands/registry';

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/projects', label: 'Projects' },
  { href: '/new', label: 'New project' },
  { href: '/settings', label: 'Settings' },
];

/** Removes a trailing slash so "/projects/" and "/projects" compare equal. */
function normalize(path) {
  return path.length > 1 ? path.replace(/\/$/, '') : path;
}

/**
 * Shared header on every route. The link for the current route carries
 * aria-current="page" and the lit-lamp look; other routes (the editor) match none.
 */
export default function SiteHeader() {
  const pathname = normalize(usePathname() ?? '');

  return (
    <header className="h-12 overflow-x-auto border-b border-border-strong bg-surface">
      <div className="flex h-full items-center gap-x-6 px-4">
        <span className="font-display text-lg font-bold uppercase">
          W-Rack
        </span>
        <nav aria-label="Main">
          <ul className="flex gap-2">
            {LINKS.map(({ href, label }) => {
              const current = pathname === href;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={current ? 'page' : undefined}
                    className={cx(
                      controlBase,
                      controlSizes.md,
                      lamp,
                      'pt-1',
                      current ? selectedLook : cx('border-border-strong bg-surface text-fg hover:border-fg hover:bg-hover', lampOff),
                    )}
                  >
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <IconButton icon="command" label="Commands" shortcut="Ctrl/Cmd+K" aria-keyshortcuts="Control+K Meta+K Control+Shift+P Meta+Shift+P" onClick={requestPalette} data-help="Commands (Ctrl/Cmd+K): search and run any command." />
          <IconButton icon="circle-question-mark" label="Keyboard shortcuts" shortcut="?" onClick={() => runCommand('help.shortcuts')} />
        </div>
      </div>
    </header>
  );
}
