'use client';

import Link from 'next/link';
import Card from '@/components/ui/Card';
import { buttonVariants, controlBase, controlSizes, cx, sectionHeading } from '@/design-systems/industrial/classes';

const RECENT_LIMIT = 5;

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Home "Recent" section: up to five saved projects, most recently edited first,
 * each with its name, last-edited date and "Continue". `projects` comes from
 * listProjects(); the caller hides the section when it is empty.
 */
export default function RecentList({ projects }) {
  return (
    <Card as="section" aria-labelledby="home-recent">
      <h2 id="home-recent" className={sectionHeading}>
        Recent
      </h2>
      <ul className="flex flex-col divide-y divide-border">
        {projects.slice(0, RECENT_LIMIT).map((p) => {
          const edited = dateFormat.format(new Date(p.modifiedAt));
          return (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-bold">{p.name}</span>
                <span className="text-xs text-muted">Edited {edited}</span>
              </div>
              <Link
                href={`/projects/${p.id}`}
                aria-label={`Continue ${p.name}, edited ${edited}`}
                className={cx(controlBase, controlSizes.md, buttonVariants.secondary)}
              >
                Continue
              </Link>
            </li>
          );
        })}
      </ul>
      {projects.length > RECENT_LIMIT ? (
        <Link href="/projects" className="text-sm font-bold underline underline-offset-2">
          View all projects
        </Link>
      ) : null}
    </Card>
  );
}
