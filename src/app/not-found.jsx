import Link from 'next/link';
import { MAIN_ID } from '@/components/nav/SkipLink';
import { buttonVariants, controlBase, controlSizes, cx, pageHeading } from '@/design-systems/industrial/classes';

export const metadata = { title: 'Page not found' };

const linkButton = cx(controlBase, controlSizes.md, buttonVariants.secondary);

export default function NotFound() {
  return (
    <main id={MAIN_ID} tabIndex={-1} className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
      <h1 className={pageHeading}>Page not found</h1>
      <p>This address does not match a Wrack page.</p>
      <ul className="flex flex-wrap gap-2">
        <li>
          <Link href="/" className={linkButton}>
            Home
          </Link>
        </li>
        <li>
          <Link href="/projects" className={linkButton}>
            Projects
          </Link>
        </li>
      </ul>
    </main>
  );
}
