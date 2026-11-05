"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildPriceCurve } from "../lib/price-curve.mjs";

type Precision = "day" | "instant";
type DisplayUnit = "GB" | "gpu-hour" | "hour";
type Observation = { price: number | null; currency: string; observedAt: string; precision?: Precision; evidenceUrl?: string };
type PriceWatch = {
  id: string; title: string; category: string; url: string | null; capacityGB: number | null;
  price: number | null; observedAt: string | null; lastSuccessAt: string | null; lastAttemptAt?: string | null; status: string;
  inStock: boolean | null; error: string | null; history: Observation[];
  selectionLabel?: string; selectorGroup?: string; sourceLabel?: string; sourceNote?: string;
  displayUnit?: DisplayUnit; priceDivisor?: number; datePrecision?: Precision;
  sampleCadenceHours?: number; maxGapHours?: number; freshnessHours?: number; historical?: boolean; activeSeries?: boolean; archiveOnly?: boolean; staleReason?: string;
  attributionUrl?: string; attributionLabel?: string; licenseUrl?: string; historyNote?: string;
};
type View = "memory" | "compute";
type Dashboard = { items: PriceWatch[]; serverTime: string };
const HOUR = 3_600_000;
const ranges = [{ label: "1M", hours: 30 * 24 }, { label: "3M", hours: 90 * 24 }, { label: "1Y", hours: 365 * 24 }, { label: "ALL", hours: Infinity }];
const divisorFor = (watch: PriceWatch | null, view: View) => watch?.priceDivisor && watch.priceDivisor > 0 ? watch.priceDivisor : view === "compute" ? 1 : watch?.capacityGB || 1;
const unitFor = (watch: PriceWatch | null, view: View): DisplayUnit => watch?.displayUnit || (view === "compute" ? "hour" : "GB");
const unitLabel = (unit: DisplayUnit) => unit === "gpu-hour" ? "GPU-hour" : unit;
const dollars = (value: number, unit: DisplayUnit) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: unit === "GB" && value >= 1 ? 2 : 3 }).format(value);
const date = (value: string | number, precision: Precision = "instant", time = false, year = false) => new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}),
  ...(precision === "day" ? { timeZone: "UTC" } : time ? { hour: "numeric", minute: "2-digit" } : {}),
}).format(new Date(value));
const hasPrices = (item: PriceWatch) => item.price != null && item.price > 0 || item.history.some((p) => p.price != null && p.price > 0);
const selectorGroups: Record<string, string> = { Desktop: "Consumer", Datacenter: "Enterprise", "Consumer GPUs": "Consumer", "Datacenter GPUs": "Enterprise" };
const groupFor = (item: PriceWatch) => selectorGroups[item.selectorGroup || ""] || item.selectorGroup || "Available series";

function PriceCurve({ watch, hours, now, view }: { watch: PriceWatch | null; hours: number; now: number; view: View }) {
  const [hover, setHover] = useState<number | null>(null);
  const curveRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(920);
  useEffect(() => {
    if (!curveRef.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    observer.observe(curveRef.current);
    return () => observer.disconnect();
  }, []);
  const divisor = divisorFor(watch, view);
  const unit = unitFor(watch, view);
  const precision = watch?.datePrecision || "instant";
  const format = (value: number) => dollars(value, unit);
  const recordedTimes = (watch?.history || []).filter((p) => p.currency === "USD" && p.price != null && p.price > 0 && Number.isFinite(Date.parse(p.observedAt)) && Date.parse(p.observedAt) <= now).map((p) => Date.parse(p.observedAt));
  const firstRecorded = Math.min(...recordedTimes);
  const cutoff = Number.isFinite(hours) ? now - hours * HOUR : Number.isFinite(firstRecorded) ? firstRecorded : now - 90 * 24 * HOUR;
  const minimumSpan = precision === "day" ? 24 * HOUR : recordedTimes.filter((time) => time >= cutoff).length >= 2 ? 300_000 : HOUR;
  const start = Number.isFinite(firstRecorded)
    ? Number.isFinite(hours) ? Math.max(cutoff, Math.min(firstRecorded, now - minimumSpan)) : Math.min(firstRecorded, now - minimumSpan)
    : cutoff;
  const rows = useMemo(() => (watch?.history || [])
    .filter((p) => Number.isFinite(Date.parse(p.observedAt)) && Date.parse(p.observedAt) <= now)
    .map((p) => ({ price: p.currency === "USD" && p.price != null && p.price > 0 ? p.price / divisor : null, time: Date.parse(p.observedAt), precision: p.precision || watch?.datePrecision || "instant" as Precision }))
    .sort((a, b) => a.time - b.time), [watch, divisor, now]);
  const maxGap = (watch?.maxGapHours || (watch?.sampleCadenceHours ? watch.sampleCadenceHours * 2.2 : 13)) * HOUR;
  const { samples, segments, bridges, projection } = useMemo(() => buildPriceCurve(rows, {start, end: now, maxGap}), [rows, start, now, maxGap]);
  const values = [...segments.flat(), ...bridges.flat(), ...(projection?.points || [])].map((p) => p.price);
  const current = watch?.price != null && watch.price > 0 ? watch.price / divisor : 0;
  const low = values.length ? Math.min(...values) : current;
  const high = values.length ? Math.max(...values) : current;
  const padding = Math.max((high - low) * .15, high * .04, unit === "GB" ? .001 : .005);
  const bottom = Math.max(0, low - padding);
  const top = Math.max(bottom + (unit === "GB" ? .002 : .01), high + padding);
  const right = width - 18;
  const x = (time: number) => 58 + ((time - start) / Math.max(1, now - start)) * (right - 58);
  const y = (price: number) => 290 - ((price - bottom) / (top - bottom)) * 246;
  const pathFor = (path: {time: number; price: number}[]) => path.map((p, i) => `${i ? "L" : "M"}${x(p.time).toFixed(2)},${y(p.price).toFixed(2)}`).join(" ");
  const estimated = bridges.length > 0 || projection != null;
  const active = hover != null ? samples[hover] : undefined;
  const labelCount = width < 520 ? 3 : 5;
  const labels = Array.from({ length: labelCount }, (_, i) => start + ((now - start) / (labelCount - 1)) * i);
  const shortSpan = precision === "instant" && now - start < 48 * HOUR;
  const showYear = now - start > 300 * 24 * HOUR;
  const summary = samples.length
    ? `${watch?.title}: ${samples.length} observed ${samples.length === 1 ? "price" : "prices"} ${Number.isFinite(hours) ? `over the selected ${hours / 24} days` : "across all available history"}, from ${date(samples[0].time, samples[0].precision, true, true)} at ${format(samples[0].price)} to ${date(samples.at(-1)!.time, samples.at(-1)!.precision, true, true)} at ${format(samples.at(-1)!.price)} per ${unitLabel(unit)}.`
    : `No recorded ${view} quotes in this period.`;
  const estimateNote = projection
    ? `${bridges.length ? "Dashed gaps are interpolated. " : ""}${projection.method === "linear" ? "Dashed estimate follows the last 90 days of quotes" : "Dashed estimate holds the last quote"}, after ${date(projection.since, precision, false, true)}.`
    : "Dashed lines estimate the trend between recorded quotes.";
  const estimateLabel = projection
    ? `Dashed = estimated${bridges.length ? " between quotes and" : ""} after ${date(projection.since, precision, false, true)}`
    : "Dashed = estimated between recorded quotes";
  return <div className="curve" ref={curveRef} onMouseLeave={() => setHover(null)}>
    <svg viewBox={`0 0 ${width} 350`} role="img" aria-label={`${summary}${estimated ? ` ${estimateNote}` : ""}`} onMouseMove={(event) => {
      if (!samples.length) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const cursor = ((event.clientX - rect.left) / rect.width) * width;
      let nearest = 0;
      for (let n = 1; n < samples.length; n++) if (Math.abs(x(samples[n].time) - cursor) < Math.abs(x(samples[nearest].time) - cursor)) nearest = n;
      setHover(nearest);
    }}>
      <defs><linearGradient id="price-wash" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#64794f" stopOpacity=".10" /><stop offset="100%" stopColor="#64794f" stopOpacity="0" /></linearGradient></defs>
      {[0, 1, 2, 3].map((i) => { const value = bottom + ((top - bottom) / 3) * i; return <g key={i}><line x1="58" y1={y(value)} x2={right} y2={y(value)} stroke="#d8d8c8" strokeWidth=".8" strokeDasharray={i ? "2 6" : undefined} /><text x="0" y={y(value) + 4} className="axis-label">{values.length || current ? format(value) : "—"}</text></g>; })}
      {labels.map((time, i) => <text key={time} x={x(time)} y="328" textAnchor={i === 0 ? "start" : i === labelCount - 1 ? "end" : "middle"} className="axis-label">{shortSpan ? i === 0 || i === labelCount - 1 ? date(time, precision, true) : new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(time) : date(time, precision, false, showYear)}</text>)}
      {bridges.map((bridge, index) => <path key={`gap-${index}`} d={pathFor(bridge)} className="estimated-line"><title>Estimated between recorded quotes</title></path>)}
      {projection && <path d={pathFor(projection.points)} className="estimated-line"><title>{estimateNote}</title></path>}
      {segments.map((segment, index) => {
        const path = pathFor(segment);
        return segment.length > 1 ? <g key={index}><path d={`${path} L${x(segment.at(-1)!.time)},290 L${x(segment[0].time)},290 Z`} fill="url(#price-wash)" /><path d={path} fill="none" stroke="#566b43" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></g> : <circle key={index} cx={x(segment[0].time)} cy={y(segment[0].price)} r="3" fill="#566b43" />;
      })}
      {samples.length > 0 && <circle cx={x(samples.at(-1)!.time)} cy={y(samples.at(-1)!.price)} r="4" fill="#566b43" stroke="#f0eadb" strokeWidth="2"><title>{date(samples.at(-1)!.time, samples.at(-1)!.precision, true, true)} · {format(samples.at(-1)!.price)} / {unitLabel(unit)}</title></circle>}
      {active && <><line x1={x(active.time)} y1="30" x2={x(active.time)} y2="290" stroke="#96a485" strokeWidth="1" strokeDasharray="3 5" /><circle cx={x(active.time)} cy={y(active.price)} r="4" fill="#566b43" stroke="#f0eadb" strokeWidth="2" /></>}
    </svg>
    {active && <div className="curve-value" aria-hidden="true"><strong>{format(active.price)} <span>/ {unitLabel(unit)}</span></strong><span>{date(active.time, active.precision, true, true)}</span></div>}
    {samples.length === 0 && !estimated && <div className="curve-start"><p>{watch?.history?.length ? "No recorded prices in this period." : "No archived prices for this selection."}</p></div>}
    {estimated && <p className="curve-note" title={estimateNote}><span aria-hidden="true" />{estimateLabel}</p>}
  </div>;
}

export default function Home() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [view, setView] = useState<View>("memory");
  const [search, setSearch] = useState("");
  const [hash, setHash] = useState("");
  const [hours, setHours] = useState(Infinity);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [embed, setEmbed] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch(new URL("./data/prices.json", document.baseURI), { cache: "no-store" });
      const body = await response.json() as Dashboard & { error?: string };
      if (!response.ok) throw new Error(body.error || "The price could not be loaded.");
      setData(body); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "The price could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const readLocation = () => {
      const params = new URLSearchParams(window.location.search);
      setSearch(window.location.search); setHash(window.location.hash);
      setView(params.get("view") === "compute" ? "compute" : "memory");
      setEmbed(params.get("embed") === "1");
    };
    readLocation(); window.addEventListener("popstate", readLocation); void load();
    const timer = setInterval(() => void load(), 60000);
    return () => { clearInterval(timer); window.removeEventListener("popstate", readLocation); };
  }, [load]);
  useEffect(() => { document.title = `${view === "compute" ? "Compute" : "Memory"} prices — tentimes`; }, [view]);
  const memoryChoices = useMemo(() => (data?.items || []).filter((item) => item.category === "ram" && item.activeSeries !== false && hasPrices(item)), [data]);
  const computeChoices = useMemo(() => (data?.items || []).filter((item) => item.category === "cloud" && item.activeSeries !== false && hasPrices(item)), [data]);
  const params = new URLSearchParams(search);
  const resolve = (choices: PriceWatch[], requested: string | null, preferred: string) => choices.find((item) => item.id === requested) || choices.find((item) => item.id === preferred) || choices[0] || null;
  const memory = resolve(memoryChoices, params.get("memory"), "ram-pricify-ddr5");
  const compute = resolve(computeChoices, params.get("gpu"), "runpod-h100-sxm");
  useEffect(() => {
    if (!data) return;
    const next = new URLSearchParams(search);
    let changed = false;
    for (const [key, choices, selected] of [["memory", memoryChoices, memory], ["gpu", computeChoices, compute]] as const) {
      const requested = next.get(key);
      if (requested && !choices.some((item) => item.id === requested)) {
        if (selected) next.set(key, selected.id); else next.delete(key);
        changed = true;
      }
    }
    if (changed) {
      const query = next.toString();
      window.history.replaceState(null, "", `${query ? `?${query}` : "./"}${hash}`);
      setSearch(window.location.search);
    }
  }, [data, search, hash, memoryChoices, computeChoices, memory, compute]);
  const hrefFor = (next: View) => {
    const query = new URLSearchParams(search);
    if (next === "compute") query.set("view", "compute"); else query.delete("view");
    return `${query.size ? `?${query}` : "./"}${hash}`;
  };
  const selectView = (next: View) => {
    if (next === view) return;
    window.history.pushState(null, "", hrefFor(next)); setSearch(window.location.search); setView(next);
  };
  const selectSeries = (id: string) => {
    const next = new URLSearchParams(search);
    next.set(view === "compute" ? "gpu" : "memory", id);
    window.history.pushState(null, "", `?${next}${hash}`); setSearch(window.location.search);
  };
  const watch = view === "compute" ? compute : memory;
  const choices = view === "compute" ? computeChoices : memoryChoices;
  const unit = unitFor(watch, view);
  const now = Date.now();
  const pricedHistory = watch?.history.filter((p) => p.currency === "USD" && p.price != null && p.price > 0 && Date.parse(p.observedAt) <= now).sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt)) || [];
  const firstObservation = pricedHistory[0];
  const lastObservation = pricedHistory.at(-1);
  const latestPrice = watch?.price != null && watch.price > 0 ? watch.price : lastObservation?.price ?? null;
  const price = latestPrice != null ? latestPrice / divisorFor(watch, view) : null;
  const lastPriceAt = watch?.observedAt || lastObservation?.observedAt;
  const quoteIsOld = !!lastPriceAt && now - Date.parse(lastPriceAt) > (watch?.freshnessHours || 24) * HOUR;
  const lastCheckAt = watch?.lastAttemptAt || watch?.lastSuccessAt || data?.serverTime;
  const refreshOverdue = !!lastCheckAt && now - Date.parse(lastCheckAt) > 12 * HOUR;
  const groups = [...new Set(choices.map(groupFor))];
  const precision = watch?.datePrecision || "instant";
  return <div className={`memory-page${embed ? " embedded" : ""}`}>
    <header className="masthead"><a className="wordmark" href="./">tentimes</a><span className="masthead-rule" /><nav className="view-tabs" aria-label="Price graph">
      {(["memory", "compute"] as const).map((tab) => <a key={tab} className={view === tab ? "active" : ""} href={hrefFor(tab)} aria-current={view === tab ? "page" : undefined} onClick={(event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); selectView(tab); }}>{tab}</a>)}
    </nav></header>
    <main>
      <div className="title-row"><h1>{view === "compute" ? "Compute" : "Memory"} prices<span>.</span></h1></div>
      <div className="price-row"><div className="price"><span>{price == null ? "—" : dollars(price, unit)}</span><small>{watch?.archiveOnly || quoteIsOld ? <>Last recorded<br /></> : null}USD / {unitLabel(unit)}</small></div>
        <div className="series-picker"><select aria-label={view === "compute" ? "GPU model" : "Memory type"} value={watch?.id || ""} onChange={(event) => selectSeries(event.target.value)} disabled={!choices.length}>
          {!choices.length && <option value="">{loading ? "Loading…" : "No archived series"}</option>}
          {groups.length > 1 ? groups.map((group) => <optgroup key={group} label={group}>{choices.filter((item) => groupFor(item) === group).map((item) => <option key={item.id} value={item.id}>{item.selectionLabel || item.title}</option>)}</optgroup>) : choices.map((item) => <option key={item.id} value={item.id}>{item.selectionLabel || item.title}</option>)}
        </select><span aria-hidden="true">⌄</span></div>
      </div>
      <div className="range-row"><div className="ranges" role="group" aria-label="Price history period">{ranges.map((range) => <button key={range.label} className={hours === range.hours ? "active" : ""} aria-pressed={hours === range.hours} onClick={() => setHours(range.hours)}>{range.label}</button>)}</div></div>
      {loading ? <div className="loading-curve" role="status">Loading {view} prices…</div> : <PriceCurve key={`${view}:${watch?.id || "empty"}`} watch={watch} hours={hours} now={now} view={view} />}
      <footer className="chart-footer">
        <div className="footer-sources">
          <details className="source-footnote" key={watch?.id || "empty"}>
            <summary>Sources<sup>1</sup></summary>
            <div className="source-details">
              {watch?.url ? <a href={watch.url} target="_blank" rel="noreferrer">{watch.sourceLabel || watch.title} ↗</a> : <span>{watch?.sourceLabel || "Published price observations"}</span>}
              {watch?.sourceNote && <p>{watch.sourceNote}</p>}
              {watch?.historyNote && <p>{watch.historyNote}</p>}
              {firstObservation && <p>History since {date(firstObservation.observedAt, firstObservation.precision || precision, false, true)}.</p>}
              {(watch?.lastAttemptAt || watch?.lastSuccessAt) && <p>Last source check {date((watch.lastAttemptAt || watch.lastSuccessAt)!, "instant", true, true)}.</p>}
              {watch?.archiveOnly && lastPriceAt && <p>Last recorded quote: {date(lastPriceAt, lastObservation?.precision || precision, false, true)}. This source has no newer quotes; the later dashed line is an estimate.</p>}
              <p>Dashed gaps connect recorded quotes. An estimate after the last quote uses its preceding 90 days of daily quotes, or holds the last quote when there is too little history. Estimates are never stored as prices.</p>
            </div>
          </details>
          {(watch?.attributionUrl || watch?.licenseUrl) && <span className="footer-credit">
            {watch.attributionUrl && watch.attributionLabel && <a href={watch.attributionUrl} target="_blank" rel="noreferrer">{watch.attributionLabel}</a>}
            {watch.licenseUrl && <>{watch.attributionUrl && watch.attributionLabel ? " · " : ""}<a href={watch.licenseUrl} target="_blank" rel="noreferrer">CC BY 4.0</a></>}
          </span>}
        </div>
        <span className="quote-note">{lastPriceAt ? `${watch?.archiveOnly || quoteIsOld ? "Last recorded" : "Latest quote"} ${date(lastPriceAt, lastObservation?.precision || precision, false, true)}` : "Awaiting source data"}</span>
      </footer>
      {(error || watch?.error || refreshOverdue || quoteIsOld || !watch?.archiveOnly && watch?.status === "stale") && <p className="source-error" role="status">{error || watch?.error || (refreshOverdue ? "The scheduled source check is overdue. Showing the last recorded quotes." : "Showing the last recorded price. A newer quote is not available.")}</p>}
    </main>
  </div>;
}
