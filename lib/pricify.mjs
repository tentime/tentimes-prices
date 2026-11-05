import {MEMORY_REFERENCES, PRICIFY_ROOT, PRICIFY_INDEX_URL, PRICIFY_PRODUCTS_URL} from './memory-catalog.mjs';

const DAY = 86_400_000;
const MAX_BYTES = 2_000_000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RAW_PATH = /^\/pricify-ai\/pc-hardware-prices\/(?:main|[a-f0-9]{40})\/(?:indices\/pricify-indices\.csv|latest\/json\/rams\.live\.json|data\/\d{4}\/W(?:0[1-9]|[1-4]\d|5[0-3])\/json\/rams\.live\.json)$/;

export class PricifyError extends Error {
  constructor(message) { super(message); this.name = 'PricifyError'; }
}
const fail = message => { throw new PricifyError(message); };
const validNumber = (value, maximum = 1_000_000) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= maximum;
const count = value => Number.isInteger(value) && value >= 0 && value <= 10_000_000;

export function assertPricifyDataUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('Invalid public dataset URL.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com' || url.port || url.username || url.password || url.search || url.hash || !RAW_PATH.test(url.pathname)) fail('Only the approved public Pricify data files are allowed.');
  return url.href;
}

function calendarDay(value, now) {
  if (typeof value !== 'string' || !DAY_PATTERN.test(value)) fail('A real calendar-day price date is required.');
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value || time > +now) fail('Invalid or future calendar-day price date.');
  return time;
}

function observation(day, price, evidenceUrl) {
  return {price, currency: 'USD', observedAt: `${day}T00:00:00.000Z`, sourceObservedAt: `${day}T00:00:00.000Z`, precision: 'day', inStock: null, evidenceUrl};
}

// Small RFC-4180 reader; never execute formulas or infer dates/numbers from text.
function csvRows(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BYTES) fail('Public index file is too large.');
  const rows = [], row = [];
  let field = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
      continue;
    }
    if (char === '"') {
      if (field || closed) fail('Malformed public index CSV.');
      quoted = true;
    } else if (char === ',') {
      row.push(field); field = ''; closed = false;
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push([...row]); row.length = 0; field = ''; closed = false;
      if (rows.length > 20_000) fail('Too many public index rows.');
    } else {
      if (closed) fail('Malformed public index CSV.');
      field += char;
    }
  }
  if (quoted) fail('Malformed public index CSV.');
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(columns => columns.some(Boolean));
}

export function parseIndexCSV(text, {now = new Date(), evidenceUrl = PRICIFY_INDEX_URL} = {}) {
  assertPricifyDataUrl(evidenceUrl);
  if (!evidenceUrl.endsWith('/indices/pricify-indices.csv')) fail('Memory index evidence must be the licensed index file.');
  const rows = csvRows(text.replace(/^\uFEFF/, ''));
  if (rows.shift()?.join(',') !== 'index,name,unit,day,value,level,measured') fail('Unexpected public index schema.');
  const result = Object.fromEntries(MEMORY_REFERENCES.filter(reference => reference.indexKey).map(reference => [reference.id, []]));
  const seen = new Set();
  for (const columns of rows) {
    if (columns.length !== 7) fail('Unexpected public index row shape.');
    const [key, name, unit, day, chain, level, measured] = columns;
    const reference = MEMORY_REFERENCES.find(reference => reference.indexKey === key);
    if (!reference) continue;
    calendarDay(day, now);
    if (name !== reference.indexName || unit !== '$/GB' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(level) || !validNumber(Number(level), 100_000) || !/^\d+$/.test(measured) || !count(Number(measured)) || Number(measured) === 0 || !validNumber(Number(chain))) fail('Public memory index identity, unit or value did not match.');
    const identity = `${key}:${day}`;
    if (seen.has(identity)) fail('Duplicate public index date.');
    seen.add(identity);
    result[reference.id].push(observation(day, Number(level), evidenceUrl));
  }
  for (const points of Object.values(result)) points.sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  return result;
}

function isoWeekStart(week) {
  const match = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/.exec(week || '');
  if (!match) fail('Invalid weekly release identity.');
  const jan4 = new Date(Date.UTC(Number(match[1]), 0, 4));
  const monday = +jan4 - ((jan4.getUTCDay() + 6) % 7) * DAY;
  const start = monday + (Number(match[2]) - 1) * 7 * DAY;
  // The ISO week-year is the year of its Thursday.
  if (new Date(start + 3 * DAY).getUTCFullYear() !== Number(match[1])) fail('Invalid ISO week.');
  return start;
}

export function parseMemoryRelease(document, {now = new Date(), evidenceUrl = PRICIFY_PRODUCTS_URL} = {}) {
  assertPricifyDataUrl(evidenceUrl);
  if (!evidenceUrl.endsWith('/json/rams.live.json')) fail('Memory product evidence must be the licensed release file.');
  if (!document || typeof document !== 'object' || Array.isArray(document) || document.dataset !== 'Pricify weekly PC hardware prices' || document.site !== 'rams.live' || document.currency !== 'USD' || document.timezone !== 'America/New_York' || document.license !== 'CC BY 4.0' || document.attribution !== 'Pricify (pricify.ai)') fail('Public memory release identity, currency, timezone or license did not match.');
  const start = calendarDay(document.from, now), end = calendarDay(document.to, now);
  if (end - start !== 6 * DAY || start !== isoWeekStart(document.week)) fail('Public memory release dates did not match its week.');
  const pathWeek = /\/data\/(\d{4})\/W(\d{2})\//.exec(new URL(evidenceUrl).pathname);
  if (pathWeek && document.week !== `${pathWeek[1]}-W${pathWeek[2]}`) fail('Historical file and release week did not match.');
  if (typeof document.generated !== 'string' || !Number.isFinite(Date.parse(document.generated)) || Date.parse(document.generated) > +now || Date.parse(document.generated) < end) fail('Invalid public release publication date.');
  if (!Array.isArray(document.products) || document.products.length > 2_000) fail('Invalid public product list.');
  const result = {}, seen = new Set();
  for (const product of document.products) {
    if (!product || !Number.isInteger(product.product_id) || product.product_id <= 0 || seen.has(product.product_id)) fail('Duplicate or invalid public product identity.');
    seen.add(product.product_id);
    const reference = MEMORY_REFERENCES.find(reference => reference.productId === product.product_id);
    if (!reference) continue;
    if (product.category !== 'ram' || product.name !== reference.productName || product.part_number !== reference.mpn || product.upc !== reference.upc || product.url !== reference.url) fail('Selected ECC RDIMM identity changed; no substitute was accepted.');
    if (!Array.isArray(product.daily) || product.daily.length > 7) fail('Invalid daily memory observations.');
    const days = new Set(), points = [];
    for (const row of product.daily) {
      const time = calendarDay(row?.date, now);
      if (time < start || time > end || days.has(row.date)) fail('Duplicate or out-of-release memory date.');
      days.add(row.date);
      if (!count(row.retailers_in_stock) || !count(row.shops_in_stock)) fail('Invalid published availability counts.');
      if (row.low == null) continue; // Missing data is never a zero-price or sold-out quote.
      if (!validNumber(row.low) || row.retailers_in_stock + row.shops_in_stock === 0 || typeof row.low_store !== 'string' || !row.low_store.trim() || row.low_store.length > 200) fail('Invalid in-stock daily memory price.');
      points.push({...observation(row.date, row.low, evidenceUrl), venue: row.low_store});
    }
    result[reference.id] = points.sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  }
  return {histories: result, publishedAt: document.generated, week: document.week};
}

function checkedHistory(points, now) {
  if (!Array.isArray(points) || points.length > 10_000) fail('Invalid stored memory history.');
  return points.map(point => {
    if (!point || point.currency !== 'USD' || point.precision !== 'day' || !validNumber(point.price) || !/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(point.observedAt || '')) fail('Stored history contains an invalid actual memory observation.');
    calendarDay(point.observedAt.slice(0, 10), now);
    assertPricifyDataUrl(point.evidenceUrl);
    if (point.sourceObservedAt != null && point.sourceObservedAt !== point.observedAt) fail('Stored quote date changed.');
    return {...point, sourceObservedAt: point.observedAt, inStock: null};
  });
}

export function mergeMemoryHistory(previous, incoming, now = new Date()) {
  const byDate = new Map();
  for (const point of [...checkedHistory(previous, now), ...checkedHistory(incoming, now)]) {
    const existing = byDate.get(point.observedAt);
    if (existing && (existing.price !== point.price || existing.currency !== point.currency || existing.precision !== point.precision)) fail('An already recorded public quote changed; existing history was retained.');
    if (!existing) byDate.set(point.observedAt, point);
  }
  return [...byDate.values()].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
}

function previousFor(reference, item, now) {
  if (!item) return [];
  const keys = Object.keys(reference.identity);
  if (item.source !== 'pricify' || item.category !== 'ram' || item.url !== reference.url || item.unit !== reference.unit || item.displayUnit !== 'GB' || item.priceDivisor !== reference.priceDivisor || item.capacityGB !== reference.capacityGB || !item.identity || Object.keys(item.identity).length !== keys.length || keys.some(key => item.identity[key] !== reference.identity[key])) fail('Stored memory series identity or price basis changed.');
  const history = mergeMemoryHistory([], item.history, now);
  if (history.some(point => reference.indexKey ? !point.evidenceUrl.endsWith('/indices/pricify-indices.csv') : !point.evidenceUrl.endsWith('/json/rams.live.json'))) fail('Stored history evidence does not match its memory series.');
  const latest = history.at(-1);
  if (item.price !== (latest?.price ?? null) || item.observedAt !== (latest?.observedAt ?? null)) fail('Stored headline price does not match its actual history.');
  return history;
}

async function readPublic(url, fetcher) {
  assertPricifyDataUrl(url);
  const response = await fetcher(url, {redirect: 'error', headers: {Accept: 'text/plain, application/json, text/csv'}, signal: AbortSignal.timeout(20_000)});
  if (!response.ok || response.redirected || Number(response.headers.get('content-length') || 0) > MAX_BYTES) fail('Public Pricify data could not be checked.');
  const reader = response.body?.getReader();
  if (!reader) fail('Public Pricify data returned an empty body.');
  const chunks = [], decoder = new TextDecoder();
  let size = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); fail('Public Pricify data exceeded the size limit.'); }
      chunks.push(decoder.decode(value, {stream: true}));
    }
    chunks.push(decoder.decode());
  } finally { reader.releaseLock(); }
  return chunks.join('');
}

/** Fetch only open-licensed GitHub releases; failed sources preserve actual quotes.
 * @param {{fetcher?: typeof fetch, now?: Date, previousItems?: any[]}} options
 */
export async function collectMemory({fetcher = fetch, now = new Date(), previousItems = []} = {}) {
  if (!Number.isFinite(+now) || !Array.isArray(previousItems)) fail('Invalid memory collection input.');
  const previous = new Map();
  for (const item of previousItems) {
    const reference = MEMORY_REFERENCES.find(reference => reference.id === item?.id);
    if (!reference) continue;
    if (previous.has(item.id)) fail('Duplicate stored memory series.');
    previous.set(item.id, {item, history: previousFor(reference, item, now)});
  }
  const results = await Promise.allSettled([
    readPublic(PRICIFY_INDEX_URL, fetcher).then(text => ({histories: parseIndexCSV(text, {now}), publishedAt: null, week: null})),
    readPublic(PRICIFY_PRODUCTS_URL, fetcher).then(text => {
      let document;
      try { document = JSON.parse(text); } catch { fail('Public memory release was not valid JSON.'); }
      return parseMemoryRelease(document, {now});
    }),
  ]);
  return MEMORY_REFERENCES.map(reference => {
    const prior = previous.get(reference.id);
    let history = prior?.history || [], error = null, success = false;
    const source = results[reference.indexKey ? 0 : 1];
    try {
      if (source.status !== 'fulfilled') throw source.reason;
      const incoming = source.value.histories[reference.id];
      if (!incoming?.length) fail('This selection is absent from the latest public release; the last recorded quote has been kept.');
      history = mergeMemoryHistory(history, incoming, now);
      success = true;
    } catch (cause) {
      error = cause instanceof PricifyError ? cause.message : 'Public Pricify data could not be checked. The last recorded price has been kept.';
    }
    const latest = history.at(-1);
    const age = latest ? +now - Date.parse(latest.observedAt) : Infinity;
    return {
      ...reference, history, price: latest?.price ?? null, observedAt: latest?.observedAt ?? null,
      sourceObservedAt: latest?.observedAt ?? null, inStock: null,
      status: !latest ? 'error' : error || age > reference.freshnessHours * 3_600_000 ? 'stale' : 'fresh',
      error, lastAttemptAt: now.toISOString(), lastSuccessAt: success ? now.toISOString() : prior?.item.lastSuccessAt || null,
      sourcePublishedAt: success && source.status === 'fulfilled' ? source.value.publishedAt : prior?.item.sourcePublishedAt || null,
      sourceReleaseWeek: success && source.status === 'fulfilled' ? source.value.week : prior?.item.sourceReleaseWeek || null,
    };
  });
}
