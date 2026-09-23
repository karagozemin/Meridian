import { QUOTE_SIZE_LADDER } from "../config/assets.js";
import { fetchReferenceQuote } from "../lib/xstocks.js";
import { classifySession } from "../lib/session.js";
import { probeIndex } from "./index-probe.js";
import { fetchPools, totalLiquidity } from "./depth.js";
import { quoteLadder } from "./quotes.js";
import type { Sample, TrackedAsset } from "../types.js";

/**
 * Takes one complete observation of an asset.
 *
 * Every feed is allowed to fail independently. A partial sample is kept and the failure
 * is recorded as a warning, because a gap in the series is worse than a row with a hole
 * in it — and because a feed being down is itself something the product reports rather
 * than hides.
 */
export async function takeSample(
  asset: TrackedAsset,
  sizes: readonly number[] = QUOTE_SIZE_LADDER,
): Promise<Sample> {
  const sampledAt = new Date().toISOString();
  const warnings: string[] = [];

  const [index, reference, pools, quotes] = await Promise.all([
    probeIndex(asset.address),
    fetchReferenceQuote(asset.symbol),
    fetchPools(asset.address),
    quoteLadder(asset, sizes),
  ]);

  if (index.poolPrice === null) warnings.push("pool price unavailable");
  if (index.indexPrice === null) warnings.push("index price unavailable");
  if (reference.error) warnings.push(`issuer reference: ${reference.error}`);
  if (pools.length === 0) warnings.push("no pools returned");
  if (quotes.length < sizes.length) {
    warnings.push(`router quoted ${quotes.length} of ${sizes.length} sizes`);
  }

  // Pool price relative to the issuer's indicative quote. Named as a gap against a
  // specific, timestamped source — not as a premium to fair value, which we do not claim.
  const referenceGap =
    index.poolPrice !== null && reference.quote !== null && reference.quote !== 0
      ? index.poolPrice / reference.quote - 1
      : null;

  return {
    sampledAt,
    symbol: asset.symbol,
    underlying: asset.underlying,
    address: asset.address,
    session: classifySession(new Date(sampledAt)),
    index,
    reference,
    quotes,
    referenceGap,
    pools,
    totalPoolLiquidityUsd: totalLiquidity(pools),
    warnings,
  };
}

/** Samples several assets in sequence, keeping load on the aggregator predictable. */
export async function takeSamples(
  assets: readonly TrackedAsset[],
  sizes: readonly number[] = QUOTE_SIZE_LADDER,
): Promise<Sample[]> {
  const samples: Sample[] = [];
  for (const asset of assets) {
    samples.push(await takeSample(asset, sizes));
  }
  return samples;
}
