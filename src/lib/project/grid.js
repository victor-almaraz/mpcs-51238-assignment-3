/*
 * The snap grid of the timeline (ARR-04). It restarts at every bar line: its
 * points are each bar's start plus whole grid steps, and the next bar line. In
 * 7/8 with a 1/4 grid, bar 2 starts at 3.5 quarter notes, and the grid follows
 * it rather than tick 0. A step that is not finite (the Bar grid) leaves the
 * bar lines only. `meter` is a MeterMap.
 */

/** The bar containing tick `t` (t > 0, or t = 0): its start and the next bar line. */
function barSpan(meter, t) {
  const bar = meter.barAt(t);
  return [meter.tickAtBar(bar), meter.tickAtBar(bar + 1)];
}

/** Tick `t` (clamped at 0) moved to the nearest grid point of its bar, or to the bar line after it. */
export function snapToGrid(t, meter, step) {
  if (t <= 0) return 0;
  const [a, b] = barSpan(meter, t);
  const g = Number.isFinite(step) ? Math.min(b, a + Math.round((t - a) / step) * step) : a;
  return b - t < Math.abs(t - g) ? b : g;
}

/** The grid point after tick `t` (`dir` > 0) or before it (`dir` < 0, never below 0). */
export function nextGridTick(t, meter, step, dir) {
  if (dir > 0) {
    const [a, b] = barSpan(meter, Math.max(0, t));
    return Number.isFinite(step) ? Math.min(b, a + (Math.floor((Math.max(0, t) - a) / step) + 1) * step) : b;
  }
  if (t <= 0) return 0;
  const [a] = barSpan(meter, t - 1);
  return Number.isFinite(step) ? a + Math.floor((t - 1 - a) / step) * step : a;
}

/** The tick `steps` grid points from `t` (sign gives the direction). */
export function gridStepsFrom(t, meter, step, steps) {
  let at = t;
  for (let i = 0; i < Math.abs(steps); i++) at = nextGridTick(at, meter, step, Math.sign(steps));
  return at;
}
