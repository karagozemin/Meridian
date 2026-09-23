import type { ControlResult } from "./index-probe.js";
import { exact, pct, share, usd } from "../lib/format.js";
import type { Sample } from "../types.js";

/**
 * Formats one sample for the pre-trade page.
 *
 * This module does not measure anything and does not derive a price. Every figure below
 * is a field already stored on the sample (or on a control probe), rendered as text.
 * A missing figure becomes an em dash plus the reason it is missing.
 */

export interface TextField {
  text: string;
  reason: string | null;
}

export interface TableRow {
  requested: boolean;
  cells: string[];
}

export interface ControlRow {
  symbol: string;
  market: string;
  index: string;
  divergence: string;
  identical: boolean;
}

export interface PanelView {
  symbol: string;
  underlying: string;
  address: string;
  sampleId: string;
  sampledAt: string;
  durationMs: string;
  calcVersion: string;
  cliVersion: string;
  issuerPeriod: TextField;
  issuerOpenNow: TextField;
  issuerNextChange: TextField;
  issuerHalt: TextField;
  issuerHours: TextField;
  localSessionCrossCheck: string;
  normalizationStatus: string;
  wrapRate: TextField;
  comparisonHidden: boolean;
  comparisonHiddenReason: string | null;
  effectiveUsd: TextField;
  referencePrice: TextField;
  referenceSource: string;
  referenceFetchedAt: string;
  referenceAgeNote: string;
  gapAtRequestedSize: TextField;
  requestedSizeLabel: string;
  gapAtMinSize: TextField;
  minSizeLabel: string;
  sameSizeNote: string | null;
  okxMarketPrice: TextField;
  okxIndexPrice: TextField;
  indexNote: string;
  indexDivergence: TextField;
  quoteTokenSymbol: string;
  quoteTokenParity: TextField;
  quoteTokenDeviation: TextField;
  quoteTokenFetchedAt: string;
  ladderHeaders: string[];
  ladder: TableRow[];
  ladderNote: string;
  requestedRoute: string;
  poolHeaders: string[];
  pools: TableRow[];
  totalLiquidity: TextField;
  stableShare: TextField;
  poolNote: string;
  warnings: string[];
  controls: ControlRow[];
  controlsNote: string;
}

const REFERENCE_SOURCE = "xStocks public price-data";
const REFERENCE_AGE_NOTE =
  "The issuer does not publish a generation timestamp, so the age of this price is unknown. The time shown is when Meridian fetched it.";
const LADDER_NOTE =
  "Notional uses the router's unit price. Effective price is what the router would actually deliver after fees and route impact, restated in USD per underlying share. Size impact is the cost of trading that size, not realised slippage.";
const POOL_NOTE =
  "Headline liquidity is the sum across every pool. The stable-quoted share is the portion paired against USDG, USDC, or USDT. A listed fee is already inside the effective price and is not subtracted again.";
const CONTROLS_NOTE =
  "Control tokens are assets that are not tokenized equities. They are here because the two feeds diverge for them, which is what makes an exact match on an equity worth recording.";

function num(value: number | null, render: (n: number) => string, reason: string): TextField {
  if (value === null || !Number.isFinite(value)) return { text: "—", reason };
  return { text: render(value), reason: null };
}

function str(value: string | null, reason: string): TextField {
  if (value === null || value.length === 0) return { text: "—", reason };
  return { text: value, reason: null };
}

function bool(value: boolean | null, reason: string): TextField {
  if (value === null) return { text: "—", reason };
  return { text: value ? "true" : "false", reason: null };
}

function hiddenReason(sample: Sample): string | null {
  if (sample.normalization.status !== "verified") {
    return `Comparison withheld: the wrapped-to-underlying rate was not verified${
      sample.normalization.error ? ` (${sample.normalization.error})` : ""
    }.`;
  }
  if (sample.quoteTokenRate.usdPerQuoteToken === null) {
    return `Comparison withheld: USDG/USD parity was not read${
      sample.quoteTokenRate.error ? ` (${sample.quoteTokenRate.error})` : ""
    }. The quote-token price was not relabelled as USD.`;
  }
  if (sample.reference.quote === null) {
    return `Comparison withheld: the issuer reference was not read${
      sample.reference.error ? ` (${sample.reference.error})` : ""
    }.`;
  }
  return null;
}

export function presentPanel(sample: Sample, controls: readonly ControlResult[]): PanelView {
  const requested =
    sample.requestedSizeTokens === null
      ? undefined
      : sample.quotes.find((quote) => quote.sizeTokens === sample.requestedSizeTokens);
  const withheld = hiddenReason(sample);

  const effectiveReason = requested
    ? withheld ?? "effective USD price unavailable"
    : `the router did not quote ${sample.requestedSizeTokens ?? "the requested"} tokens`;

  return {
    symbol: sample.symbol,
    underlying: sample.underlying,
    address: sample.address,
    sampleId: sample.sampleId,
    sampledAt: sample.sampledAt,
    durationMs: `${sample.durationMs} ms`,
    calcVersion: sample.calcVersion,
    cliVersion: sample.cliVersion ?? "—",
    issuerPeriod: str(
      sample.issuerTrading.currentPeriod,
      sample.issuerTrading.error ?? "issuer did not return a session period",
    ),
    issuerOpenNow: bool(
      sample.issuerTrading.openNow,
      sample.issuerTrading.error ?? "issuer did not return openNow",
    ),
    issuerNextChange: str(
      sample.issuerTrading.nextChangeAt,
      sample.issuerTrading.error ?? "issuer did not return the next session change",
    ),
    issuerHalt: bool(
      sample.issuerTrading.isTradingHalted,
      sample.issuerTrading.error ?? "issuer did not return a halt flag",
    ),
    issuerHours: str(
      sample.issuerTrading.tradingHoursMode,
      sample.issuerTrading.error ?? "issuer did not return trading hours",
    ),
    localSessionCrossCheck: `${sample.session.regime} — ${sample.session.detail} (${sample.session.easternTime}). Local clock only; the issuer period above is the one to trust.`,
    normalizationStatus: sample.normalization.status,
    wrapRate: num(
      sample.normalization.assetsPerShare,
      (value) => `${value} underlying per wrapped`,
      sample.normalization.error ?? "wrapper rate was not read",
    ),
    comparisonHidden: withheld !== null,
    comparisonHiddenReason: withheld,
    effectiveUsd: num(
      withheld ? null : (requested?.effectivePriceUsdPerUnderlying ?? null),
      (value) => usd(value),
      effectiveReason,
    ),
    referencePrice: num(
      sample.reference.quote,
      (value) => usd(value, 3),
      sample.reference.error ?? "issuer reference was not read",
    ),
    referenceSource: REFERENCE_SOURCE,
    referenceFetchedAt: sample.reference.fetchedAt,
    referenceAgeNote: REFERENCE_AGE_NOTE,
    gapAtRequestedSize: num(
      sample.referenceGapAtRequestedSize,
      (value) => pct(value, 4),
      withheld ?? "gap at the requested size is unavailable",
    ),
    requestedSizeLabel:
      sample.requestedSizeTokens === null
        ? "requested size"
        : `${sample.requestedSizeTokens} tokens — pricing plus size cost`,
    gapAtMinSize: num(
      sample.referenceGapAtMinSize,
      (value) => pct(value, 4),
      withheld ?? "gap at the smallest size is unavailable",
    ),
    minSizeLabel:
      sample.referenceGapMinSizeTokens === null
        ? "smallest quoted size — pricing only, excludes size cost"
        : `${sample.referenceGapMinSizeTokens} tokens — pricing only, excludes size cost`,
    sameSizeNote:
      sample.requestedSizeTokens !== null &&
      sample.requestedSizeTokens === sample.referenceGapMinSizeTokens
        ? "The requested size is the smallest size quoted, so these two readings are the same measurement."
        : null,
    okxMarketPrice: num(
      sample.index.okxMarketPrice,
      (value) => exact(value),
      "OKX market price was not returned",
    ),
    okxIndexPrice: num(
      sample.index.okxIndexPrice,
      (value) => exact(value),
      "OKX market index was not returned",
    ),
    indexNote: sample.index.identical
      ? "These two endpoints returned the same value. That is an observation about two responses, not a description of how the index is built."
      : sample.index.okxMarketPrice === null || sample.index.okxIndexPrice === null
        ? "One of the two feeds did not return a price."
        : "These two endpoints returned different values.",
    indexDivergence: num(
      sample.index.divergence,
      (value) => pct(value, 4),
      "divergence is unavailable because one feed did not return a price",
    ),
    quoteTokenSymbol: sample.quoteTokenRate.symbol,
    quoteTokenParity: num(
      sample.quoteTokenRate.usdPerQuoteToken,
      (value) => exact(value),
      sample.quoteTokenRate.error ?? "USDG/USD parity was not read",
    ),
    quoteTokenDeviation: num(
      sample.quoteTokenRate.deviationFromParity,
      (value) => pct(value, 4),
      sample.quoteTokenRate.error ?? "USDG/USD parity was not read",
    ),
    quoteTokenFetchedAt: sample.quoteTokenRate.fetchedAt,
    ladderHeaders: [
      "Size (tokens)",
      "Router notional",
      "Eff. / wrapped (USDG)",
      "Eff. / underlying (USD)",
      "Size impact",
    ],
    ladder: sample.quotes.map((quote) => ({
      requested: quote.sizeTokens === sample.requestedSizeTokens,
      cells: [
        String(quote.sizeTokens),
        usd(quote.notional, 0),
        usd(quote.effectivePricePerWrapped),
        usd(quote.effectivePriceUsdPerUnderlying),
        pct(quote.sizeImpact),
      ],
    })),
    ladderNote: LADDER_NOTE,
    requestedRoute:
      requested && requested.route.length > 0
        ? requested.route.join(", ")
        : "—",
    poolHeaders: ["Pair", "Protocol", "Liquidity (USD)", "Fee"],
    pools: sample.pools.map((pool) => ({
      requested: false,
      cells: [
        pool.pair,
        pool.protocol,
        usd(pool.liquidityUsd, 0),
        pool.feePercent ?? "—",
      ],
    })),
    totalLiquidity: num(
      sample.totalPoolLiquidityUsd,
      (value) => usd(value, 0),
      "no pools returned",
    ),
    stableShare: num(sample.stableQuotedShare, (value) => share(value), "no pools returned"),
    poolNote: POOL_NOTE,
    warnings: sample.warnings,
    controls: controls.map((control) => ({
      symbol: control.symbol,
      market: exact(control.probe.okxMarketPrice),
      index: exact(control.probe.okxIndexPrice),
      divergence: pct(control.probe.divergence, 4),
      identical: control.probe.identical,
    })),
    controlsNote: CONTROLS_NOTE,
  };
}
