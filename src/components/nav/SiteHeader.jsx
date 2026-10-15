'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { controlBase, controlSizes, cx, lamp, lampOff, selectedLook } from '@/design-systems/industrial/classes';

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
    <header className="border-b border-border-strong bg-surface">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
        <span className="font-display text-lg font-bold uppercase">
          W-Rack
        </span>
        <nav aria-label="Main">
          <ul className="flex flex-wrap gap-2">
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
      </div>
    </header>
  );
}
