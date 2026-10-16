import OpenArchive from '@/components/archive/OpenArchive';
import Card from '@/components/ui/Card';
import { sectionHeading } from '@/design-systems/industrial/classes';

/** Home "Load" section: opens a .wrack file as a saved project. */
export default function LoadCard() {
  return (
    <Card as="section" aria-labelledby="home-load">
      <h2 id="home-load" className={sectionHeading}>
        Load
      </h2>
      <OpenArchive size="lg" />
    </Card>
  );
}
