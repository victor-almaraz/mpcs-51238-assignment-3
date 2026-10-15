import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { sectionHeading } from '@/design-systems/industrial/classes';

/** Home "Load" section. Opening .wrack archives is enabled with the archive reader. */
export default function LoadCard() {
  return (
    <Card as="section" aria-labelledby="home-load">
      <h2 id="home-load" className={sectionHeading}>
        Load
      </h2>
      <div>
        <Button size="lg" disabled>
          Open .wrack file
        </Button>
      </div>
    </Card>
  );
}
