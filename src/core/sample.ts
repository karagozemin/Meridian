import { randomUUID } from "node:crypto";
import { QUOTE_SIZE_LADDER, STABLE_SYMBOLS } from "../config/assets.js";
import { fetchReferenceQuote, fetchTradingState } from "../lib/xstocks.js";
import { classifySession } from "../lib/session.js";
import { readWrapperRate } from "../lib/wrapper.js";
import { version as cliVersion } from "../lib/onchainos.js";
import { probeIndex } from "./index-probe.js";
import { fetchPools, stableQuotedShare, totalLiquidity } from "./depth.js";
import { quoteLadder, nearestByNotional } from "./quotes.js";
import { readQuoteTokenRate, toUsd } from "./quote-token.js";
import { CALC_VERSION, type Sample, type TrackedAsset } from "../types.js";

/**
 * Notional the reference comparison is anchored to.
 *
 * The gap is computed from the ladder rung closest to this figure and the rung's actual
 * size is recorded alongside it, so a quote for ~$112k is never reported as a $100k trade.
 */
const REFERENCE_BASIS_NOTIONAL = 100_000;

/**
 * The ladder is always quoted in ascending size, with the caller's requested size
 * included, so the first successful rung is the smallest and the requested size is
 * present for a direct comparison.
 */
function quoteSizes(sizes: readonly number[], requestedSizeTokens: number | null): number[] {
  const merged = requestedSizeTokens === null ? [...sizes] : [...sizes, requestedSizeTokens];
  return [...new Set(merged.filter((size) => Number.isFinite(size) && size > 0))].sort(
    (a, b) => a - b,
  );
}

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
  requestedSizeTokens: number | null = null,
): Promise<Sample> {
  const startedAt = Date.now();
  const sampledAt = new Date().toISOString();
  const warnings: string[] = [];
  const sizesToQuote = quoteSizes(sizes, requestedSizeTokens);

  const normalization = await readWrapperRate(asset.wrappedAddress, asset.address);
  if (normalization.status !== "verified") {
    warnings.push(`wrapper rate unverified: ${normalization.error ?? "unknown reason"}`);
  }

  const [index, reference, issuerTrading, pools, quotes, quoteTokenRate, resolvedCli] =
    await Promise.all([
      probeIndex(asset.address),
      fetchReferenceQuote(asset.symbol),
      fetchTradingState(asset.symbol),
      fetchPools(asset.address),
      quoteLadder(asset, normalization, sizesToQuote),
      readQuoteTokenRate(),
      resolveCliVersion(),
    ]);

  if (index.okxMarketPrice === null) warnings.push("okx market price unavailable");
  if (index.okxIndexPrice === null) warnings.push("okx index price unavailable");
  if (reference.error) warnings.push(`issuer reference: ${reference.error}`);
  if (issuerTrading.error) warnings.push(`issuer trading state: ${issuerTrading.error}`);
  if (pools.length === 0) warnings.push("no pools returned");
  if (quoteTokenRate.usdPerQuoteToken === null) {
    warnings.push(`quote token parity unavailable: ${quoteTokenRate.error ?? "unknown reason"}`);
  }
  if (quotes.length < sizesToQuote.length) {
    warnings.push(`router quoted ${quotes.length} of ${sizesToQuote.length} sizes`);
  }

  const quoted = quotes.map((quote) => ({
    ...quote,
    effectivePriceUsdPerWrapped: toUsd(quote.effectivePricePerWrapped, quoteTokenRate),
    effectivePriceUsdPerUnderlying: toUsd(quote.effectivePricePerUnderlying, quoteTokenRate),
  }));

  // Compare like with like. Three conversions have to line up before the difference
  // means anything: wrapped to underlying (the vault rate), quote token to USD (USDG is
  // not exactly a dollar), and size to size. Any missing piece yields null rather than a
  // comparison we cannot defend.
  const gapAgainstReference = (priceInQuoteToken: number | null): number | null => {
    const priceUsd = toUsd(priceInQuoteToken, quoteTokenRate);
    if (priceUsd === null || reference.quote === null || reference.quote === 0) return null;
    return priceUsd / reference.quote - 1;
  };

  const basis = nearestByNotional(quoted, REFERENCE_BASIS_NOTIONAL);
  const referenceGap = gapAgainstReference(basis?.effectivePricePerUnderlying ?? null);

  // The same comparison at the smallest rung isolates pricing from execution cost.
  const minRung = quoted[0];
  const referenceGapAtMinSize = gapAgainstReference(
    minRung?.effectivePricePerUnderlying ?? null,
  );

  const requestedQuote =
    requestedSizeTokens === null
      ? undefined
      : quoted.find((quote) => quote.sizeTokens === requestedSizeTokens);
  const referenceGapAtRequestedSize =
    requestedSizeTokens === null
      ? null
      : gapAgainstReference(requestedQuote?.effectivePricePerUnderlying ?? null);
  if (requestedSizeTokens !== null && requestedQuote === undefined) {
    warnings.push(`router declined the requested size of ${requestedSizeTokens} tokens`);
  }

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
      assetsPerShareRaw: normalization.assetsPerShareRaw,
      underlyingAddress: normalization.underlyingAddress,
      readAt: normalization.readAt,
      error: normalization.error,
    },
    quotes: quoted,
    quoteTokenRate,
    referenceGap,
    referenceGapBasisTokens: basis?.sizeTokens ?? null,
    referenceGapAtMinSize,
    referenceGapMinSizeTokens: minRung?.sizeTokens ?? null,
    requestedSizeTokens,
    referenceGapAtRequestedSize,
    pools,
    totalPoolLiquidityUsd: totalLiquidity(pools),
    stableQuotedShare: stableQuotedShare(pools, [...STABLE_SYMBOLS]),
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
