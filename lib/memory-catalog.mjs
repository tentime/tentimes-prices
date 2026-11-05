export const PRICIFY_REVISION = 'ed6f528f5b28fd778c2401b1c98d4feb8d4b9a06';
export const PRICIFY_ROOT = 'https://raw.githubusercontent.com/pricify-ai/pc-hardware-prices';
export const PRICIFY_INDEX_URL = `${PRICIFY_ROOT}/main/indices/pricify-indices.csv`;
export const PRICIFY_PRODUCTS_URL = `${PRICIFY_ROOT}/main/latest/json/rams.live.json`;
export const PRICIFY_ATTRIBUTION_URL = 'https://pricify.ai';
export const PRICIFY_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';
export const PRICIFY_LICENSE_SOURCE = `${PRICIFY_ROOT}/${PRICIFY_REVISION}/LICENSE`;

const common = {
  category: 'ram', source: 'pricify', currency: 'USD', displayUnit: 'GB',
  datePrecision: 'day', sourceTimezone: 'America/New_York',
  historical: true, activeSeries: true, archiveOnly: false,
  freshnessHours: 240, sampleCadenceHours: 24, maxGapHours: 192,
  sourceLabel: 'Pricify weekly open data',
  attributionLabel: 'Pricify (pricify.ai)', attributionUrl: PRICIFY_ATTRIBUTION_URL,
  licenseUrl: PRICIFY_LICENSE_URL, historyLicense: 'CC BY 4.0',
  licenseSourceUrl: PRICIFY_LICENSE_SOURCE,
  historyNote: 'Daily observations released weekly; calendar dates are US Eastern. Values are normalized to USD/GB; estimates are separate.',
};

const consumer = ['DDR5', 'DDR4'].map(generation => ({
  ...common, id: `ram-pricify-${generation.toLowerCase()}`,
  title: `${generation} consumer memory · Pricify daily median`,
  selectionLabel: generation, selectorGroup: 'Consumer',
  url: 'https://github.com/pricify-ai/pc-hardware-prices/tree/main/indices',
  unit: 'GB', priceDivisor: 1, capacityGB: null,
  indexKey: generation.toLowerCase(), indexName: `${generation} memory`,
  identity: {provider: 'Pricify', series: generation.toLowerCase(), channel: 'US new non-ECC desktop and laptop memory', basis: 'daily median USD/GB'},
  sourceNote: 'Daily median USD/GB of new, in-stock non-ECC desktop and laptop memory; retailer-owned offers only. Public CC BY 4.0 dataset, released weekly. Product mix varies.',
}));

const enterprise = [
  {
    id: 'ram-pricify-gskill-64gb', productId: 11133,
    productName: 'G.SKILL G5 64GB DDR5-5600 CL46 ECC RDIMM',
    mpn: 'F5-5600R4645A64GX1-G5', upc: '848354051039', capacityGB: 64,
    selectionLabel: 'DDR5-5600 · 64 GB module',
    url: 'https://rams.live/memory/gskill-g5-64gb-ddr5-5600-cl46-rdimm',
    moduleCount: 1, moduleCapacityGB: 64,
  },
  {
    id: 'ram-pricify-kingston-128gb-kit', productId: 2554,
    productName: 'Kingston Fury Renegade Pro 128GB (4x32GB) DDR5-5600 CL28 ECC RDIMM',
    mpn: 'KF556R28RBE2K4-128', upc: '740617342161', capacityGB: 128,
    selectionLabel: 'DDR5-5600 · 128 GB kit (4×32)',
    url: 'https://rams.live/memory/kingston-fury-renegade-pro-128gb-4x32gb-ddr5-5600-cl28-ecc-rdimm',
    moduleCount: 4, moduleCapacityGB: 32,
  },
  {
    id: 'ram-pricify-teamgroup-128gb-kit', productId: 2425,
    productName: 'TEAMGROUP T-Create Master 128GB (4x32GB) DDR5-6000 CL30 ECC RDIMM',
    mpn: 'CTCMD5128G6000HC30FQC01', upc: '4711430801698', capacityGB: 128,
    selectionLabel: 'DDR5-6000 · 128 GB kit (4×32)',
    url: 'https://rams.live/memory/teamgroup-t-create-master-128gb-4x32gb-ddr5-6000-cl30-ecc-rdimm',
    moduleCount: 4, moduleCapacityGB: 32,
  },
].map(product => ({
  ...common, ...product, title: product.productName,
  selectorGroup: 'Enterprise', unit: 'each', priceDivisor: product.capacityGB,
  identity: {provider: 'Pricify', productId: product.productId, mpn: product.mpn, upc: product.upc, capacityGB: product.capacityGB, moduleCount: product.moduleCount, moduleCapacityGB: product.moduleCapacityGB, channel: 'US new retailer-owned in-stock daily lowest price'},
  sourceNote: `Exact ECC RDIMM ${product.moduleCount === 1 ? 'single module' : 'workstation kit, 4×32 GB'}; daily lowest new in-stock retailer-owned price, which may require in-store pickup. Public CC BY 4.0 release updated weekly. Raw ${product.moduleCount === 1 ? 'module' : 'kit'} USD price divided by ${product.capacityGB} GB; no broad server-market average is implied.`,
}));

export const MEMORY_REFERENCES = Object.freeze([...consumer, ...enterprise].map(reference => Object.freeze(reference)));
