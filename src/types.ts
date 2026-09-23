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

/** A single `swap quote` observation at one trade size. */
export interface QuoteObservation {
  /** Size in whole tokens that was quoted. */
  sizeTokens: number;
  /** Notional at the spot price, in the quote currency. */
  notional: number;
  /** Spot unit price reported by the router. */
  spotPrice: number;
  /** Proceeds divided by size — what the trade actually clears at. */
  effectivePrice: number;
  /** effectivePrice / spotPrice - 1, as a fraction. Negative for sells. */
  priceImpact: number;
  /** Routing split, e.g. "Uniswap V3 52.57%". Empty when the router gave no breakdown. */
  route: string[];
}

/** `market price` vs `market index` for one token. */
export interface IndexProbe {
  poolPrice: number | null;
  indexPrice: number | null;
  /** indexPrice / poolPrice - 1. Null when either side is missing. */
  divergence: number | null;
  /**
   * True when the two feeds are byte-identical. For tokenized stocks this has been
   * observed to hold exactly, while control tokens (USDG, WOKB) diverge — which is
   * the whole reason this probe exists.
   */
  identical: boolean;
}

/** Issuer-published indicative price. */
export interface ReferenceQuote {
  symbol: string;
  quote: number | null;
  /** When we fetched it. The issuer does not return its own timestamp on this endpoint. */
  fetchedAt: string;
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
  sampledAt: string;
  symbol: string;
  underlying: string;
  address: string;

  session: SessionState;
  index: IndexProbe;
  reference: ReferenceQuote;

  /** Quotes at the configured ladder of trade sizes. */
  quotes: QuoteObservation[];

  /** Pool price minus issuer reference, as a fraction of the reference. */
  referenceGap: number | null;

  pools: PoolSnapshot[];
  totalPoolLiquidityUsd: number | null;

  /** Non-fatal problems encountered while building this sample. */
  warnings: string[];
}
