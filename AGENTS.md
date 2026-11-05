# Project and publication

This is the canonical public Tentimes prices site. It is a static React/Vite app on **GitHub Pages**, with all pricing data and update logic in this repository. Do not move it to ChatGPT Sites, Cloudflare Workers, or a separate database.

Future website updates must be committed and pushed to the GitHub repository. `.github/workflows/pages.yml` refreshes pricing, runs checks, preserves real observations, and deploys Pages on every push to main, every six hours, or a manual Actions run. Verify the actual Action and live Pages result after a push. Do not add a second scheduler.

Keep the UI minimal: Memory and Compute tabs, native type/model selector, one graph, time ranges, compact Sources footnote. Preserve the cream/olive Tentimes style. Actual quote dates, weekly source cadence, exact module versus kit capacity, source identity and public-use licenses must stay truthful. Do not join different sources or products into one price history, or store estimated prices as observations.

Use only sources with verified public reuse terms; keep attribution and license links. No private archives from the earlier prototype belong in this repository. No credentials or API keys are needed by the collectors; use GitHub's built-in workflow token for data commits and Pages deployment.

Do not install or use Playwright or its browsers. Use the isolated in-app browser for UI checks, without touching the user's browser.
