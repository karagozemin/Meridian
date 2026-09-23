import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { TRACKED_ASSETS } from "../config/assets.js";
import { tryRun } from "../lib/onchainos.js";
import { classifySession } from "../lib/session.js";
import { X_LAYER_CHAIN_INDEX } from "../types.js";
import { pad, padStart, share, usd } from "../lib/format.js";

/**
 * Measures how much tokenized-stock volume occurs outside the regular US session.
 *
 * A first pass at this used hourly candles and produced a figure that could not be
 * defended: the regular session opens at 13:30 UTC, so the 13:00-14:00 candle straddles
 * two regimes and assigning it wholly to either side moves the answer.
 *
 * This version fixes that and the other reproducibility problems:
 *
 *  - 30-minute candles, which align to :00 and :30. Both session boundaries (09:30 and
 *    16:00 ET) land exactly on a boundary, so no candle spans two regimes.
 *  - Session membership is derived in Eastern Time, so it stays correct across DST
 *    rather than assuming the summer UTC offset.
 *  - Unconfirmed (still-forming) candles are dropped, since their volume is partial.
 *  - Gaps and duplicate timestamps are detected and reported rather than silently summed.
 *  - The raw API response and the resolved window are written to disk, so the number can
 *    be recomputed later against exactly the same input.
 *
 * Usage: npm run volume-study
 */

const BAR = "30m";
const BAR_MINUTES = 30;
const LIMIT = 299; // API maximum, ~6.2 days at this bar size.
const OUTPUT_DIR = resolve(process.cwd(), "data", "volume-study");

interface Candle {
  ts: string;
  o: string;
  h: string;
  l: string;
  c: string;
  vol: string;
  volUsd: string;
  confirm: string;
}

interface Bucket {
  regular: number;
  extended: number;
  overnight: number;
  closed: number;
}

const emptyBucket = (): Bucket => ({ regular: 0, extended: 0, overnight: 0, closed: 0 });

interface AssetResult {
  symbol: string;
  address: string;
  buckets: Bucket;
  barsUsed: number;
  barsDropped: number;
  duplicates: number;
  gaps: number;
  windowStart: string;
  windowEnd: string;
}

function summarise(
  symbol: string,
  address: string,
  candles: Candle[],
  window: { startMs: number; endMs: number },
): AssetResult {
  const buckets = emptyBucket();
  const seen = new Set<string>();
  let duplicates = 0;
  let barsDropped = 0;

  // Only closed candles carry a complete volume figure.
  const confirmed = candles.filter((candle) => {
    if (candle.confirm !== "1") {
      barsDropped += 1;
      return false;
    }
    return true;
  });

  // Restrict to the window shared by every asset, so the combined figure is not a sum
  // over three different intervals.
  const sorted = [...confirmed]
    .filter((candle) => {
      const ts = Number(candle.ts);
      return ts >= window.startMs && ts < window.endMs;
    })
    .sort((a, b) => Number(a.ts) - Number(b.ts));

  let gaps = 0;
  let previousTs: number | null = null;
  for (const candle of sorted) {
    const ts = Number(candle.ts);

    if (seen.has(candle.ts)) {
      duplicates += 1;
      continue;
    }
    seen.add(candle.ts);

    if (previousTs !== null) {
      const expected: number = previousTs + BAR_MINUTES * 60_000;
      if (ts !== expected) gaps += Math.max(0, Math.round((ts - expected) / (BAR_MINUTES * 60_000)));
    }
    previousTs = ts;

    // A candle covers [ts, ts + BAR). Classify by its midpoint so the label reflects the
    // interval rather than an endpoint that may coincide with a session boundary.
    const midpoint = new Date(ts + (BAR_MINUTES * 60_000) / 2);
    const regime = classifySession(midpoint).regime;
    buckets[regime] += Number(candle.volUsd || 0);
  }

  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  return {
    symbol,
    address,
    buckets,
    barsUsed: seen.size,
    barsDropped,
    duplicates,
    gaps,
    windowStart: first ? new Date(Number(first.ts)).toISOString() : "—",
    windowEnd: last
      ? new Date(Number(last.ts) + BAR_MINUTES * 60_000).toISOString()
      : "—",
  };
}

const totalOf = (b: Bucket): number => b.regular + b.extended + b.overnight + b.closed;
const outsideRegularOf = (b: Bucket): number => b.extended + b.overnight + b.closed;

async function main(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const runAt = new Date().toISOString();
  const results: AssetResult[] = [];
  const fetched: Array<{ asset: (typeof TRACKED_ASSETS)[number]; data: Candle[] }> = [];

  for (const asset of TRACKED_ASSETS) {
    const { data, error } = await tryRun<Candle[]>([
      "market",
      "kline",
      "--address",
      asset.address,
      "--chain",
      String(X_LAYER_CHAIN_INDEX),
      "--bar",
      BAR,
      "--limit",
      String(LIMIT),
    ]);

    if (!data) {
      process.stderr.write(`${asset.symbol}: ${error ?? "no data"}\n`);
      continue;
    }

    // Raw response first, so the computation can be re-run against identical input.
    await writeFile(
      resolve(OUTPUT_DIR, `${asset.symbol}-${BAR}-${runAt.replace(/[:.]/g, "-")}.json`),
      JSON.stringify({ runAt, symbol: asset.symbol, address: asset.address, bar: BAR, data }, null, 2),
      "utf8",
    );

    fetched.push({ asset, data });
  }

  // Intersection of every asset's confirmed range. Bars outside it are excluded so that
  // each asset contributes the same interval to the total.
  const ranges = fetched.map(({ data }) => {
    const ts = data.filter((c) => c.confirm === "1").map((c) => Number(c.ts));
    return { start: Math.min(...ts), end: Math.max(...ts) + BAR_MINUTES * 60_000 };
  });
  const window = {
    startMs: Math.max(...ranges.map((r) => r.start)),
    endMs: Math.min(...ranges.map((r) => r.end)),
  };

  for (const { asset, data } of fetched) {
    results.push(summarise(asset.symbol, asset.address, data, window));
  }

  process.stdout.write(
    `Volume by session regime\n` +
      `  bar          : ${BAR} (aligned to session boundaries)\n` +
      `  run at       : ${runAt}\n` +
      `  window       : ${new Date(window.startMs).toISOString()} -> ${new Date(window.endMs).toISOString()}\n` +
      `                 (intersection of all assets' confirmed ranges)\n` +
      `  raw responses: ${OUTPUT_DIR}\n\n`,
  );

  process.stdout.write(
    pad("ASSET", 9) +
      padStart("regular", 14) +
      padStart("extended", 14) +
      padStart("overnight", 14) +
      padStart("closed", 14) +
      padStart("outside reg.", 14) +
      "\n",
  );

  const combined = emptyBucket();
  for (const result of results) {
    const b = result.buckets;
    combined.regular += b.regular;
    combined.extended += b.extended;
    combined.overnight += b.overnight;
    combined.closed += b.closed;

    const total = totalOf(b);
    process.stdout.write(
      pad(result.symbol, 9) +
        padStart(usd(b.regular, 0), 14) +
        padStart(usd(b.extended, 0), 14) +
        padStart(usd(b.overnight, 0), 14) +
        padStart(usd(b.closed, 0), 14) +
        padStart(total > 0 ? share(outsideRegularOf(b) / total) : "—", 14) +
        "\n",
    );
  }

  const combinedTotal = totalOf(combined);
  process.stdout.write(
    pad("TOTAL", 9) +
      padStart(usd(combined.regular, 0), 14) +
      padStart(usd(combined.extended, 0), 14) +
      padStart(usd(combined.overnight, 0), 14) +
      padStart(usd(combined.closed, 0), 14) +
      padStart(combinedTotal > 0 ? share(outsideRegularOf(combined) / combinedTotal) : "—", 14) +
      "\n\n",
  );

  process.stdout.write(
    `Outside regular session : ${share(outsideRegularOf(combined) / combinedTotal)}\n` +
      `  of which extended     : ${share(combined.extended / combinedTotal)} (pre/post market, reference exists)\n` +
      `  of which overnight    : ${share(combined.overnight / combinedTotal)} (Blue Ocean, reference exists)\n` +
      `  of which fully closed : ${share(combined.closed / combinedTotal)} (no venue quoting the underlying)\n\n`,
  );

  process.stdout.write("Data quality\n");
  for (const result of results) {
    process.stdout.write(
      `  ${pad(result.symbol, 9)}bars ${result.barsUsed}` +
        `, dropped ${result.barsDropped} unconfirmed` +
        `, ${result.duplicates} duplicates, ${result.gaps} missing\n` +
        `  ${pad("", 9)}window ${result.windowStart} -> ${result.windowEnd}\n`,
    );
  }

  await writeFile(
    resolve(OUTPUT_DIR, `summary-${runAt.replace(/[:.]/g, "-")}.json`),
    JSON.stringify({ runAt, bar: BAR, limit: LIMIT, window, results, combined }, null, 2),
    "utf8",
  );
}

void main();
