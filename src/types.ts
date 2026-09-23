/**
 * Shared domain types for Meridian.
 *
 * Design rule carried over from the product spec: Meridian never asserts a "fair value".
 * Every number that leaves this module is either a direct measurement or an explicitly
 * labelled comparison between two named sources. Anything we could not read is `null`,
 * never estimated.
 */

/** X Layer mainnet. OKX APIs call this `chainIndex`. */
export const X_LAYER_CHAIN_INDEX = 196;

/** Chain alias accepted by `onchainos swap`. */
export const X_LAYER_CHAIN_ALIAS = "xlayer";

/**
 * Trading regime of the underlying US equity at a given instant.
 *
 * `overnight` is the Blue Ocean ATS session, which is what xStocks cites as its
 * off-hours price source. It is not the same as `closed`: during `closed` there is
 * no live reference session anywhere and the issuer quote is necessarily stale.
 */
export type SessionRegime = "regular" | "extended" | "overnight" | "closed";

export interface SessionState {
  regime: SessionRegime;
  /** ET wall-clock the classification was made against, e.g. "2026-10-07 23:14". */
  easternTime: string;
  /** True when the date is a recognised US market holiday. */
  isHoliday: boolean;
  /** Human-readable reason, surfaced in the UI so the classification is auditable. */
  detail: string;
}

/** A tokenized equity we track, as deployed on X Layer. */
export interface TrackedAsset {
  /** xStocks ticker, e.g. "NVDAx". Used verbatim in issuer API paths. */
  symbol: string;
  /** Underlying listed equity, e.g. "NVDA". */
  underlying: string;
  /** Token contract on X Layer. */
  address: string;
  /** Wrapped variant, which is what the deepest pool is usually quoted against. */
  wrappedAddress: string;
  /** Contract used for swap quotes — the side with real routing depth. */
  quoteFromAddress: string;
  decimals: number;
}

/**
 * A single routed quote at one trade size.
 *
 * Deliberately not called "slippage". Realised slippage is a settled trade measured
 * against the quote that preceded it. This is a quote curve across sizes, which is a
 * different thing, and conflating the two would overstate what we know.
 */
/**
 * USD value of the token the router denominates output in.
 *
 * Kept as its own record rather than folded into the prices, so a reader can see which
 * parity was applied to a given sample instead of having to trust it.
 */
export interface QuoteTokenRate {
  symbol: string;
  address: string;
  usdPerQuoteToken: number | null;
  deviationFromParity: number | null;
  fetchedAt: string;
  error: string | null;
}

export interface QuoteObservation {
  /** Size in whole wrapped tokens that was quoted. */
  sizeTokens: number;
  /** Notional at the router's reference unit price, in the quote currency. */
  notional: number;
  /**
   * Unit price reported by the router alongside the quote.
   *
   * OKX documents this as a general USD reference price, not the spot price of any
   * specific pool, so it is named accordingly and never presented as a pool price.
   */
  routerUnitPrice: number;
  /** Quote-token proceeds divided by size sold. Denominated per *wrapped* token. */
  effectivePricePerWrapped: number;
  /**
   * Effective price restated per underlying token, so it can be compared with the
   * issuer reference. Null when the wrapper rate is unverified.
   */
  effectivePricePerUnderlying: number | null;
  /** effectivePricePerWrapped / routerUnitPrice - 1. Cost of size, not realised slippage. */
  sizeImpact: number;
  /** Routing split, e.g. "Uniswap V3 52.57%". Empty when the router gave no breakdown. */
  route: string[];
}

/** `market price` vs `market index` for one token. */
export interface IndexProbe {
  /**
   * Value returned by `onchainos market price`.
   *
   * Named for its source, not its meaning: it is OKX's market price for the token, and
   * we have not read any specific pool's reserves to call it a pool spot price.
   */
  okxMarketPrice: number | null;
  okxIndexPrice: number | null;
  /** okxIndexPrice / okxMarketPrice - 1. Null when either side is missing. */
  divergence: number | null;
  /**
   * True when the two feeds return exactly the same value.
   *
   * This is an observation about two API responses, not a claim about how the index is
   * constructed. Control tokens diverge, which is what makes the equality on the
   * equities worth recording.
   */
  identical: boolean;
}

/** Whether the issuer quote's own production time is known to us. */
export type SourceAgeStatus = "source_timestamp_known" | "source_timestamp_unknown";

/** Issuer-published indicative price. */
export interface ReferenceQuote {
  symbol: string;
  quote: number | null;
  /** When our request completed. Says nothing about when the price was produced. */
  fetchedAt: string;
  /**
   * When the source produced the price, if it tells us.
   *
   * The public `price-data` endpoint returns a bare `{ quote }` with no timestamp, so
   * this is normally null. A freshly fetched response is not the same as a freshly
   * produced price and must never be displayed as "0 minutes old".
   */
  sourceTimestamp: string | null;
  sourceAgeStatus: SourceAgeStatus;
  /** Populated when the request failed, so the UI can show a blank instead of a guess. */
  error: string | null;
}

/** One liquidity pool backing the asset. */
export interface PoolSnapshot {
  pair: string;
  protocol: string;
  liquidityUsd: number;
  feePercent: string | null;
  poolAddress: string;
}

/**
 * One complete observation of an asset, written as a single line to the sample log.
 *
 * Every field is nullable on purpose: a partial sample is more useful than a dropped
 * one, and the UI renders missing data as missing rather than filling it in.
 */
export interface Sample {
  /** Unique id for this observation, so a row can be cited without ambiguity. */
  sampleId: string;
  sampledAt: string;
  /** Wall-clock duration of the whole observation, for latency auditing. */
  durationMs: number;

  symbol: string;
  underlying: string;
  /** Underlying token on X Layer, issuer-confirmed. */
  address: string;
  /** Wrapped token the pools actually quote against. */
  wrappedAddress: string;

  /** Locally derived session, kept as a cross-check against the issuer's own state. */
  session: SessionState;
  /** Issuer's declared trading state. Authoritative when present. */
  issuerTrading: IssuerTradingStateRecord;

  index: IndexProbe;
  reference: ReferenceQuote;

  /** Wrapped-to-underlying conversion, and whether it could be verified. */
  normalization: NormalizationRecord;

  /** Quotes across the configured ladder of trade sizes. */
  quotes: QuoteObservation[];

  /**
   * Difference between the size-matched effective price (per underlying) and the issuer
   * reference, as a fraction of the reference.
   *
   * Null whenever normalization is unverified — an unnormalised comparison carries an
   * error several times larger than the quantity being measured.
   */
  quoteTokenRate: QuoteTokenRate;
  referenceGap: number | null;
  /** Ladder rung the gap was computed from, so the comparison is reproducible. */
  referenceGapBasisTokens: number | null;

  /**
   * Same comparison at the smallest quoted size, where size impact is negligible.
   *
   * Kept separate on purpose. `referenceGap` at the basis size folds two distinct
   * effects together — how the market is priced relative to the reference, and what it
   * costs to trade in size. Reporting only the combined figure would attribute execution
   * cost to mispricing.
   */
  referenceGapAtMinSize: number | null;
  referenceGapMinSizeTokens: number | null;

  pools: PoolSnapshot[];
  totalPoolLiquidityUsd: number | null;

  /** Provenance: which tooling produced this row. */
  cliVersion: string | null;
  calcVersion: string;

  /** Non-fatal problems encountered while building this sample. */
  warnings: string[];
}

export interface IssuerTradingStateRecord {
  currentPeriod: string | null;
  openNow: boolean | null;
  nextChangeAt: string | null;
  tradingHoursMode: string | null;
  isTradingHalted: boolean | null;
  maxOrderFiatValue: number | null;
  exchange: string | null;
  fetchedAt: string;
  error: string | null;
}

export interface NormalizationRecord {
  status: "verified" | "unverified";
  /** Underlying tokens represented by one wrapped token. */
  assetsPerShare: number | null;
  /** Underlying reported by the wrapper contract, for cross-checking our mapping. */
  underlyingAddress: string | null;
  readAt: string;
  error: string | null;
}

/** Bumped whenever the derivation of any computed field changes. */
export const CALC_VERSION = "2026-09-23.3-usd-denominated";
