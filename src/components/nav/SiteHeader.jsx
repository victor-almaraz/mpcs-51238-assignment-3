'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import IconButton from '@/components/ui/IconButton';
import { controlBase, controlSizes, cx, selectedLook } from '@/design-systems/industrial/classes';
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
 * aria-current="page" and the pressed look; the link whose section holds the
 * route (Projects, for the editor at /projects/<id>) carries aria-current="true"
 * and an underline; the others are quiet links. The Commands and Keyboard shortcuts
 * buttons pass themselves as the opener, so focus returns to them on close.
 */
export default function SiteHeader() {
  const pathname = normalize(usePathname() ?? '');

  return (
    <header className="h-12 overflow-x-auto border-b border-border-strong bg-surface">
      <div className="flex h-full items-center gap-x-6 px-4">
        <span className="shrink-0 font-display text-lg font-bold whitespace-nowrap uppercase">
          Wrack
        </span>
        <nav aria-label="Main">
          <ul className="flex gap-2">
            {LINKS.map(({ href, label }) => {
              const current = pathname === href;
              const section = !current && href !== '/' && pathname.startsWith(`${href}/`);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={current ? 'page' : section ? 'true' : undefined}
                    className={cx(
                      controlBase,
                      controlSizes.md,
                      current ? selectedLook : 'border-transparent bg-transparent text-fg hover:bg-hover',
                      section && 'underline decoration-2 underline-offset-4',
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
          <IconButton icon="command" label="Commands" shortcut="Ctrl/Cmd+K" aria-keyshortcuts="Control+K Meta+K Control+Shift+P Meta+Shift+P" onClick={(e) => requestPalette(e.currentTarget)} data-help="Commands (Ctrl/Cmd+K): search and run any command." />
          <IconButton icon="circle-question-mark" label="Keyboard shortcuts" shortcut="?" onClick={(e) => runCommand('help.shortcuts', e.currentTarget)} />
        </div>
      </div>
    </header>
  );
}
