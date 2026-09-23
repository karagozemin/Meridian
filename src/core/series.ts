import { pct } from "../lib/format.js";
import { CALC_VERSION, type Sample } from "../types.js";

/**
 * Formats the sampler log for the page.
 *
 * Only one calculation version is included. Older rows stay in their quarantine files
 * and are not passed in here; if one does appear in the active log it is counted and
 * dropped, not averaged in.
 *
 * The page reports the readings. It does not say the gap widens on weekends or closes
 * at the open. There is no evidence for that in this series.
 */

export interface SeriesRow {
  sampledAt: string;
  symbol: string;
  issuerPeriod: string;
  gap: string;
  sizeTokens: string;
}

export interface SeriesView {
  calcVersion: string;
  count: number;
  excludedOtherVersions: number;
  windowStart: string;
  windowEnd: string;
  windowText: string;
  regimeText: string;
  claimText: string;
  headers: string[];
  rows: SeriesRow[];
}

const CLAIM =
  "These rows are the readings in this calculation version. They are not a claim that the gap widens on weekends or closes when the regular session opens.";

function excludedLabel(count: number): string {
  return count === 1
    ? "1 reading from another calculation version was left out."
    : `${count} readings from another calculation version were left out.`;
}

function span(startMs: number, endMs: number): string {
  const seconds = Math.max(0, Math.round((endMs - startMs) / 1000));
  if (seconds < 90) return `${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} minutes`;
  const hours = seconds / 3600;
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} hours`;
}

export function presentSeries(
  samples: readonly Sample[],
  calcVersion: string = CALC_VERSION,
): SeriesView {
  const included = samples
    .filter((sample) => sample.calcVersion === calcVersion)
    .slice()
    .sort((a, b) => a.sampledAt.localeCompare(b.sampledAt) || a.symbol.localeCompare(b.symbol));
  const excludedOtherVersions = samples.length - included.length;

  const headers = [
    "Taken at",
    "Asset",
    "Issuer period",
    "Gap, pricing only",
    "Size (tokens)",
  ];

  if (included.length === 0) {
    return {
      calcVersion,
      count: 0,
      excludedOtherVersions,
      windowStart: "—",
      windowEnd: "—",
      windowText:
        excludedOtherVersions > 0
          ? `No readings in ${calcVersion}. ${excludedLabel(excludedOtherVersions)}`
          : `No readings in ${calcVersion}.`,
      regimeText: "No issuer period to report.",
      claimText: CLAIM,
      headers,
      rows: [],
    };
  }

  const first = included[0];
  const last = included[included.length - 1];
  const start = first?.sampledAt ?? "—";
  const end = last?.sampledAt ?? "—";
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  const duration =
    Number.isFinite(startMs) && Number.isFinite(endMs) ? span(startMs, endMs) : "an unknown span";

  const periods = new Map<string, number>();
  for (const sample of included) {
    const period = sample.issuerTrading.currentPeriod ?? "unreported";
    periods.set(period, (periods.get(period) ?? 0) + 1);
  }
  const regimeText = `Issuer periods in these readings: ${[...periods.entries()]
    .map(([period, count]) => `${period} (${count})`)
    .join(", ")}. The period is the issuer's currentPeriod, not the local clock.`;

  const leftOut =
    excludedOtherVersions > 0 ? ` ${excludedLabel(excludedOtherVersions)}` : "";
  const noun = included.length === 1 ? "reading" : "readings";

  return {
    calcVersion,
    count: included.length,
    excludedOtherVersions,
    windowStart: start,
    windowEnd: end,
    windowText: `${included.length} ${noun}, from ${start} to ${end} (${duration}), calculation ${calcVersion}.${leftOut}`,
    regimeText,
    claimText: CLAIM,
    headers,
    rows: included.map((sample) => ({
      sampledAt: sample.sampledAt,
      symbol: sample.symbol,
      issuerPeriod: sample.issuerTrading.currentPeriod ?? "—",
      gap: pct(sample.referenceGapAtMinSize, 4),
      sizeTokens:
        sample.referenceGapMinSizeTokens === null
          ? "—"
          : String(sample.referenceGapMinSizeTokens),
    })),
  };
}
