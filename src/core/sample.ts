import { randomUUID } from "node:crypto";
import { QUOTE_SIZE_LADDER } from "../config/assets.js";
import { fetchReferenceQuote, fetchTradingState } from "../lib/xstocks.js";
import { classifySession } from "../lib/session.js";
import { readWrapperRate } from "../lib/wrapper.js";
import { version as cliVersion } from "../lib/onchainos.js";
import { probeIndex } from "./index-probe.js";
import { fetchPools, totalLiquidity } from "./depth.js";
import { quoteLadder, nearestByNotional } from "./quotes.js";
import { CALC_VERSION, type Sample, type TrackedAsset } from "../types.js";

/**
 * Notional the reference comparison is anchored to.
 *
 * The gap is computed from the ladder rung closest to this figure and the rung's actual
 * size is recorded alongside it, so a quote for ~$112k is never reported as a $100k trade.
 */
const REFERENCE_BASIS_NOTIONAL = 100_000;

let cachedCliVersion: string | null | undefined;

async function resolveCliVersion(): Promise<string | null> {
  if (cachedCliVersion !== undefined) return cachedCliVersion;
  try {
    cachedCliVersion = await cliVersion();
  } catch {
    cachedCliVersion = null;
  }
  return cachedCliVersion;
}

/**
 * Takes one complete observation of an asset.
 *
 * Every feed is allowed to fail independently. A partial sample is kept and the failure
 * is recorded as a warning, because a gap in the series is worse than a row with a hole
 * in it — and because a feed being down is itself something the product reports.
 *
 * Ordering matters in one place: the wrapper rate is read first, because the quote ladder
 * cannot be restated in underlying terms without it, and an unnormalised comparison is
 * worse than no comparison.
 */
export async function takeSample(
  asset: TrackedAsset,
  sizes: readonly number[] = QUOTE_SIZE_LADDER,
): Promise<Sample> {
  const startedAt = Date.now();
  const sampledAt = new Date().toISOString();
  const warnings: string[] = [];

  const normalization = await readWrapperRate(asset.wrappedAddress, asset.address);
  if (normalization.status !== "verified") {
    warnings.push(`wrapper rate unverified: ${normalization.error ?? "unknown reason"}`);
  }

  const [index, reference, issuerTrading, pools, quotes, resolvedCli] = await Promise.all([
    probeIndex(asset.address),
    fetchReferenceQuote(asset.symbol),
    fetchTradingState(asset.symbol),
    fetchPools(asset.address),
    quoteLadder(asset, normalization, sizes),
    resolveCliVersion(),
  ]);

  if (index.okxMarketPrice === null) warnings.push("okx market price unavailable");
  if (index.okxIndexPrice === null) warnings.push("okx index price unavailable");
  if (reference.error) warnings.push(`issuer reference: ${reference.error}`);
  if (issuerTrading.error) warnings.push(`issuer trading state: ${issuerTrading.error}`);
  if (pools.length === 0) warnings.push("no pools returned");
  if (quotes.length < sizes.length) {
    warnings.push(`router quoted ${quotes.length} of ${sizes.length} sizes`);
  }

  // Compare like with like: a size-matched effective price, restated per underlying
  // token, against the issuer's underlying-denominated reference. Any missing piece
  // yields null rather than a comparison we cannot defend.
  const basis = nearestByNotional(quotes, REFERENCE_BASIS_NOTIONAL);
  const effective = basis?.effectivePricePerUnderlying ?? null;
  const referenceGap =
    effective !== null && reference.quote !== null && reference.quote !== 0
      ? effective / reference.quote - 1
      : null;

  // The same comparison at the smallest rung isolates pricing from execution cost.
  const minRung = quotes.length > 0 ? quotes[0] : undefined;
  const minEffective = minRung?.effectivePricePerUnderlying ?? null;
  const referenceGapAtMinSize =
    minEffective !== null && reference.quote !== null && reference.quote !== 0
      ? minEffective / reference.quote - 1
      : null;

  if (referenceGap === null && normalization.status !== "verified") {
    warnings.push("reference gap suppressed: wrapped-to-underlying rate not verified");
  }

  return {
    sampleId: randomUUID(),
    sampledAt,
    durationMs: Date.now() - startedAt,
    symbol: asset.symbol,
    underlying: asset.underlying,
    address: asset.address,
    wrappedAddress: asset.wrappedAddress,
    session: classifySession(new Date(sampledAt)),
    issuerTrading: {
      currentPeriod: issuerTrading.currentPeriod,
      openNow: issuerTrading.openNow,
      nextChangeAt: issuerTrading.nextChangeAt,
      tradingHoursMode: issuerTrading.tradingHoursMode,
      isTradingHalted: issuerTrading.isTradingHalted,
      maxOrderFiatValue: issuerTrading.maxOrderFiatValue,
      exchange: issuerTrading.exchange,
      fetchedAt: issuerTrading.fetchedAt,
      error: issuerTrading.error,
    },
    index,
    reference,
    normalization: {
      status: normalization.status,
      assetsPerShare: normalization.assetsPerShare,
      underlyingAddress: normalization.underlyingAddress,
      readAt: normalization.readAt,
      error: normalization.error,
    },
    quotes,
    referenceGap,
    referenceGapBasisTokens: basis?.sizeTokens ?? null,
    referenceGapAtMinSize,
    referenceGapMinSizeTokens: minRung?.sizeTokens ?? null,
    pools,
    totalPoolLiquidityUsd: totalLiquidity(pools),
    cliVersion: resolvedCli,
    calcVersion: CALC_VERSION,
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
