import type { ReferenceQuote } from "../types.js";

/**
 * Client for the xStocks (Backed) public API.
 *
 * This is the issuer's own indicative price. Per their developer docs it is sourced
 * from cached on-chain providers plus Nasdaq, with Blue Ocean supplying overnight and
 * extended-hours pricing. It is the independent anchor that OKX's own `market index`
 * does not provide for these assets — which is the comparison Meridian exists to show.
 *
 * Public endpoints need no authentication. The executable bid/ask feed
 * (`/trades/xchange/assets/{identifier}`) does require an API key and is not wired up yet.
 */

const BASE_URL = "https://api.xstocks.fi/api/v2";
const TIMEOUT_MS = 12_000;

async function getJson<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${path}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Latest indicative price for a tokenized asset.
 *
 * The endpoint returns `{ "quote": number }` and carries no timestamp of its own, so
 * we record our own fetch time and let the UI present that as the data age. Failures
 * resolve rather than throw: a sample missing its reference is still worth keeping, and
 * showing a blank is better than showing a stale number as if it were current.
 */
export async function fetchReferenceQuote(symbol: string): Promise<ReferenceQuote> {
  const fetchedAt = new Date().toISOString();
  try {
    const body = await getJson<{ quote?: number }>(
      `/public/assets/${encodeURIComponent(symbol)}/price-data`,
    );
    const quote = typeof body.quote === "number" ? body.quote : null;
    return {
      symbol,
      quote,
      fetchedAt,
      // The endpoint returns a bare { quote }. If it ever starts reporting when the
      // price was produced, read it here instead of inferring freshness from fetchedAt.
      sourceTimestamp: null,
      sourceAgeStatus: "source_timestamp_unknown",
      error: quote === null ? "response contained no numeric quote" : null,
    };
  } catch (cause) {
    return {
      symbol,
      quote: null,
      fetchedAt,
      sourceTimestamp: null,
      sourceAgeStatus: "source_timestamp_unknown",
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export interface IssuerTradingState {
  /** Issuer's own session label, e.g. "market" / "extended" / "overnight" / "closed". */
  currentPeriod: string | null;
  openNow: boolean | null;
  /** ISO instant at which the current period ends. */
  nextChangeAt: string | null;
  /** e.g. "TwentyFourFive". */
  tradingHoursMode: string | null;
  isTradingHalted: boolean | null;
  /** Issuer's max order size for the current period. Zero means it will not trade at all. */
  maxOrderFiatValue: number | null;
  exchange: string | null;
  error: string | null;
  fetchedAt: string;
}

/**
 * Reads the issuer's declared trading state for an asset.
 *
 * Preferred over deriving the session from a local calendar. The issuer knows its own
 * holiday schedule, half days and venue changes; a hand-rolled clock only encodes what
 * we remembered to put in it. Use the local clock as a fallback, not as the source.
 */
export async function fetchTradingState(symbol: string): Promise<IssuerTradingState> {
  const fetchedAt = new Date().toISOString();
  const empty: IssuerTradingState = {
    currentPeriod: null,
    openNow: null,
    nextChangeAt: null,
    tradingHoursMode: null,
    isTradingHalted: null,
    maxOrderFiatValue: null,
    exchange: null,
    error: null,
    fetchedAt,
  };

  try {
    const body = await getJson<{
      trading?: {
        currentPeriod?: string;
        openNow?: boolean;
        nextChangeAt?: string;
        tradingHoursMode?: string;
        isTradingHalted?: boolean;
        exchange?: { abbreviation?: string };
        limitsPerPeriod?: Record<string, { maxOrderFiatValue?: number }>;
      };
    }>(`/public/assets/${encodeURIComponent(symbol)}`);

    const trading = body.trading;
    if (!trading) return { ...empty, error: "response contained no trading block" };

    const period = trading.currentPeriod ?? null;
    const limits = period ? trading.limitsPerPeriod?.[period] : undefined;

    return {
      currentPeriod: period,
      openNow: trading.openNow ?? null,
      nextChangeAt: trading.nextChangeAt ?? null,
      tradingHoursMode: trading.tradingHoursMode ?? null,
      isTradingHalted: trading.isTradingHalted ?? null,
      maxOrderFiatValue: limits?.maxOrderFiatValue ?? null,
      exchange: trading.exchange?.abbreviation ?? null,
      error: null,
      fetchedAt,
    };
  } catch (cause) {
    return { ...empty, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** Issuer deployment record for one network. */
export interface Deployment {
  network: string;
  address: string;
  wrapperAddressV2: string | null;
}

/**
 * Deployments of an asset, used to confirm our X Layer addresses against the issuer
 * rather than trusting a token-search result.
 */
export async function fetchDeployments(symbol: string): Promise<Deployment[] | null> {
  try {
    const body = await getJson<{
      deployments?: Array<{
        network?: string;
        address?: string;
        wrapperAddressV2?: string | null;
      }>;
    }>(`/public/assets/${encodeURIComponent(symbol)}`);
    if (!body.deployments) return null;
    return body.deployments.map((d) => ({
      network: d.network ?? "unknown",
      address: (d.address ?? "").toLowerCase(),
      wrapperAddressV2: d.wrapperAddressV2 ? d.wrapperAddressV2.toLowerCase() : null,
    }));
  } catch {
    return null;
  }
}

export interface AssetMultiplier {
  current: number | null;
  pending: number | null;
  raw: unknown;
}

/**
 * Corporate-action multiplier for an asset on a given network.
 *
 * Splits and similar events change how many underlying shares one token represents.
 * Comparing a pool price to a reference price without accounting for this produces a
 * gap that looks like mispricing but is not.
 *
 * The `network` query parameter is required — omitting it returns a validation error.
 * The correct value for X Layer is still unconfirmed; see the open questions in the spec.
 */
export async function fetchMultiplier(
  symbol: string,
  network: string,
): Promise<AssetMultiplier | null> {
  try {
    const raw = await getJson<Record<string, unknown>>(
      `/public/assets/${encodeURIComponent(symbol)}/multiplier?network=${encodeURIComponent(network)}`,
    );
    const num = (key: string): number | null => {
      const value = raw[key];
      return typeof value === "number" ? value : null;
    };
    return { current: num("current"), pending: num("pending"), raw };
  } catch {
    return null;
  }
}

/** Full issuer record for an asset, used to confirm our X Layer addresses are the real ones. */
export async function fetchAsset(symbol: string): Promise<Record<string, unknown> | null> {
  try {
    return await getJson<Record<string, unknown>>(
      `/public/assets/${encodeURIComponent(symbol)}`,
    );
  } catch {
    return null;
  }
}

/** Every tokenized asset the issuer publishes. */
export async function listAssets(): Promise<unknown[] | null> {
  try {
    const body = await getJson<unknown>("/public/assets");
    return Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}
