'use client';

import { useState } from 'react';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

const UNITS = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "3 days ago", "yesterday", "just now" for `iso` relative to `now` (ms). */
export function relativeText(iso, now) {
  const s = (Date.parse(iso) - now) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(s) >= size) return relativeFormat.format(Math.round(s / size), unit);
  }
  return 'just now';
}

/** Metadata line of a project index entry: tempo, time signature and track count, where stored. */
export function metadataText(entry) {
  const parts = [];
  if (typeof entry.bpm === 'number') parts.push(`${entry.bpm} BPM`);
  if (entry.timeSignature) parts.push(entry.timeSignature);
  if (Number.isInteger(entry.trackCount)) parts.push(`${entry.trackCount} ${entry.trackCount === 1 ? 'track' : 'tracks'}`);
  return parts.join(' · ');
}

/**
 * "Edited 3 days ago (12 Mar 2026, 14:05)" for `iso` relative to `now` (ms),
 * or "Edit date unknown" when `iso` is not a date.
 */
export function editedText(iso, now) {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return 'Edit date unknown';
  return `Edited ${relativeText(iso, now)} (${dateFormat.format(time)})`;
}

/** The aria-describedby value for row actions of `entry` shown with ProjectSummary `id`. */
export const describedBy = (entry, id) => (entry.origin ? `${id}-origin ${id}` : id);

/**
 * One saved project in a list (RET-01): name, origin badge ("From example:
 * Beat"), last-edited date both relative and absolute, and the metadata
 * line. Row actions take their description from describedBy(entry, id).
 */
export default function ProjectSummary({ entry, id }) {
  const [now] = useState(() => Date.now());
  const metadata = metadataText(entry);
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="truncate font-bold">{entry.name}</span>
        {entry.origin ? <span id={`${id}-origin`} className="rounded-ds border border-border-strong px-1.5 text-xs">From example: {entry.origin}</span> : null}
      </div>
      <span id={id} className="text-xs text-muted">
        {editedText(entry.modifiedAt, now)}
        {metadata ? ` · ${metadata}` : ''}
      </span>
    </div>
  );
}
