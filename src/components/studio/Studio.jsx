'use client';

import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { pageHeading, sectionHeading } from '@/design-systems/industrial/classes';
import { trackLabel } from '@/lib/project/model';

/**
 * Placeholder editor: project header, track list and the empty-project hints.
 * Transport, piano roll and audio import replace the placeholders in later phases.
 * `unsavedCopy` marks an example copy that has not been edited yet.
 */
export default function Studio({ project, unsavedCopy }) {
  const tempo = project.tempo[0].bpm;
  const { numerator, denominator } = project.meter[0];
  const hasClips = Object.keys(project.clips).length > 0;

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className={pageHeading}>{project.name}</h1>
        <p className="text-sm text-muted">
          {tempo} BPM · {numerator}/{denominator}
          {unsavedCopy ? ' · Copy of example — saved on first edit' : null}
        </p>
      </div>

      <section aria-labelledby="studio-transport" className="flex flex-col gap-2">
        <h2 id="studio-transport" className={sectionHeading}>
          Transport
        </h2>
        <p>Stopped</p>
        {unsavedCopy ? <p>Press Play to hear this example</p> : null}
      </section>

      <Card as="section" aria-labelledby="studio-tracks">
        <h2 id="studio-tracks" className={sectionHeading}>
          Tracks
        </h2>
        <ul className="flex flex-col gap-1">
          {project.trackOrder.map((id, i) => (
            <li key={id}>{trackLabel(project, id, i + 1)}</li>
          ))}
        </ul>
        {hasClips ? null : (
          <div className="flex flex-col gap-3">
            <p>Press a key or click the grid to add a note</p>
            <div>
              <Button disabled>Add audio file</Button>
            </div>
            <section aria-labelledby="studio-keyboard-map" className="flex flex-col gap-1">
              <h3 id="studio-keyboard-map" className={sectionHeading}>
                Keyboard map
              </h3>
              <p className="text-sm">
                Keys A to K play the notes C to C. Z and X move the keyboard down or up an octave.
              </p>
            </section>
          </div>
        )}
      </Card>
    </>
  );
}
