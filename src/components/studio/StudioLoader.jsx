'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { buttonVariants, controlBase, controlSizes, cx, pageHeading } from '@/design-systems/industrial/classes';

const linkButton = cx(controlBase, controlSizes.md, buttonVariants.secondary);

function Opening() {
  return <h1 className={pageHeading}>Opening project</h1>;
}

const Studio = dynamic(() => import('./Studio'), { ssr: false, loading: Opening });

function subscribe(onChange) {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}

const getPathname = () => window.location.pathname;
const getServerPathname = () => null;

/**
 * Returns the project ID in a /projects/<id> path, or null when the path has
 * none or its ID is not valid percent-encoding.
 */
export function projectIdFromPath(pathname) {
  const match = /^\/projects\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch (err) {
    if (err instanceof URIError) return null;
    throw err;
  }
}

function ProjectNotFound() {
  return (
    <>
      <h1 className={pageHeading}>Project not found</h1>
      <ul className="flex flex-wrap gap-2">
        <li>
          <Link href="/projects" className={linkButton}>
            Projects
          </Link>
        </li>
        <li>
          <Link href="/new" className={linkButton}>
            New project
          </Link>
        </li>
      </ul>
    </>
  );
}

/**
 * Client-only entry to the editor. The prerendered HTML shows "Opening project";
 * after hydration the address bar decides between the studio and "Project not found".
 * `shellId` is the ID of the prerendered shell page, which is never a real project.
 */
export default function StudioLoader({ shellId }) {
  const pathname = useSyncExternalStore(subscribe, getPathname, getServerPathname);
  if (pathname === null) return <Opening />;
  const projectId = projectIdFromPath(pathname);
  if (projectId === null || projectId === shellId) return <ProjectNotFound />;
  return <Studio projectId={projectId} />;
}
