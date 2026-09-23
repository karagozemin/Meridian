import { QUOTE_TOKEN, QUOTE_SIZE_LADDER } from "../config/assets.js";
import { tryRun } from "../lib/onchainos.js";
import { X_LAYER_CHAIN_ALIAS, type QuoteObservation, type TrackedAsset } from "../types.js";

/**
 * Builds the slippage ladder: what a trade of a given size actually clears at.
 *
 * This is the number the user never sees before trading. The token page shows a unit
 * price; the router shows what you receive. On a pool whose headline liquidity reads
 * in the millions, a six-figure order can still clear more than a percent away from
 * the quoted price. Quoting a ladder rather than a single size is what makes that visible.
 */

/** Shape of `onchainos swap quote` output, kept loose because the router's split varies. */
interface RawQuote {
  toTokenAmount?: string;
  dexRouterList?: Array<{
    dexProtocol?: unknown;
    fromToken?: { tokenUnitPrice?: string; decimal?: string; tokenSymbol?: string };
    toToken?: { tokenUnitPrice?: string; decimal?: string; tokenSymbol?: string };
  }>;
}

function firstObject(data: unknown): RawQuote | null {
  if (Array.isArray(data)) return (data[0] as RawQuote) ?? null;
  if (data && typeof data === "object") return data as RawQuote;
  return null;
}

/** Flattens whatever shape the router used to describe the split into display strings. */
function describeRoute(quote: RawQuote): string[] {
  const routes: string[] = [];
  for (const leg of quote.dexRouterList ?? []) {
    const protocol = leg.dexProtocol;
    const entries = Array.isArray(protocol) ? protocol : protocol ? [protocol] : [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const { dexName, percent } = entry as { dexName?: string; percent?: string };
      if (dexName) routes.push(percent ? `${dexName} ${percent}%` : dexName);
    }
  }
  return routes;
}

/**
 * Quotes selling `sizeTokens` of `asset` into the quote stablecoin.
 *
 * Returns `null` when the router declines to quote — thin books and paused pools both
 * produce that, and either is information we surface rather than paper over.
 */
export async function quoteSize(
  asset: TrackedAsset,
  sizeTokens: number,
): Promise<QuoteObservation | null> {
  const { data } = await tryRun<unknown>([
    "swap",
    "quote",
    "--from",
    asset.quoteFromAddress,
    "--to",
    QUOTE_TOKEN.address,
    "--readable-amount",
    String(sizeTokens),
    "--chain",
    X_LAYER_CHAIN_ALIAS,
  ]);

  const quote = firstObject(data);
  if (!quote) return null;

  const spotPrice = Number(quote.dexRouterList?.[0]?.fromToken?.tokenUnitPrice);
  const rawProceeds = Number(quote.toTokenAmount);
  if (!Number.isFinite(spotPrice) || !Number.isFinite(rawProceeds) || spotPrice <= 0) {
    return null;
  }

  const proceeds = rawProceeds / 10 ** QUOTE_TOKEN.decimals;
  const effectivePrice = proceeds / sizeTokens;

  return {
    sizeTokens,
    notional: sizeTokens * spotPrice,
    spotPrice,
    effectivePrice,
    priceImpact: effectivePrice / spotPrice - 1,
    route: describeRoute(quote),
  };
}

/**
 * Quotes the whole ladder.
 *
 * Sizes are quoted sequentially rather than in parallel: the aggregator rate-limits,
 * and a ladder with holes in it is worse than one that takes a few seconds longer.
 */
export async function quoteLadder(
  asset: TrackedAsset,
  sizes: readonly number[] = QUOTE_SIZE_LADDER,
): Promise<QuoteObservation[]> {
  const observations: QuoteObservation[] = [];
  for (const size of sizes) {
    const observation = await quoteSize(asset, size);
    if (observation) observations.push(observation);
  }
  return observations;
}

/** Picks the ladder rung closest to a target notional, for "what does $100k cost" questions. */
export function nearestByNotional(
  ladder: QuoteObservation[],
  targetNotional: number,
): QuoteObservation | null {
  if (ladder.length === 0) return null;
  return ladder.reduce((best, current) =>
    Math.abs(current.notional - targetNotional) < Math.abs(best.notional - targetNotional)
      ? current
      : best,
  );
}
