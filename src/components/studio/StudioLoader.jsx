'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { buttonVariants, controlBase, controlSizes, cx, pageHeading } from '@/design-systems/industrial/classes';
import { isUnsavedCopy, loadProject, openExampleCopy } from '@/lib/project/store';

const linkButton = cx(controlBase, controlSizes.md, buttonVariants.secondary);

function Opening() {
  return (
    <div className="p-4">
      <h1 className={pageHeading}>Opening project</h1>
    </div>
  );
}

const Studio = dynamic(() => import('./Studio'), { ssr: false, loading: Opening });

function subscribe(onChange) {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}

const getLocation = () => window.location.pathname + window.location.search;
const getServerLocation = () => null;

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

/**
 * Resolves what the editor route shows for `location` (path plus query):
 * { kind: 'project', doc, readOnly } | { kind: 'missing' } | { kind: 'error', message },
 * or null while the address bar does not yet show a project path.
 * A missing project with ?example=<slug> opens an unsaved copy of that example.
 */
function resolve(location, shellId) {
  const url = new URL(location, 'http://localhost');
  // During an in-app navigation the address bar can still hold the previous page's path.
  if (!url.pathname.startsWith('/projects/')) return null;
  const id = projectIdFromPath(url.pathname);
  if (id === null || id === shellId) return { kind: 'missing' };
  const loaded = loadProject(id);
  if (!loaded.ok) return { kind: 'error', message: loaded.error };
  if (loaded.value) return { kind: 'project', doc: loaded.value, readOnly: loaded.readOnly };
  const slug = url.searchParams.get('example');
  const copy = slug ? openExampleCopy(slug, id) : null;
  return copy ? { kind: 'project', doc: copy } : { kind: 'missing' };
}

/** A project that cannot open: the site's page column, a short heading, the reason and the ways on. */
function Problem({ title, detail }) {
  useEffect(() => {
    document.title = `${title} · Wrack`;
  }, [title]);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 overflow-y-auto px-4 py-8">
      <h1 className={pageHeading}>{title}</h1>
      <p>{detail}</p>
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
    </div>
  );
}

/**
 * Client-only entry to the editor. The prerendered HTML shows "Opening project";
 * after hydration the address bar decides between the studio and a problem page.
 * `shellId` is the ID of the prerendered shell page, which is never a real project.
 */
export default function StudioLoader({ shellId }) {
  // Next.js client navigation changes the path without popstate; usePathname re-renders, and the store re-reads the address bar.
  usePathname();
  const location = useSyncExternalStore(subscribe, getLocation, getServerLocation);
  const state = useMemo(() => (location === null ? null : resolve(location, shellId)), [location, shellId]);
  if (state === null) return <Opening />;
  if (state.kind === 'missing') return <Problem title="Project not found" detail="No project with this address is saved on this device. Projects live in this browser only." />;
  if (state.kind === 'error') return <Problem title="Project could not open" detail={state.message} />;
  return <Studio key={state.doc.id} project={state.doc} unsavedCopy={isUnsavedCopy(state.doc.id)} readOnly={state.readOnly === true} />;
}
