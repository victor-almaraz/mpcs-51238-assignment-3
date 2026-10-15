'use client';

import { pageHeading } from '@/design-systems/industrial/classes';

/** Placeholder editor: names the project it was opened for. */
export default function Studio({ projectId }) {
  return (
    <>
      <h1 className={pageHeading}>Project editor</h1>
      <p>
        Project ID: <code>{projectId}</code>
      </p>
    </>
  );
}
