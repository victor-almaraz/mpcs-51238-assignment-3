import { MAIN_ID } from '@/components/nav/SkipLink';
import { pageHeading } from '@/design-systems/industrial/classes';

export const metadata = { title: 'Projects' };

export default function ProjectsPage() {
  return (
    <main id={MAIN_ID} tabIndex={-1} className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
      <h1 className={pageHeading}>Projects</h1>
    </main>
  );
}
