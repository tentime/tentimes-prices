# Public price-data sources

This repository contains selected open-licensed price observations. It does not copy the prior private tracker's ComponentPrices/Newegg medians, Expedient/Memory.net archive, MemoryC observations, database files, credentials, or source history.

## Memory: Pricify weekly open data

- Publisher: [Pricify](https://pricify.ai), whose homepage links its [official open dataset](https://github.com/pricify-ai/pc-hardware-prices).
- Explicit grant: the repository's [data LICENSE](https://raw.githubusercontent.com/pricify-ai/pc-hardware-prices/ed6f528f5b28fd778c2401b1c98d4feb8d4b9a06/LICENSE) permits sharing and adapting the repository's data for any purpose, including commercial use, under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Give appropriate credit, link the license, and indicate changes.
- Required credit: **Pricify (pricify.ai)** with a link to <https://pricify.ai>. The graph's source footnote carries this credit and the license link.
- Bootstrap revision: `ed6f528f5b28fd778c2401b1c98d4feb8d4b9a06`, committed November 3, 2026. The bootstrap manifest records the exact URLs and SHA-256 hashes of all five downloaded files.
- Collection endpoints: only `raw.githubusercontent.com/pricify-ai/pc-hardware-prices/main/indices/pricify-indices.csv` and `.../main/latest/json/rams.live.json`. The collector does not scrape the live Pricify/rams.live website or retailer pages. The open data is released **weekly**, even though it contains daily observations. Its latest recorded date, not the collection date, is displayed.

### Consumer memory

The [index documentation](https://raw.githubusercontent.com/pricify-ai/pc-hardware-prices/ed6f528f5b28fd778c2401b1c98d4feb8d4b9a06/indices/README.md) defines DDR4 and DDR5 as new, in-stock **non-ECC desktop and laptop** memory. Marketplace, used, open-box and refurbished units are excluded. The `level` field is the day's median dollars per gigabyte. The separate chained `value` is an index and is **not a dollar price**.

The bootstrap has 32 real daily values per generation, October 1–November 1, 2026. No earlier values from a different publisher or cohort are joined to them. Product mix varies, so a median may change even when an individual kit does not.

### Enterprise / workstation ECC RDIMM

The [weekly schema](https://raw.githubusercontent.com/pricify-ai/pc-hardware-prices/ed6f528f5b28fd778c2401b1c98d4feb8d4b9a06/SCHEMA.md) defines the daily value as the lowest in-stock retailer-owned price for a new unit. It may require **in-store pickup**, as it does for the selected modules/kits in the latest bootstrap release. These exact SKUs are examples of ECC RDIMM purchase prices, not a datacenter contract-price index or a guarantee of server/platform compatibility.

| Selection | Exact part | Raw pricing basis | Available bootstrap history |
| --- | --- | --- | --- |
| G.SKILL G5 64GB DDR5-5600 CL46 ECC RDIMM | `F5-5600R4645A64GX1-G5`, Pricify product `11133` | One 64GB module | October 19–November 1, 2026; 14 daily observations |
| Kingston FURY Renegade Pro 128GB DDR5-5600 CL28 ECC RDIMM | `KF556R28RBE2K4-128`, product `2554` | A 4×32GB kit, 128GB total | October 5–November 1, 2026; 28 daily observations |
| TEAMGROUP T-Create Master 128GB DDR5-6000 CL30 ECC RDIMM | `CTCMD5128G6000HC30FQC01`, product `2425` | A 4×32GB kit, 128GB total | October 5–November 1, 2026; 28 daily observations |

The raw module/kit USD price is retained. The graph divides it by 64GB or 128GB to show USD/GB. A 128GB kit is never represented as a single 128GB module. Part number, UPC, product ID, name, URL, currency, timezone and release identity must match; a substitute is rejected.

### Changes and reliability

Changes made to the licensed data: selected five series; retained actual source prices and calendar dates; formatted daily dates as UTC-midnight markers with explicit day precision and source timezone **America/New_York**; divided raw module/kit prices by exact total capacity for graph display. Estimates are display-only and are never written into the price dataset.

The weekly release includes only the publisher's currently selected products. If an exact SKU is absent from a newer release, collection retains its last actual quote and marks the series stale rather than substituting another product or claiming stock loss. Source errors, oversized responses, changed identities and conflicting previously recorded dates also preserve older verified observations. The ten-day freshness threshold allows for weekly publication and release lag; successful polling never advances a quote's date.

## Compute: GPU Price Tracker and official current pricing

The bootstrap retains 1,750 genuine dated observations for six Runpod Secure Cloud GPU rates and one Azure East US Linux T4 VM rate, from [GPU Price Tracker / Alex Hubbard](https://huggingface.co/datasets/afhubbard/gpu-prices). Dataset revision: `619c00aaca1294a95da0987c5833e281e55380b1`, licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). This credit and license remain visible below the graph. Changes: selected seven exact-provider histories and normalized timestamp strings to millisecond ISO format. No earlier or missing prices were synthesized.

Future observations are collected anonymously from Runpod's public GraphQL catalog at `api.runpod.io/graphql` and [Microsoft's official Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices). Runpod prices are per GPU-hour for one GPU in Secure Cloud, not Community Cloud. The Azure T4 price is per instance-hour for `Standard_NC4as_T4_v3` in East US, Linux on-demand. Capacity is unconfirmed; additional storage, networking and tax can apply. Effective rate start dates never become fabricated observation times. The graph displays the actual collection/quote date.

## Other source candidates not copied

Public accessibility alone is not a public reuse license. No permission was inferred from the live Pricify website, ram.24h.sh, retailer pages, or the private tracker's prior sources. This source review verifies the publisher's explicit grant for its open repository data; it is not a broader legal opinion about third-party websites.
