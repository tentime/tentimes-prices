import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPriceCurve} from '../lib/price-curve.mjs';

const DAY = 86_400_000;
const point = (day, price) => ({time: day * DAY, price, precision: 'day'});
const curve = (rows, start, end, maxGap = 2 * DAY) => buildPriceCurve(rows, {start: start * DAY, end: end * DAY, maxGap});

test('sparse archives connect singleton quotes without manufacturing observations', () => {
  const rows = [point(0, 10), point(30, 20), point(60, 30)];
  const original = structuredClone(rows);
  const result = curve(rows, 0, 60);
  assert.equal(result.bridges.length, 2);
  assert.deepEqual(result.samples, rows);
  assert.equal(result.projection, null);
  assert.deepEqual(rows, original);
});

test('a gap crossing the range boundary is clipped without adding a hover quote', () => {
  const result = curve([point(0, 10), point(30, 40)], 10, 30);
  assert.deepEqual(result.samples, [point(30, 40)]);
  assert.deepEqual(result.bridges, [[pointWithoutPrecision(10, 20), point(30, 40)]]);
  assert.equal(result.projection, null);
});

function pointWithoutPrecision(day, price) { return {time: day * DAY, price}; }

test('failed quotes split solid paths and estimates never fill an area', () => {
  const result = curve([point(0, 10), point(1, null), point(2, 12)], 0, 2, 3 * DAY);
  assert.deepEqual(result.segments.map(path => path.length), [1, 1]);
  assert.equal(result.bridges.length, 1);
  assert.equal(result.samples.length, 2);
});

test('empty recent ranges project a known trend while hover samples remain empty', () => {
  const result = curve([point(0, 10), point(10, 20), point(20, 30)], 30, 40);
  assert.deepEqual(result.samples, []);
  assert.equal(result.projection.method, 'linear');
  assert.equal(result.projection.since, 20 * DAY);
  assert.deepEqual(result.projection.points, [pointWithoutPrecision(30, 40), pointWithoutPrecision(40, 50)]);
});

test('forecast is independent of selected range and snapshot frequency', () => {
  const rows = [point(-200, 1000), point(0, 10), point(10, 20), point(20, 30)];
  const sparse = curve(rows, 0, 40);
  const frequent = curve([...rows, ...Array.from({length: 100}, () => point(10, 20))], 30, 40);
  assert.deepEqual(sparse.projection.points.at(-1), frequent.projection.points.at(-1));
  assert.equal(frequent.samples.length, 0);
});

test('insufficient history and impossible negative projections hold the last known price', () => {
  for (const rows of [[point(0, 12)], [point(0, 30), point(10, 20), point(20, 10)]]) {
    const result = curve(rows, 40, 50);
    assert.equal(result.projection.method, 'hold');
    assert.deepEqual(result.projection.points.map(point => point.price), [rows.at(-1).price, rows.at(-1).price]);
  }
});

test('no estimates before first quote, beyond current time, or for fresh quotes', () => {
  const result = curve([point(10, 20), point(11, 21), point(100, 1)], 0, 12);
  assert.equal(result.projection, null);
  assert.deepEqual(result.samples.map(point => point.time), [10 * DAY, 11 * DAY]);
  assert.equal(result.bridges.length, 0);
  assert.equal(result.segments[0][0].time, 10 * DAY);
  assert.deepEqual(curve([], 0, 12), {samples: [], segments: [], bridges: [], projection: null});
});
