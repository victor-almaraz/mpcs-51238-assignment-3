'use client';

import { useEffect, useRef, useState } from 'react';
import StatusRegion from '@/components/ui/StatusRegion';
import { cx, groupHeading } from '@/design-systems/industrial/classes';
import { GRANULAR_MAX_SOURCE_S } from '@/dsp/instruments/granular';
import { getSource, importFiles } from '@/lib/audio/decode';
import { getEngine } from '@/lib/audio/engine-client';
import { setGranularSource } from '@/lib/project/clip-commands';
import IconButton from '@/components/ui/IconButton';

/**
 * Granular File source: "Load audio file…", "Remove file" and the file's
 * status ("Audio not loaded: <name>" when it is in neither memory nor the
 * store). Grains read the first 20 s of the file, mixed to mono.
 */
export default function GranularSource({ project, device, onEdit, loading }) {
  const engine = getEngine();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const latest = useRef(project);
  useEffect(() => {
    latest.current = project;
  }, [project]);
  const ref = device.granular?.sourceId ? device.granular : null;
  const source = ref ? getSource(ref.sourceId) : null;

  function choose(entry) {
    const result = setGranularSource(latest.current, device.id, entry);
    if (!result.ok) {
      setMessage(result.error.message);
      return false;
    }
    onEdit(result.doc);
    return true;
  }

  async function load(files) {
    if (files.length === 0) return;
    setBusy(true);
    try {
      await importFiles(files.slice(0, 1), {
        rate: engine.decodeRate(),
        projectSources: latest.current.sources,
        onResult(result) {
          if (!result.ok) setMessage(result.message);
          else if (choose(result.source)) setMessage(result.message ?? `Loaded ${result.source.name}. Saved on this device.`);
        },
      });
    } finally {
      setBusy(false);
    }
  }

  let status;
  if (!ref) status = 'No file. Load an audio file for the File source.';
  else if (source) {
    const seconds = source.frames / source.rate;
    const used = seconds > GRANULAR_MAX_SOURCE_S ? `, first ${GRANULAR_MAX_SOURCE_S} s used` : '';
    status = `File: ${ref.sourceName}, ${seconds.toFixed(2)} s${used}, ${source.stored === 'device' ? 'Saved on this device' : 'Session only'}`;
  } else if (loading?.has(ref.sourceId)) status = `Loading ${ref.sourceName}…`;
  else status = `Audio not loaded: ${ref.sourceName}`;

  return (
    <section aria-labelledby={`granular-${device.id}-file`} className="flex flex-col gap-2">
      <h3 id={`granular-${device.id}-file`} className={groupHeading}>
        File source
      </h3>
      <p className={cx('text-sm', ref && !source ? 'font-bold' : '')}>{status}</p>
      <div className="flex flex-wrap items-end gap-2">
        <IconButton icon="upload" label={busy ? 'Loading file…' : 'Load audio file…'} onClick={() => fileRef.current?.click()} disabled={busy} />
        {ref ? <IconButton icon="x" label="Remove file" onClick={() => choose(null) && setMessage('File removed')} /> : null}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.oga"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const files = [...e.target.files];
          e.target.value = '';
          load(files);
        }}
      />
      <StatusRegion className="text-sm">{message}</StatusRegion>
    </section>
  );
}
