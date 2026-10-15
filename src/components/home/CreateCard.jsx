import Link from 'next/link';
import Card from '@/components/ui/Card';
import { buttonVariants, controlBase, controlSizes, cx, sectionHeading } from '@/design-systems/industrial/classes';

/** Home "Create" section: one link to the New project form. */
export default function CreateCard() {
  return (
    <Card as="section" aria-labelledby="home-create">
      <h2 id="home-create" className={sectionHeading}>
        Create
      </h2>
      <div>
        <Link href="/new" className={cx(controlBase, controlSizes.lg, buttonVariants.primary)}>
          New project
        </Link>
      </div>
    </Card>
  );
}
