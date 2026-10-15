/*
 * Note sequencing for one track (a3-audio-implementation.md, Engine block
 * loop; transport-and-timing.md, Event delivery). Notes arrive sorted by start
 * frame, then pitch. A second index orders them by end frame. Within a span
 * the instrument renders from event to event; at equal frames note-offs come
 * before note-ons. A note's ID is its index in the track's arrays.
 */

/** Index of the first element of `arr` (length `n`) that is ≥ `x`. */
function lowerBound(arr, n, x) {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Builds a sequencer track from validated note arrays (allocates; call outside
 * process()). `kernel` may be null for instrument types without a kernel.
 */
export function createTrack(kernel, notes) {
  const count = notes.start.length;
  const order = Int32Array.from({ length: count }, (_, i) => i).sort((a, b) => notes.end[a] - notes.end[b] || a - b);
  const endSorted = new Int32Array(count);
  for (let i = 0; i < count; i++) endSorted[i] = notes.end[order[i]];
  return {
    kernel,
    count,
    start: notes.start,
    end: notes.end,
    pitch: notes.pitch,
    vel: notes.vel,
    endOrder: order,
    endSorted,
    onCursor: 0,
    offCursor: 0,
  };
}

/** Points the track's cursors at `frame`: notes starting at or after it, note-offs after it. */
export function reseek(track, frame) {
  track.onCursor = lowerBound(track.start, track.count, frame);
  track.offCursor = lowerBound(track.endSorted, track.count, frame + 1);
}

/**
 * Renders `n` frames of the track into `buf[0..n)`, applying the note events
 * whose frames fall in [spanFrame, spanFrame + n) when `playing`.
 */
export function renderTrack(track, buf, n, spanFrame, playing) {
  const kernel = track.kernel;
  if (kernel === null) {
    buf.fill(0, 0, n);
    return;
  }
  let pos = 0;
  if (playing) {
    const spanEnd = spanFrame + n;
    for (;;) {
      const onFrame = track.onCursor < track.count ? track.start[track.onCursor] : Infinity;
      const offFrame = track.offCursor < track.count ? track.endSorted[track.offCursor] : Infinity;
      const isOff = offFrame <= onFrame;
      const frame = isOff ? offFrame : onFrame;
      if (frame >= spanEnd) break;
      const at = frame - spanFrame;
      if (at > pos) {
        kernel.render(buf, pos, at);
        pos = at;
      }
      if (isOff) {
        kernel.noteOff(track.endOrder[track.offCursor]);
        track.offCursor++;
      } else {
        const i = track.onCursor;
        kernel.noteOn(i, track.pitch[i], track.vel[i]);
        track.onCursor++;
      }
    }
  }
  if (pos < n) kernel.render(buf, pos, n);
}
