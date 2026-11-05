const DAY = 86_400_000;

/** @typedef {{time: number, price: number, precision?: 'day' | 'instant'}} Sample */
/** @typedef {{time: number, price: number | null, precision?: 'day' | 'instant'}} Row */

/** Clip a path to the visible dates without creating observed quotes. @param {Sample[]} path */
function clip(path, start, end) {
  if (!path.length || path.at(-1).time < start || path[0].time > end) return [];
  const result = [];
  for (let i = 0; i < path.length; i++) {
    const point = path[i];
    const previous = path[i - 1];
    if (previous && previous.time < start && point.time > start) result.push(between(previous, point, start));
    if (point.time >= start && point.time <= end) result.push(point);
    if (previous && previous.time < end && point.time > end) result.push(between(previous, point, end));
  }
  return result;
}

/** @param {Sample} a @param {Sample} b */
function between(a, b, time) {
  return {time, price: a.price + (b.price - a.price) * (time - a.time) / (b.time - a.time)};
}

/** A display-only estimate, anchored at the last quote. @param {Sample[]} samples */
function project(samples, start, end, maxGap) {
  const last = samples.at(-1);
  if (!last || end - last.time <= maxGap) return null;
  // One quote per UTC day prevents frequent snapshots from dominating the fit.
  const days = new Map();
  for (const point of samples) if (point.time >= last.time - 90 * DAY) days.set(Math.floor(point.time / DAY), point);
  const recent = [...days.values()];
  let slope = 0;
  let method = 'hold';
  if (recent.length >= 3 && last.time - recent[0].time >= 7 * DAY) {
    const xs = recent.map(point => (point.time - last.time) / DAY);
    const meanX = xs.reduce((sum, x) => sum + x, 0) / xs.length;
    const meanY = recent.reduce((sum, point) => sum + point.price, 0) / recent.length;
    const variance = xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
    slope = xs.reduce((sum, x, i) => sum + (x - meanX) * (recent[i].price - meanY), 0) / variance;
    method = 'linear';
  }
  const predicted = last.price + slope * (end - last.time) / DAY;
  // A line that predicts a nonpositive price is not useful; carry the quote instead.
  if (!Number.isFinite(predicted) || predicted <= 0) { slope = 0; method = 'hold'; }
  const from = Math.max(start, last.time);
  return {method, since: last.time, points: [from, end].map(time => ({time, price: last.price + slope * (time - last.time) / DAY}))};
}

/** Build render geometry; returned samples remain actual observations only.
 * @param {Row[]} rows
 * @param {{start: number, end: number, maxGap: number}} options
 */
export function buildPriceCurve(rows, {start, end, maxGap}) {
  const ordered = rows.filter(row => Number.isFinite(row.time) && row.time <= end).slice().sort((a, b) => a.time - b.time);
  /** @type {Sample[][]} */
  const allSegments = [];
  /** @type {Sample[]} */
  const allSamples = [];
  let interrupted = true;
  for (const row of ordered) {
    if (row.price == null || !Number.isFinite(row.price) || row.price <= 0) { interrupted = true; continue; }
    const sample = {...row, price: row.price};
    const previous = allSamples.at(-1);
    if (interrupted || !previous || sample.time - previous.time > maxGap) allSegments.push([sample]);
    else allSegments.at(-1).push(sample);
    allSamples.push(sample);
    interrupted = false;
  }
  const bridges = allSegments.slice(1).map((segment, index) => clip([allSegments[index].at(-1), segment[0]], start, end)).filter(path => path.length > 1);
  return {
    samples: allSamples.filter(point => point.time >= start),
    segments: allSegments.map(segment => clip(segment, start, end)).filter(path => path.length),
    bridges,
    projection: project(allSamples, start, end, maxGap),
  };
}
