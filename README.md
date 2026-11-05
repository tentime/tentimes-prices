# tentimes / prices

**Moved:** the live graphs are [Memory](https://tentimes.engineer/memory/) and [Compute](https://tentimes.engineer/compute/). Their canonical source and single six-hour update/publishing workflow now live under `_prices/` in the root `tentime/tentime.github.io` repository. This repository is a retained prototype; its Pages deployment and pricing workflow are disabled. Make future website changes in the root repository.

A small Memory and Compute price graph. The entire public site, source data and update process live in this repository and deploy to **GitHub Pages**.

- **Consumer memory:** Pricify DDR4 and DDR5 consumer price levels in USD/GB, covering non-ECC desktop and laptop memory.
- **Enterprise memory:** exact ECC RDIMM references. A single 64GB G.SKILL module is separate from the Kingston and TEAMGROUP 128GB **4×32GB kits**. These are individual retail references, not a datacenter contract-price index.
- **Compute:** six Runpod Secure Cloud GPU rental rates and one Azure T4 VM rate, with exact provider, billing unit and archived source attribution.

## Automatic publishing

`.github/workflows/pages.yml` runs on every push to `main`, every six hours at minute 23 (UTC), and manually from the Actions tab. It installs locked dependencies, runs tests, collects public-source prices, commits the updated `public/data/prices.json`, builds the static app and deploys GitHub Pages. No separate database, cloud service, API key, ChatGPT task or running laptop is required by this public site.

The Action uses GitHub's built-in workflow token with repository write access only in the collection/build job; the Pages deployment job has Pages/OIDC permissions. Official actions are pinned to commit hashes. If a source fails, its valid prior quotes remain available and the failure is marked in the data and workflow. A partial collection can publish valid quotes, but a final reporting job makes the run fail visibly. A failed build does not replace the live site.

GitHub schedules are best effort: a job can queue or be delayed. Check the **Actions** tab for execution history. The browser re-reads the published data once a minute; new upstream quotes appear after a successful collection and Pages deployment, subject to GitHub's cache.

## Source dates and reuse

Memory data comes only from [Pricify's CC BY 4.0 open repository](https://github.com/pricify-ai/pc-hardware-prices), not its separately offered live data. The verified initial release was published November 3, 2026 with daily quotes through **November 1**; new releases are weekly. Checking every six hours does not turn weekly data into real-time pricing. The Sources footnote links the publisher and license, states the pricing basis and shows the actual quote/check dates.

The enterprise quote is a daily lowest new in-stock retailer price and may be **Micro Center in-store only**; it is not necessarily a shipped offer. Consumer prices are a source-specific aggregate and are not joined to the earlier private prototype's Newegg medians. Old Memory.net archives and other memory histories without verified public reuse terms are excluded from this repository.

GPU archived data is [Alex Hubbard's GPU Price Tracker](https://huggingface.co/datasets/afhubbard/gpu-prices), CC BY 4.0; future quotes use official Runpod/Azure public pricing endpoints. Rates exclude possible storage, networking and tax and do not guarantee available capacity. See [source licenses](docs/source-licenses.md) for attribution and provenance.

Stored history contains **actual dated quotes only**. Dashed lines connect gaps or show a labeled display-only estimate when a source becomes overdue. Estimates never enter the data file or replace the last recorded headline price. Different products and billing units remain separate.

## Local work

Use Node 22.13+:

```sh
npm ci
npm test
npm run refresh
npm run dev
```

`npm run build` creates `dist/`; `npm run preview` serves that build. The app uses relative asset/data links and works under the GitHub project path. To update the public website, commit and push changes to `main`; the same Action collects prices and publishes them. Use **Actions → Refresh prices and publish Pages → Run workflow** for an immediate manual refresh.

The prior ChatGPT Sites deployment is a separate private prototype. This public app does not call its APIs or depend on its schedule.
