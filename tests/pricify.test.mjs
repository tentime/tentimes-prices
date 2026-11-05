import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MEMORY_REFERENCES, PRICIFY_INDEX_URL, PRICIFY_PRODUCTS_URL, PRICIFY_REVISION} from '../lib/memory-catalog.mjs';
import {collectMemory, parseIndexCSV, parseMemoryRelease, mergeMemoryHistory, assertPricifyDataUrl} from '../lib/pricify.mjs';

const now = new Date('2026-11-05T23:00:00Z');
const bootstrap = JSON.parse(await readFile(new URL('../public/data/memory-bootstrap.json', import.meta.url), 'utf8'));
const clone = value => structuredClone(value);
const csv = (ddr5 = '18.0622', ddr4 = '9.8747') => `index,name,unit,day,value,level,measured\nddr5,DDR5 memory,$/GB,2026-11-01,103.9732,${ddr5},657\nddr4,DDR4 memory,$/GB,2026-11-01,101.0535,${ddr4},320\n`;

function release() {
  return {
    dataset: 'Pricify weekly PC hardware prices', site: 'rams.live', week: '2026-W44',
    from: '2026-10-26', to: '2026-11-01', timezone: 'America/New_York', currency: 'USD',
    license: 'CC BY 4.0', attribution: 'Pricify (pricify.ai)', generated: '2026-11-03T04:32:43Z',
    products: MEMORY_REFERENCES.filter(reference => reference.productId).map(reference => ({
      product_id: reference.productId, name: reference.productName, category: 'ram', part_number: reference.mpn,
      upc: reference.upc, url: reference.url,
      daily: [{date: '2026-11-01', low: bootstrap.items.find(item => item.id === reference.id).price, low_store: 'Micro Center (in store)', retailers_in_stock: 1, shops_in_stock: 30}],
    })),
  };
}

function fetcherFor({index = csv(), products = release(), calls = []} = {}) {
  return async (url, options) => {
    calls.push({url, options});
    assert.ok(url === PRICIFY_INDEX_URL || url === PRICIFY_PRODUCTS_URL, 'Only the two open-licensed GitHub files are fetched');
    assert.equal(options.redirect, 'error');
    assert.equal(new Headers(options.headers).has('authorization'), false);
    return new Response(url === PRICIFY_INDEX_URL ? index : JSON.stringify(products));
  };
}

test('licensed bootstrap contains five separate genuine histories and a pinned provenance manifest', () => {
  assert.equal(bootstrap.provenance.revision, PRICIFY_REVISION);
  assert.equal(bootstrap.provenance.license, 'CC BY 4.0');
  assert.equal(bootstrap.provenance.files.length, 5);
  assert.ok(bootstrap.provenance.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256) && file.url.includes(`/${PRICIFY_REVISION}/`)));
  assert.deepEqual(bootstrap.items.map(item => item.history.length), [32, 32, 14, 28, 28]);
  for (const item of bootstrap.items) {
    assert.equal(item.historyLicense, 'CC BY 4.0');
    assert.equal(item.attributionLabel, 'Pricify (pricify.ai)');
    assert.equal(item.sourceTimezone, 'America/New_York');
    assert.equal(item.history.at(-1).observedAt, '2026-11-01T00:00:00.000Z');
    assert.ok(item.history.every(point => point.currency === 'USD' && point.price > 0 && point.precision === 'day' && point.evidenceUrl.includes(`/${PRICIFY_REVISION}/`)));
  }
});

test('consumer graph uses the dollar level rather than the chained index', () => {
  const parsed = parseIndexCSV(csv(), {now});
  assert.equal(parsed['ram-pricify-ddr5'][0].price, 18.0622);
  assert.equal(parsed['ram-pricify-ddr4'][0].price, 9.8747);
  assert.equal(parsed['ram-pricify-ddr5'][0].precision, 'day');
});

test('weekly collection preserves older actual quotes, date precision and module versus kit capacity', async () => {
  const calls = [], previousItems = clone(bootstrap.items), original = clone(previousItems);
  const items = await collectMemory({fetcher: fetcherFor({calls}), now, previousItems});
  assert.equal(calls.length, 2);
  assert.equal(items.length, 5);
  assert.deepEqual(previousItems, original);
  assert.deepEqual(items.map(item => item.history), original.map(item => item.history));
  assert.ok(items.every(item => item.status === 'fresh' && item.error === null && item.observedAt === '2026-11-01T00:00:00.000Z'));
  const module = items.find(item => item.id === 'ram-pricify-gskill-64gb');
  const kit = items.find(item => item.id === 'ram-pricify-kingston-128gb-kit');
  assert.equal(module.priceDivisor, 64);
  assert.equal(module.moduleCount, 1);
  assert.equal(kit.priceDivisor, 128);
  assert.equal(kit.moduleCount, 4);
  assert.match(kit.selectionLabel, /kit/);
  assert.match(kit.sourceNote, /in-store pickup/);
  assert.ok(items.every(item => item.freshnessHours >= 8 * 24 && item.inStock === null));
});

test('failure or a missing product keeps stored prices without claiming stock loss', async () => {
  const missing = release();
  missing.products = missing.products.filter(product => product.product_id !== 11133);
  const items = await collectMemory({fetcher: fetcherFor({products: missing}), now, previousItems: bootstrap.items});
  const module = items.find(item => item.id === 'ram-pricify-gskill-64gb');
  assert.deepEqual(module.history, bootstrap.items.find(item => item.id === module.id).history);
  assert.equal(module.price, 2499.99);
  assert.equal(module.inStock, null);
  assert.equal(module.status, 'stale');
  assert.match(module.error, /absent/);
  const failed = await collectMemory({fetcher: async () => { throw new Error('private arbitrary network exception'); }, now, previousItems: bootstrap.items});
  for (const item of failed) {
    const prior = bootstrap.items.find(prior => prior.id === item.id);
    assert.equal(item.price, prior.price);
    assert.equal(item.observedAt, prior.observedAt);
    assert.equal(item.lastSuccessAt, prior.lastSuccessAt);
    assert.equal(item.status, 'stale');
    assert.doesNotMatch(item.error, /private arbitrary/);
  }
});

test('a changed published quote is rejected rather than silently overwriting prior history', async () => {
  const items = await collectMemory({fetcher: fetcherFor({index: csv('19.0622')}), now, previousItems: bootstrap.items});
  const ddr5 = items.find(item => item.id === 'ram-pricify-ddr5');
  assert.equal(ddr5.price, 18.0622);
  assert.equal(ddr5.status, 'stale');
  assert.match(ddr5.error, /already recorded/);
  assert.equal(items.find(item => item.id === 'ram-pricify-ddr4').status, 'fresh');
  const points = bootstrap.items[0].history.slice(-1);
  assert.throws(() => mergeMemoryHistory(points, [{...points[0], price: points[0].price + 1}], now), /already recorded/);
});

test('source success cannot turn old weekly quotes into current dates', async () => {
  const later = new Date('2026-11-20T12:00:00Z');
  const items = await collectMemory({fetcher: fetcherFor(), now: later, previousItems: bootstrap.items});
  assert.ok(items.every(item => item.status === 'stale' && item.observedAt === '2026-11-01T00:00:00.000Z'));
  assert.ok(items.every(item => item.lastSuccessAt === later.toISOString()));
});

test('release identity, license, unit and exact SKU validation reject substitutes', () => {
  for (const alter of [
    document => { document.currency = 'EUR'; },
    document => { document.license = 'all rights reserved'; },
    document => { document.timezone = 'UTC'; },
    document => { document.products[0].part_number += '-substitute'; },
    document => { document.products[0].name = '64GB DDR5 UDIMM'; },
    document => { document.products[0].upc = '000000000000'; },
    document => { document.products[0].url = 'https://attacker.example/'; },
    document => { document.products.push(clone(document.products[0])); },
    document => { document.products[0].daily[0].low = 0; },
    document => { document.products[0].daily[0].low = '2499.99'; },
  ]) {
    const document = release(); alter(document);
    assert.throws(() => parseMemoryRelease(document, {now}), /identity|license|Duplicate|Invalid|substitute/);
  }
  assert.throws(() => parseIndexCSV(csv().replace('$/GB', '$/kit'), {now}), /unit/);
  assert.throws(() => parseIndexCSV(csv().replace('18.0622', '0'), {now}), /value/);
  assert.throws(() => parseIndexCSV(csv() + csv().split('\n')[1] + '\n', {now}), /Duplicate/);
});

test('calendar dates, weekly boundaries and source evidence are checked', () => {
  assert.throws(() => parseIndexCSV(csv().replace('2026-11-01', '2026-11-10'), {now}), /future/);
  assert.throws(() => parseIndexCSV(csv().replace('2026-11-01', '2026-02-30'), {now}), /calendar/);
  const document = release();
  document.products[0].daily.push(clone(document.products[0].daily[0]));
  assert.throws(() => parseMemoryRelease(document, {now}), /Duplicate/);
  assert.throws(() => parseMemoryRelease(release(), {now, evidenceUrl: `https://raw.githubusercontent.com/pricify-ai/pc-hardware-prices/${PRICIFY_REVISION}/data/2026/W43/json/rams.live.json`}), /week/);
  assert.throws(() => parseIndexCSV(csv(), {now, evidenceUrl: PRICIFY_PRODUCTS_URL}), /evidence/);
  assert.throws(() => parseMemoryRelease(release(), {now, evidenceUrl: PRICIFY_INDEX_URL}), /evidence/);
});

test('URL allowlist rejects credentials, ports, query strings and other repositories', () => {
  for (const url of [
    'https://raw.githubusercontent.com.evil.test/pricify-ai/pc-hardware-prices/main/latest/json/rams.live.json',
    'https://raw.githubusercontent.com/other/pc-hardware-prices/main/latest/json/rams.live.json',
    PRICIFY_PRODUCTS_URL + '?token=secret',
    PRICIFY_PRODUCTS_URL + '#fragment',
    PRICIFY_PRODUCTS_URL.replace('https://', 'http://'),
    PRICIFY_PRODUCTS_URL.replace('https://', 'https://user:password@'),
    PRICIFY_PRODUCTS_URL.replace('.com/', '.com:444/'),
  ]) assert.throws(() => assertPricifyDataUrl(url));
});

test('corrupt previous series identity fails before network requests', async () => {
  for (const alter of [
    item => { item.source = 'private-unlicensed-source'; },
    item => { item.priceDivisor = 128; },
    item => { item.identity.basis = 'different basis'; },
    item => { item.history[0].currency = 'EUR'; },
    item => { item.price += 1; },
  ]) {
    const previousItems = clone(bootstrap.items); alter(previousItems[0]);
    let fetched = false;
    await assert.rejects(collectMemory({previousItems, now, fetcher: async () => { fetched = true; return new Response(''); }}));
    assert.equal(fetched, false);
  }
});

test('bounded reads and missing daily prices preserve actual history', async () => {
  const tooLarge = await collectMemory({fetcher: async () => new Response('x', {headers: {'content-length': '2000001'}}), previousItems: bootstrap.items, now});
  assert.ok(tooLarge.every(item => item.status === 'stale' && /could not be checked/.test(item.error)));
  const document = release();
  document.products[0].daily = [{date: '2026-11-01', low: null, low_store: null, retailers_in_stock: 0, shops_in_stock: 0}];
  const items = await collectMemory({fetcher: fetcherFor({products: document}), previousItems: bootstrap.items, now});
  const item = items.find(item => item.id === 'ram-pricify-gskill-64gb');
  assert.equal(item.history.length, 14);
  assert.equal(item.price, 2499.99);
  assert.equal(item.inStock, null);
  assert.equal(item.status, 'stale');
});
