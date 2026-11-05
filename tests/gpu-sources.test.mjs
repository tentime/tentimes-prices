import test from 'node:test';
import assert from 'node:assert/strict';
import {collectGPU,GPU_BOOTSTRAP,GPU_REFERENCES,selectRunpodQuote,selectAzureQuote,mergeGPUHistory} from '../lib/gpu-sources.mjs';
import {buildPriceDataset,atomicJSON} from '../scripts/update-prices.mjs';
import {readFile,writeFile,mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const now = new Date('2026-11-06T12:00:00.000Z');
const runpod = GPU_REFERENCES.find(item => item.id === 'runpod-h100-sxm');
const azure = GPU_REFERENCES.find(item => item.id === 'azure-t4');
const response = body => new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
const azureRate = (overrides = {}) => ({armSkuName:'Standard_NC4as_T4_v3',armRegionName:'eastus',currencyCode:'USD',type:'Consumption',unitOfMeasure:'1 Hour',tierMinimumUnits:0,productName:'Virtual Machines NCasT4 v3 Series',meterName:'NC4as T4 v3',skuName:'NC4as T4 v3',retailPrice:.526,isPrimaryMeterRegion:true,effectiveStartDate:'2024-01-01T00:00:00Z',...overrides});

test('bootstrap retains all 1,750 licensed observations across seven exact-provider GPU series', () => {
  assert.equal(GPU_BOOTSTRAP.items.length,7);
  assert.equal(GPU_BOOTSTRAP.items.reduce((sum,item) => sum + item.history.length,0),1750);
  assert.equal(GPU_BOOTSTRAP.provenance.license,'CC-BY-4.0');
  for (const item of GPU_BOOTSTRAP.items) {
    assert.equal(item.category,'cloud');
    assert.equal(item.gpuCount,1);
    assert.equal(item.identity.provider,item.source);
    assert.match(item.licenseUrl,/creativecommons\.org\/licenses\/by\/4\.0/);
    assert.ok(item.history.every(quote => quote.currency === 'USD' && quote.precision === 'instant' && quote.evidenceSha256 && quote.evidenceUrl));
  }
});

test('Runpod selects exact Secure Cloud rate, refusing ambiguous identity or absent positive rates', () => {
  const row = {id:runpod.gpuTypeId,memoryInGb:80,securePrice:3.99,communityPrice:.05};
  const quote = selectRunpodQuote([row],runpod,now);
  assert.equal(quote.price,3.99);
  assert.equal(quote.observedAt,now.toISOString());
  assert.equal(quote.inStock,null);
  for (const catalog of [[row,row],[{...row,memoryInGb:94}],[{...row,securePrice:null}],[{...row,securePrice:'3.99'}]]) assert.throws(() => selectRunpodQuote(catalog,runpod,now));
  assert.throws(() => selectRunpodQuote([row],{...runpod,gpuCount:2},now));
});

test('Azure selects exact Linux East US hourly rate and never treats the effective date as observation time', () => {
  const quote = selectAzureQuote([azureRate({productName:'Windows',retailPrice:.01}),azureRate({skuName:'Spot',retailPrice:.02}),azureRate()],azure,now);
  assert.equal(quote.price,.526);
  assert.equal(quote.observedAt,now.toISOString());
  assert.equal(quote.inStock,null);
  assert.throws(() => selectAzureQuote([azureRate(),azureRate({retailPrice:.8})],azure,now),/conflicting/);
  assert.throws(() => selectAzureQuote([azureRate({armRegionName:'westus'})],azure,now),/matching/);
});

test('one refresh shares one anonymous Runpod catalog request and records seven actual checks', async () => {
  const calls = [];
  const fetcher = async (url,init) => {
    calls.push([url,init]);
    if (url === 'https://api.runpod.io/graphql') return response({data:{gpuTypes:GPU_REFERENCES.filter(item => item.source === 'runpod').map(item => ({id:item.gpuTypeId,memoryInGb:item.gpuMemoryGB,securePrice:3.99}))}});
    return response({Items:[azureRate()],NextPageLink:null});
  };
  const result = await collectGPU({fetcher,now});
  assert.equal(result.errors.length,0);
  assert.equal(calls.length,2);
  assert.equal(calls.filter(([url]) => url === 'https://api.runpod.io/graphql').length,1);
  for (const [url,init] of calls) {
    assert.equal(init.redirect,'manual');
    assert.equal(init.headers.Authorization,undefined);
    assert.ok(['api.runpod.io','prices.azure.com'].includes(new URL(url).hostname));
  }
  assert.match(calls[0][1].body,/query/);
  assert.doesNotMatch(calls[0][1].body,/mutation/);
  for (const item of result.items) {
    const original = GPU_BOOTSTRAP.items.find(row => row.id === item.id);
    assert.equal(item.history.length,original.history.length + 1);
    assert.equal(item.observedAt,now.toISOString());
    assert.equal(item.lastSuccessAt,now.toISOString());
    assert.equal(item.status,'fresh');
    assert.deepEqual(item.history.slice(0,-1),original.history);
  }
});

test('collection failures preserve actual dates and previous success without leaking raw network details', async () => {
  const previous = (await collectGPU({now,offline:true})).items;
  previous.forEach(item => item.lastSuccessAt = '2026-11-05T18:00:00.000Z');
  const result = await collectGPU({now,previousItems:previous,fetcher:async () => {throw new TypeError('private bearer URL=super-secret');}});
  assert.equal(result.errors.length,7);
  for (const item of result.items) {
    const original = previous.find(row => row.id === item.id);
    assert.deepEqual(item.history,original.history);
    assert.equal(item.observedAt,original.observedAt);
    assert.equal(item.lastSuccessAt,original.lastSuccessAt);
    assert.equal(item.lastAttemptAt,now.toISOString());
    assert.equal(item.status,'stale');
    assert.doesNotMatch(item.error,/bearer|super-secret|private/);
  }
});

test('Azure refuses off-domain pagination without following the link', async () => {
  const urls = [];
  const result = await collectGPU({now,fetcher:async url => {
    urls.push(url);
    return url.startsWith('https://prices.azure.com/') ? response({Items:[azureRate()],NextPageLink:'https://evil.example/steal'}) : response({data:{gpuTypes:[]}});
  }});
  assert.ok(result.items.find(item => item.id === 'azure-t4').error);
  assert.equal(urls.filter(url => url.startsWith('https://prices.azure.com/')).length,1);
  assert.ok(urls.every(url => !url.includes('evil.example')));
});

test('existing unknown or conflicting data cannot silently replace public history', async () => {
  await assert.rejects(() => collectGPU({now,previousItems:[{id:'memoryc-ram',source:'memoryc'}],offline:true}),/Unknown/);
  const prior = structuredClone(GPU_BOOTSTRAP.items.find(item => item.id === runpod.id));
  prior.history[0].price += 1;
  await assert.rejects(() => collectGPU({now,previousItems:[prior],offline:true}),/conflicting/);
  const original = GPU_BOOTSTRAP.items[0].history[0];
  assert.throws(() => mergeGPUHistory([[{...original,evidenceUrl:'https://private.example/data'}]],now),/approved/);
  assert.throws(() => mergeGPUHistory([[{...original,observedAt:'2030-01-01T00:00:00Z'}]],now),/invalid/);
});

test('oversized and redirect responses are collector failures', async () => {
  for (const fetcher of [async () => new Response('{}',{headers:{'Content-Length':'999999999'}}),async () => new Response('',{status:302,headers:{Location:'https://evil.example/'}})]) {
    const result = await collectGPU({now,fetcher});
    assert.equal(result.errors.length,7);
    assert.ok(result.items.every(item => item.history.length));
  }
});

test('public updater preserves the licensed archive and partial GPU successes when memory collection fails', async () => {
  const memoryBootstrap = JSON.parse(await readFile(new URL('../public/data/memory-bootstrap.json',import.meta.url),'utf8'));
  const previous = await buildPriceDataset({memoryBootstrap,now,offline:true});
  const result = await buildPriceDataset({memoryBootstrap,now,previous,fetcher:async url => {
    if (url.includes('raw.githubusercontent.com')) throw new Error('private raw network detail');
    if (url === 'https://api.runpod.io/graphql') return response({data:{gpuTypes:GPU_REFERENCES.filter(item => item.source === 'runpod').map(item => ({id:item.gpuTypeId,memoryInGb:item.gpuMemoryGB,securePrice:3.99}))}});
    return response({Items:[azureRate()]});
  }});
  assert.equal(result.items.length,12);
  assert.equal(result.collection.ok,false);
  assert.equal(result.collection.errors.length,5);
  for (const item of result.items) {
    const original = previous.items.find(row => row.id === item.id);
    assert.deepEqual(item.history.slice(0,original.history.length),original.history);
    if (item.category === 'ram') {
      assert.equal(item.observedAt,original.observedAt);
      assert.equal(item.history.length,original.history.length);
      assert.equal(item.status,'stale');
      assert.doesNotMatch(item.error,/private raw/);
    } else {
      assert.equal(item.history.length,original.history.length + 1);
      assert.equal(item.status,'fresh');
    }
  }
});

test('public updater refuses private or poisoned previous data before fetching', async () => {
  const memoryBootstrap = JSON.parse(await readFile(new URL('../public/data/memory-bootstrap.json',import.meta.url),'utf8'));
  let calls = 0;
  const fetcher = async () => {calls++;throw new Error('This should not run');};
  await assert.rejects(() => buildPriceDataset({memoryBootstrap,now,previous:{items:[{id:'memoryc-ram',source:'memoryc'}]},fetcher}),/private data/);
  const previous = await buildPriceDataset({memoryBootstrap,now,offline:true});
  previous.items[0].history[0].evidenceUrl = 'https://componentprices.com/ram/ddr5';
  await assert.rejects(() => buildPriceDataset({memoryBootstrap,now,previous,fetcher}),/public reuse permission/);
  assert.equal(calls,0);
});

test('offline public build is deterministic and never claims a live collection', async () => {
  const memoryBootstrap = JSON.parse(await readFile(new URL('../public/data/memory-bootstrap.json',import.meta.url),'utf8'));
  const first = await buildPriceDataset({memoryBootstrap,now,offline:true,fetcher:async () => {throw new Error('Offline must not fetch');}});
  const second = await buildPriceDataset({memoryBootstrap,now,offline:true});
  assert.deepEqual(first,second);
  assert.equal(first.mode,'licensed-bootstrap');
  assert.equal(first.refreshedAt,null);
  assert.equal(first.items.reduce((sum,item) => sum + (item.category === 'cloud' ? item.history.length : 0),0),1750);
});

test('an overdue unchanged weekly release cannot leave collection health green', async () => {
  const memoryBootstrap = JSON.parse(await readFile(new URL('../public/data/memory-bootstrap.json',import.meta.url),'utf8'));
  const late = new Date('2026-11-20T12:00:00Z');
  const csv = ['index,name,unit,day,value,level,measured',...memoryBootstrap.items.filter(item => item.indexKey).flatMap(item => item.history.map(quote => [item.indexKey,item.indexName,'$/GB',quote.observedAt.slice(0,10),100,quote.price,10].join(',')))].join('\n');
  const release = {dataset:'Pricify weekly PC hardware prices',site:'rams.live',week:'2026-W44',from:'2026-10-26',to:'2026-11-01',timezone:'America/New_York',currency:'USD',license:'CC BY 4.0',attribution:'Pricify (pricify.ai)',generated:'2026-11-03T04:32:43Z',
    products:memoryBootstrap.items.filter(item => item.productId).map(item => ({product_id:item.productId,category:'ram',name:item.productName,part_number:item.mpn,upc:item.upc,url:item.url,
      daily:item.history.filter(quote => quote.observedAt >= '2026-10-26').map(quote => ({date:quote.observedAt.slice(0,10),low:quote.price,low_store:quote.venue || 'Micro Center (in store)',retailers_in_stock:1,shops_in_stock:1}))}))};
  const result = await buildPriceDataset({memoryBootstrap,now:late,previous:null,fetcher:async url => {
    if (url.includes('pricify-indices.csv')) return new Response(csv);
    if (url.includes('raw.githubusercontent.com')) return response(release);
    if (url === 'https://api.runpod.io/graphql') return response({data:{gpuTypes:GPU_REFERENCES.filter(item => item.source === 'runpod').map(item => ({id:item.gpuTypeId,memoryInGb:item.gpuMemoryGB,securePrice:3.99}))}});
    return response({Items:[azureRate()]});
  }});
  assert.equal(result.collection.ok,false);
  assert.equal(result.collection.errors.length,5);
  assert.ok(result.collection.errors.every(item => /expected update window/.test(item.error)));
  assert.ok(result.items.filter(item => item.category === 'ram').every(item => item.status === 'stale' && item.observedAt.startsWith('2026-11-01')));
});

test('atomic JSON output preserves an existing valid file if serialization fails', async () => {
  const directory = await mkdtemp(join(tmpdir(),'tentimes-data-'));
  const target = pathToFileURL(join(directory,'prices.json'));
  try {
    await writeFile(target,JSON.stringify({old:true}));
    const bad = {};bad.circular = bad;
    await assert.rejects(() => atomicJSON(target,bad));
    assert.deepEqual(JSON.parse(await readFile(target,'utf8')),{old:true});
    await atomicJSON(target,{new:true});
    assert.deepEqual(JSON.parse(await readFile(target,'utf8')),{new:true});
    assert.deepEqual(await readdir(directory),['prices.json']);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
