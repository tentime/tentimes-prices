import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {collectMemory,mergeMemoryHistory} from '../lib/pricify.mjs';
import {collectGPU,GPU_BOOTSTRAP} from '../lib/gpu-sources.mjs';

const dataURL = new URL('../public/data/',import.meta.url);
const stable = value => value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map(key => [key,stable(value[key])]))
  : value;
const same = (a,b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const itemsOf = document => Array.isArray(document) ? document : document?.items;

function checkEvidence(item,quote) {
  let url;
  try { url = new URL(quote.evidenceUrl); } catch { throw new Error('Retained prices require source evidence.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) throw new Error('Retained price evidence is not approved.');
  const memory = item.source === 'pricify' &&
    (url.hostname === 'raw.githubusercontent.com' && url.pathname.startsWith('/pricify-ai/pc-hardware-prices/') ||
     url.hostname === 'github.com' && url.pathname.startsWith('/pricify-ai/pc-hardware-prices/'));
  const gpu = item.category === 'cloud' &&
    (url.hostname === 'huggingface.co' && url.pathname.startsWith('/datasets/afhubbard/gpu-prices/resolve/') ||
     url.href === 'https://api.runpod.io/graphql' ||
     url.hostname === 'prices.azure.com' && /^\/api\/retail\/prices\/?$/.test(url.pathname));
  if (!memory && !gpu) throw new Error('Retained history includes a source without public reuse permission.');
}

/** Refuse private legacy datasets rather than accidentally publishing them. */
export function validatePrevious(document,references,now) {
  if (!document) return [];
  const items = itemsOf(document);
  if (!Array.isArray(items)) throw new Error('Existing prices.json has no valid items array.');
  const ids = new Set();
  for (const item of items) {
    const reference = references.find(ref => ref.id === item.id);
    if (!reference || ids.has(item.id) || !['pricify','runpod','azure'].includes(item.source) ||
        ['source','category','unit','displayUnit','priceDivisor','capacityGB','url'].some(key => item[key] !== reference[key]) ||
        !same(item.identity,reference.identity)) throw new Error('Existing prices.json contains an unknown or mismatched source. Refusing to publish private data.');
    ids.add(item.id);
    if (!Array.isArray(item.history)) throw new Error('Retained price history is invalid.');
    for (const quote of item.history) {
      if (!Number.isFinite(Date.parse(quote.observedAt)) || Date.parse(quote.observedAt) > +now || quote.currency !== 'USD' ||
          !(quote.price === null || Number.isFinite(quote.price) && quote.price > 0 && quote.price <= 1_000_000) ||
          !['day','instant'].includes(quote.precision)) throw new Error('Retained price history contains an invalid actual observation.');
      checkEvidence(item,quote);
    }
  }
  return items;
}

function holdMemory(reference,previous,now,error) {
  const quotes = new Map();
  for (const quote of [...reference.history,...(previous?.history || [])]) {
    const old = quotes.get(quote.observedAt);
    if (old && old.price !== quote.price) throw new Error('A retained memory quote conflicts with its licensed archive.');
    quotes.set(quote.observedAt,{...old,...quote});
  }
  const history = [...quotes.values()].sort((a,b) => a.observedAt.localeCompare(b.observedAt));
  const last = history.filter(quote => Number.isFinite(quote.price) && quote.price > 0).at(-1);
  return {...reference,history,price:last?.price ?? null,observedAt:last?.observedAt || null,
    lastAttemptAt:now.toISOString(),lastSuccessAt:previous?.lastSuccessAt || null,error,status:last ? 'stale' : 'error'};
}

/** Both source groups run independently, so a failure preserves the other group's success. */
export async function buildPriceDataset({memoryBootstrap,previous = null,fetcher = fetch,now = new Date(),offline = false} = {}) {
  const memory = itemsOf(memoryBootstrap);
  if (!Array.isArray(memory) || memory.length !== 5 || memory.some(item => item.source !== 'pricify' || item.category !== 'ram')) throw new Error('The licensed five-series memory bootstrap is unavailable.');
  if (!(now instanceof Date) || !Number.isFinite(+now)) throw new Error('Invalid update time.');
  const references = [...memory,...GPU_BOOTSTRAP.items];
  const old = validatePrevious(previous,references,now);
  const oldMemory = memory.map(reference => {
    const prior = old.find(item => item.id === reference.id);
    const history = mergeMemoryHistory(reference.history,prior?.history || [],now);
    const last = history.at(-1);
    return {...reference,history,price:last?.price ?? null,observedAt:last?.observedAt || null,
      lastSuccessAt:prior?.lastSuccessAt || null,lastAttemptAt:prior?.lastAttemptAt || null};
  });
  const oldGPU = old.filter(item => item.category === 'cloud');
  const results = await Promise.allSettled([
    offline ? Promise.resolve(memory) : collectMemory({fetcher,now,previousItems:oldMemory}),
    collectGPU({fetcher,now,previousItems:oldGPU,offline}),
  ]);
  let memoryItems;
  if (results[0].status === 'fulfilled' && Array.isArray(results[0].value)) memoryItems = results[0].value;
  else memoryItems = memory.map(reference => holdMemory(reference,oldMemory.find(item => item.id === reference.id),now,'The licensed memory source could not be checked. The last valid quote was kept.'));
  if (results[1].status !== 'fulfilled') throw new Error('Existing GPU history could not be validated; no data was replaced.');
  const items = [...memoryItems,...results[1].value.items].map(item => {
    if (!offline && !item.error && (!item.observedAt || +now - Date.parse(item.observedAt) > (item.freshnessHours || 36) * 3_600_000)) {
      return {...item,status:item.observedAt ? 'stale' : 'error',error:'No newer published quote arrived within the expected update window. The last recorded price was kept.'};
    }
    return item;
  });
  validatePrevious({items},references,now);
  if (items.length !== references.length || items.some(item => !Array.isArray(item.history))) throw new Error('A source returned an incomplete public dataset.');
  const errors = items.filter(item => item.error).map(item => ({id:item.id,error:item.error}));
  return {schemaVersion:1,serverTime:now.toISOString(),refreshedAt:offline ? null : now.toISOString(),
    refreshCadenceHours:6,mode:offline ? 'licensed-bootstrap' : 'collected',
    methodology:'Memory: Pricify CC BY 4.0 daily observations released weekly; exact enterprise module/kit references and consumer generation medians remain separate. Compute: published Runpod Secure Cloud and Azure Linux on-demand rates, with licensed GPU Price Tracker archives. Every stored price is an actual quote; graph estimates are display-only.',
    sources:[{name:'Pricify',url:'https://pricify.ai',license:'CC-BY-4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',modifications:'Selected exact reference products and generation medians; converted to USD per GB.'},
      {name:'GPU Price Tracker / Alex Hubbard',url:'https://huggingface.co/datasets/afhubbard/gpu-prices',license:'CC-BY-4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',modifications:'Selected seven exact-provider series; normalized date strings to milliseconds.'}],
    collection:{ok:errors.length === 0,errors},items};
}

async function readJSON(url,optional = false) {
  try { return JSON.parse(await readFile(url,'utf8')); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
}

export async function atomicJSON(url,value) {
  const temporary = new URL(`.prices.${process.pid}.tmp`,url);
  try {
    await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o644});
    await rename(temporary,url);
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

export async function updatePrices({offline = false,fetcher = fetch,now} = {}) {
  const memoryBootstrap = await readJSON(new URL('memory-bootstrap.json',dataURL));
  const output = new URL('prices.json',dataURL);
  const previous = await readJSON(output,true);
  if (!now) {
    const dates = [GPU_BOOTSTRAP.generatedAt,...itemsOf(memoryBootstrap).flatMap(item => item.history.map(quote => quote.observedAt))];
    now = offline ? new Date(Math.max(...dates.map(Date.parse).filter(Number.isFinite))) : new Date();
  }
  // Offline mode is a deterministic bootstrap export, never a fabricated live check.
  const result = await buildPriceDataset({memoryBootstrap,previous:offline ? null : previous,fetcher,now,offline});
  await atomicJSON(output,result);
  for (const item of result.items) console.log(`${item.error ? 'FAILED' : 'OK'} ${item.selectionLabel || item.title}: ${item.observedAt?.slice(0,10) || 'no quote'}${item.error ? ` — ${item.error}` : ''}`);
  console.log(`${result.items.length} public series saved to ${fileURLToPath(output)}; ${result.collection.errors.length} collection failures.`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--offline')) { console.error('Usage: node scripts/update-prices.mjs [--offline]'); process.exitCode = 1; }
  else {
    try { const result = await updatePrices({offline:args.includes('--offline')}); if (!result.collection.ok) process.exitCode = 1; }
    catch (error) { console.error(error.message || 'Price collection failed. Existing data was kept.'); process.exitCode = 1; }
  }
}
