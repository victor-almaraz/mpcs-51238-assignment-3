'use client';

import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { sectionHeading } from '@/design-systems/industrial/classes';
import { EXAMPLES } from '@/lib/project/examples';
import { newProjectId } from '@/lib/project/store';

/**
 * Home "Examples" section. Opening an example navigates to a fresh project ID
 * with ?example=<slug>; the editor creates the unsaved copy. Cards play no sound.
 */
export default function ExampleCards() {
  const router = useRouter();

  function open(slug) {
    router.push(`/projects/${newProjectId()}?example=${slug}`);
  }

  return (
    <section aria-labelledby="home-examples" className="flex flex-col gap-3">
      <h2 id="home-examples" className={sectionHeading}>
        Examples
      </h2>
      <ul className="grid gap-3 sm:grid-cols-3">
        {EXAMPLES.map((example) => (
          <li key={example.slug} className="flex">
            <Card className="flex-1 justify-between">
              <div className="flex flex-col gap-2">
                <h3 className={sectionHeading}>{example.title}</h3>
                <p className="text-sm text-muted">{example.description}</p>
              </div>
              <div>
                <Button onClick={() => open(example.slug)}>Open {example.title}</Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
