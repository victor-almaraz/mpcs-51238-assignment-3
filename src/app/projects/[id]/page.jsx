import { MAIN_ID } from '@/components/nav/SkipLink';
import StudioLoader from '@/components/studio/StudioLoader';

/*
 * Project IDs are created in the browser, so the static export prerenders one
 * shell page. vercel.json rewrites every /projects/<id> to it, and StudioLoader
 * reads the ID from the address bar.
 */
export const dynamicParams = false;

/** ID of the one prerendered page; never a real project. */
const SHELL_ID = '_shell';

export function generateStaticParams() {
  return [{ id: SHELL_ID }];
}

export const metadata = { title: 'Project' };

export default function ProjectPage() {
  return (
    // The editor fills the viewport below the 48 px site header; its regions scroll inside it.
    <main id={MAIN_ID} tabIndex={-1} className="relative flex h-[calc(100dvh-3rem)] flex-col overflow-hidden">
      <StudioLoader shellId={SHELL_ID} />
    </main>
  );
}
