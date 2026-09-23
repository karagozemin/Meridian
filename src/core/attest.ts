import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { QUOTE_TOKEN } from "../config/assets.js";
import { referencePriceUrl } from "../lib/xstocks.js";
import type { Sample } from "../types.js";

/**
 * Turns one sample into the exact record `MeridianAttestation.record` accepts.
 *
 * A missing piece returns a reason instead of a record. An unverified wrapper rate,
 * a missing parity, a missing reference, or an issuer period we cannot name is not
 * written as a zero. The contract rejects those zeros as well.
 *
 * Session regime comes from the issuer's `currentPeriod`. The local clock is not consulted.
 * The issuer calls the regular session "market".
 */

const exec = promisify(execFile);
const ONE_E18 = 10n ** 18n;

/** Issuer `currentPeriod` → on-chain regime. Anything else is refused. */
export const SESSION_REGIME = {
  market: 0,
  extended: 1,
  overnight: 2,
  closed: 3,
} as const;

export interface MeasurementDraft {
  token: string;
  /** USD, 1e8. */
  effectivePriceUsd: string;
  /** USD, 1e8. */
  referencePriceUsd: string;
  /** USDG per USD, 1e8. */
  quoteTokenUsd: string;
  /** Raw `convertToAssets(1e18)`. */
  assetsPerShare: string;
  /** Bare tokens, 1e18. */
  sizeTokens: string;
  sessionRegime: number;
  referenceFetchedAt: number;
  measuredAt: number;
  sourcesHash: string;
}

export type BuildResult =
  | { ok: true; measurement: MeasurementDraft }
  | { ok: false; reason: string };

/**
 * Fixture shared with `test/MeridianAttestation.t.sol`.
 * Both must hash to the same bytes. The encoder is `cast abi-encode`, which is
 * Solidity `abi.encode`, not `encodePacked`.
 */
export const SOURCES_HASH_FIXTURE = {
  calcVersion: "2026-09-23.3-usd-denominated",
  cliVersion: "onchainos 4.6.2",
  referenceEndpoint: "https://api.xstocks.fi/api/v2/public/assets/NVDAx/price-data",
  routerQuoteId: "",
  wrapperAddress: "0xa8ddb5cd96b5222afe198316e9a57caa642850d5",
  quoteTokenAddress: "0x4ae46a509f6b1d9056937ba4500cb143933d2dc8",
  expected: "0xb534b3f57785581b2420f4537085ba75498b956821b6136f6e247bade544b6ed",
} as const;

export interface SourceIdentity {
  calcVersion: string;
  cliVersion: string;
  referenceEndpoint: string;
  routerQuoteId: string;
  wrapperAddress: string;
  quoteTokenAddress: string;
}

/** keccak256(abi.encode(the six source fields, in the documented order)). */
export async function sourcesHash(source: SourceIdentity): Promise<string> {
  const { stdout: encoded } = await exec("cast", [
    "abi-encode",
    "hashSources(string,string,string,string,address,address)",
    source.calcVersion,
    source.cliVersion,
    source.referenceEndpoint,
    source.routerQuoteId,
    source.wrapperAddress,
    source.quoteTokenAddress,
  ]);
  const { stdout: hash } = await exec("cast", ["keccak", encoded.trim()]);
  return hash.trim();
}

/** Scales a positive decimal to an integer with `decimals` places. Null if it is not positive. */
export function scaleFixed(value: number, decimals: number): bigint | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const text = value.toFixed(decimals);
  if (text.startsWith("-")) return null;
  const [whole, frac = ""] = text.split(".");
  const digits = `${whole ?? "0"}${frac.padEnd(decimals, "0").slice(0, decimals)}`;
  const parsed = BigInt(digits);
  return parsed > 0n ? parsed : null;
}

/**
 * Restates a wrapped-token size as bare tokens at 1e18.
 *
 * The router quote is for the wrapped token. The record's `sizeTokens` field is in
 * bare tokens. `assetsPerShareRaw` is `convertToAssets(1e18)`, so
 * bare = wrappedWei * raw / 1e18.
 */
export function bareSizeWei(wrappedTokens: number, assetsPerShareRaw: bigint): bigint | null {
  const wrappedWei = scaleFixed(wrappedTokens, 18);
  if (wrappedWei === null || assetsPerShareRaw <= 0n) return null;
  const bare = (wrappedWei * assetsPerShareRaw) / ONE_E18;
  return bare > 0n ? bare : null;
}

function unixSeconds(iso: string): number | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.floor(ms / 1000);
}

function regimeOf(period: string | null): number | null {
  if (period === null) return null;
  if (period === "market") return SESSION_REGIME.market;
  if (period === "extended") return SESSION_REGIME.extended;
  if (period === "overnight") return SESSION_REGIME.overnight;
  if (period === "closed") return SESSION_REGIME.closed;
  return null;
}

/**
 * Builds a record or explains why this sample must not be written.
 *
 * The router does not return a quote id. The spec says that field is an empty string
 * when absent, so `routerQuoteId` is empty rather than invented.
 */
export async function buildMeasurement(sample: Sample): Promise<BuildResult> {
  if (sample.normalization.status !== "verified" || sample.normalization.assetsPerShareRaw === null) {
    return {
      ok: false,
      reason: "refusing to write: wrapped-to-underlying rate is not verified",
    };
  }

  const regime = regimeOf(sample.issuerTrading.currentPeriod);
  if (regime === null) {
    return {
      ok: false,
      reason: `refusing to write: issuer period ${sample.issuerTrading.currentPeriod ?? "(missing)"} is not market, extended, overnight, or closed`,
    };
  }

  if (sample.requestedSizeTokens === null) {
    return { ok: false, reason: "refusing to write: no single size was requested" };
  }

  const quote = sample.quotes.find((item) => item.sizeTokens === sample.requestedSizeTokens);
  if (!quote) {
    return {
      ok: false,
      reason: `refusing to write: router did not quote ${sample.requestedSizeTokens} tokens`,
    };
  }

  const effective = scaleFixed(quote.effectivePriceUsdPerUnderlying ?? Number.NaN, 8);
  if (effective === null) {
    return {
      ok: false,
      reason: "refusing to write: effective USD price per underlying share is missing",
    };
  }

  const reference = scaleFixed(sample.reference.quote ?? Number.NaN, 8);
  if (reference === null) {
    return { ok: false, reason: "refusing to write: issuer reference is missing" };
  }

  const parity = scaleFixed(sample.quoteTokenRate.usdPerQuoteToken ?? Number.NaN, 8);
  if (parity === null) {
    return { ok: false, reason: "refusing to write: USDG/USD parity is missing" };
  }

  let assetsPerShare: bigint;
  try {
    assetsPerShare = BigInt(sample.normalization.assetsPerShareRaw);
  } catch {
    return { ok: false, reason: "refusing to write: wrapper rate is not an integer" };
  }
  if (assetsPerShare <= 0n) {
    return { ok: false, reason: "refusing to write: wrapper rate is not positive" };
  }

  const sizeTokens = bareSizeWei(quote.sizeTokens, assetsPerShare);
  if (sizeTokens === null) {
    return { ok: false, reason: "refusing to write: quoted size could not be restated in bare tokens" };
  }

  const referenceFetchedAt = unixSeconds(sample.reference.fetchedAt);
  const measuredAt = unixSeconds(sample.sampledAt);
  if (referenceFetchedAt === null || measuredAt === null) {
    return { ok: false, reason: "refusing to write: a timestamp could not be read" };
  }

  if (sample.cliVersion === null || sample.cliVersion.length === 0) {
    return { ok: false, reason: "refusing to write: onchainos version was not read" };
  }

  const hash = await sourcesHash({
    calcVersion: sample.calcVersion,
    cliVersion: sample.cliVersion,
    referenceEndpoint: referencePriceUrl(sample.symbol),
    routerQuoteId: "",
    wrapperAddress: sample.wrappedAddress,
    quoteTokenAddress: QUOTE_TOKEN.address,
  });

  return {
    ok: true,
    measurement: {
      token: sample.address,
      effectivePriceUsd: effective.toString(),
      referencePriceUsd: reference.toString(),
      quoteTokenUsd: parity.toString(),
      assetsPerShare: assetsPerShare.toString(),
      sizeTokens: sizeTokens.toString(),
      sessionRegime: regime,
      referenceFetchedAt,
      measuredAt,
      sourcesHash: hash,
    },
  };
}
