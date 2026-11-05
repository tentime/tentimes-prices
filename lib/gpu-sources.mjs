import bootstrap from '../public/data/gpu-bootstrap.json' with {type:'json'};

const HOUR = 3_600_000;
const RUNPOD_ENDPOINT = 'https://api.runpod.io/graphql';
const RUNPOD_QUERY = 'query { gpuTypes { id displayName memoryInGb securePrice } }';
const AZURE_ENDPOINT = 'https://prices.azure.com/api/retail/prices';
const MAX_BYTES = 4_000_000;
export const GPU_REFERENCES = bootstrap.items.map(({history,price,observedAt,status,error,lastSuccessAt,lastAttemptAt,...reference}) => reference);
export const GPU_BOOTSTRAP = bootstrap;
export class SourceError extends Error {}

const signature = value => JSON.stringify(value, Object.keys(value || {}).sort());

/** Existing data must belong to the same licensed, exact-provider series. */
export function assertGPUReference(item, reference) {
  if (!item || item.id !== reference.id || item.source !== reference.source || item.category !== 'cloud' ||
      item.url !== reference.url || item.unit !== reference.unit || item.displayUnit !== reference.displayUnit ||
      item.priceDivisor !== reference.priceDivisor || signature(item.identity) !== signature(reference.identity)) {
    throw new Error('Existing GPU data does not match its licensed source identity.');
  }
}

function evidenceURL(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('GPU observation lacks valid source evidence.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      !(url.hostname === 'huggingface.co' && url.pathname.startsWith('/datasets/afhubbard/gpu-prices/resolve/') ||
        url.href === RUNPOD_ENDPOINT ||
        url.hostname === 'prices.azure.com' && /^\/api\/retail\/prices\/?$/.test(url.pathname))) {
    throw new Error('GPU observation evidence is outside its approved sources.');
  }
}

/** Never replace an actual quote with a conflicting value or fabricate missing dates. */
export function mergeGPUHistory(groups, now = new Date()) {
  const history = new Map();
  for (const group of groups) {
    if (!Array.isArray(group)) throw new Error('GPU history must be an array.');
    for (const quote of group) {
      const time = Date.parse(quote.observedAt);
      if (!Number.isFinite(time) || time > +now || quote.currency !== 'USD' ||
          !Number.isFinite(quote.price) || quote.price <= 0 || quote.price > 1_000_000 ||
          quote.precision !== 'instant') throw new Error('GPU history contains an invalid actual quote.');
      evidenceURL(quote.evidenceUrl);
      const observedAt = new Date(time).toISOString();
      const previous = history.get(observedAt);
      if (previous && previous.price !== quote.price) throw new Error('GPU history contains conflicting quotes for the same timestamp.');
      history.set(observedAt, {...previous,...quote,observedAt});
    }
  }
  return [...history.values()].sort((a,b) => a.observedAt.localeCompare(b.observedAt));
}

function timeValue(now) {
  if (!(now instanceof Date) || !Number.isFinite(+now)) throw new Error('A valid collection time is required.');
  return now.toISOString();
}

/** Bound decoded response size as well as Content-Length. No redirects or arbitrary URLs. */
async function readJSON(url, fetcher, init = {}) {
  let response;
  try { response = await fetcher(url, {...init,redirect:'manual',signal:AbortSignal.timeout(18_000)}); }
  catch { throw new SourceError('The source could not be reached. The last valid quote was kept.'); }
  if (!response.ok) throw new SourceError(response.status === 429 ? 'The source rate limit was reached. The last valid quote was kept.' : `The source returned HTTP ${response.status}. The last valid quote was kept.`);
  if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw new SourceError('The source response exceeded its size limit.');
  let raw = '';
  let size = 0;
  try {
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const {value,done} = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BYTES) throw new SourceError('The source response exceeded its size limit.');
          raw += decoder.decode(value,{stream:true});
        }
        raw += decoder.decode();
      } finally { await reader.cancel().catch(() => {}); }
    } else {
      raw = await response.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) throw new SourceError('The source response exceeded its size limit.');
    }
    return JSON.parse(raw);
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError('The source returned an unreadable price list.');
  }
}

async function runpodCatalog(fetcher) {
  const data = await readJSON(RUNPOD_ENDPOINT,fetcher,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({query:RUNPOD_QUERY})});
  if (data.errors?.length || !Array.isArray(data.data?.gpuTypes) || data.data.gpuTypes.length > 500) throw new SourceError('Runpod returned no usable public GPU catalog.');
  return data.data.gpuTypes;
}

export function selectRunpodQuote(catalog, reference, now = new Date()) {
  if (reference.source !== 'runpod' || reference.gpuCount !== 1 || !reference.gpuTypeId?.startsWith('NVIDIA ')) throw new SourceError('An exact single-GPU Runpod reference is required.');
  const matches = catalog.filter(row => row?.id === reference.gpuTypeId);
  if (matches.length !== 1 || matches[0].memoryInGb !== reference.gpuMemoryGB) throw new SourceError('Runpod did not return the exact GPU and memory capacity.');
  const price = matches[0].securePrice;
  if (!Number.isFinite(price) || price <= 0 || price > 1_000_000) throw new SourceError('Runpod returned no positive Secure Cloud list price.');
  const observedAt = timeValue(now);
  return {price,currency:'USD',observedAt,sourceObservedAt:observedAt,precision:'instant',inStock:null,evidenceUrl:RUNPOD_ENDPOINT,
    detail:'Runpod Secure Cloud · one GPU · published on-demand catalog rate · capacity unconfirmed · storage, network and tax extra'};
}

function azureURL(input) {
  let url;
  try { url = new URL(input); } catch { throw new SourceError('Azure returned an invalid rate endpoint.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'prices.azure.com' || url.port || url.username || url.password || url.hash || !/^\/api\/retail\/prices\/?$/.test(url.pathname)) throw new SourceError('Azure returned an invalid rate endpoint.');
  return url.href;
}

export function selectAzureQuote(rows, reference, now = new Date()) {
  if (reference.source !== 'azure' || reference.sku !== 'Standard_NC4as_T4_v3' || reference.region !== 'eastus' || reference.gpuCount !== 1) throw new SourceError('The exact East US T4 reference is required.');
  const valid = rows.filter(row => row.armSkuName === reference.sku && row.armRegionName === reference.region &&
    row.currencyCode === 'USD' && row.type === 'Consumption' && row.unitOfMeasure === '1 Hour' && row.tierMinimumUnits === 0 &&
    !/windows|spot|low priority/i.test(`${row.productName} ${row.meterName} ${row.skuName}`) &&
    Number.isFinite(row.retailPrice) && row.retailPrice > 0 && row.retailPrice <= 1_000_000 && row.isPrimaryMeterRegion !== false &&
    Number.isFinite(Date.parse(row.effectiveStartDate)) && Date.parse(row.effectiveStartDate) <= +now)
    .sort((a,b) => Date.parse(b.effectiveStartDate) - Date.parse(a.effectiveStartDate));
  if (!valid.length) throw new SourceError('Azure returned no matching Linux on-demand rate.');
  const current = valid.filter(row => row.effectiveStartDate === valid[0].effectiveStartDate);
  if (new Set(current.map(row => row.retailPrice)).size !== 1) throw new SourceError('Azure returned conflicting current rates.');
  const observedAt = timeValue(now);
  return {price:current[0].retailPrice,currency:'USD',observedAt,sourceObservedAt:observedAt,precision:'instant',inStock:null,evidenceUrl:AZURE_ENDPOINT,
    detail:`Azure NC4as T4 v3 · East US · Linux on-demand · one T4 VM · rate effective ${valid[0].effectiveStartDate.slice(0,10)} · storage, network and tax extra`};
}

async function azureQuote(reference, fetcher, now) {
  const first = new URL(AZURE_ENDPOINT);
  first.searchParams.set('$filter',"serviceName eq 'Virtual Machines' and armRegionName eq 'eastus' and armSkuName eq 'Standard_NC4as_T4_v3' and priceType eq 'Consumption'");
  first.searchParams.set('currencyCode','USD');
  let next = first.href;
  const visited = new Set();
  const rows = [];
  for (let page = 0; next && page < 8; page++) {
    const url = azureURL(next);
    if (visited.has(url)) throw new SourceError('Azure returned a pagination loop.');
    visited.add(url);
    const data = await readJSON(url,fetcher,{headers:{Accept:'application/json'}});
    if (!Array.isArray(data.Items)) throw new SourceError('Azure returned no readable rate list.');
    rows.push(...data.Items);
    if (rows.length > 20_000) throw new SourceError('Azure returned too many rates.');
    next = data.NextPageLink || null;
  }
  if (next) throw new SourceError('Azure rate query exceeded the page limit.');
  return selectAzureQuote(rows,reference,now);
}

export function gpuSnapshot(reference, history, previous, now, error = null, attempted = false) {
  const last = history.at(-1);
  const checkedAt = timeValue(now);
  return {...reference,history,price:last?.price ?? null,observedAt:last?.observedAt || null,inStock:null,error,
    status:error ? last ? 'stale' : 'error' : last && +now - Date.parse(last.observedAt) <= reference.freshnessHours * HOUR ? 'fresh' : 'stale',
    lastAttemptAt:attempted ? checkedAt : previous?.lastAttemptAt || null,
    lastSuccessAt:attempted && !error ? checkedAt : previous?.lastSuccessAt || null};
}

/** Shared catalog fetch, per-series failures, and immutable actual history. */
export async function collectGPU({fetcher = fetch,now = new Date(),previousItems = [],offline = false} = {}) {
  timeValue(now);
  if (!Array.isArray(previousItems)) throw new Error('Previous GPU data must be an array.');
  const previousById = new Map();
  for (const item of previousItems) {
    const reference = GPU_REFERENCES.find(ref => ref.id === item.id);
    if (!reference || previousById.has(item.id)) throw new Error('Unknown or duplicate GPU series in existing data.');
    assertGPUReference(item,reference);
    previousById.set(item.id,item);
  }
  // Validate retained history before making requests or updating any file.
  const bases = GPU_REFERENCES.map(reference => ({reference,previous:previousById.get(reference.id),
    history:mergeGPUHistory([bootstrap.items.find(item => item.id === reference.id).history,previousById.get(reference.id)?.history || []],now)}));
  let catalog;
  const items = await Promise.all(bases.map(async ({reference,previous,history}) => {
    if (offline) return gpuSnapshot(reference,history,previous,now);
    try {
      const quote = reference.source === 'runpod'
        ? selectRunpodQuote(await (catalog ||= runpodCatalog(fetcher)),reference,now)
        : await azureQuote(reference,fetcher,now);
      return gpuSnapshot(reference,mergeGPUHistory([history,[quote]],now),previous,now,null,true);
    } catch (error) {
      const message = error instanceof SourceError ? error.message : 'The source could not be checked. The last valid quote was kept.';
      return gpuSnapshot(reference,history,previous,now,message,true);
    }
  }));
  return {items,errors:items.filter(item => item.error).map(item => ({id:item.id,error:item.error}))};
}
