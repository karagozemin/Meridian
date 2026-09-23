import { SELECTOR, decodeAddress, decodeUint, encodeUint, ethCall } from "./rpc.js";

/**
 * Reads the conversion rate between a wrapped xStock and its underlying token.
 *
 * This is not a formality. The deep pools on X Layer are quoted against the *wrapped*
 * token, while the issuer's reference price is denominated in the *underlying*. The two
 * are not interchangeable:
 *
 *   wNVDAx -> NVDAx   1.001701   (+0.17%)
 *   wTSLAx -> TSLAx   1.000000   ( 0.00%)
 *   wAAPLx -> AAPLx   1.003269   (+0.33%)
 *
 * The gaps we are trying to measure sit in the 0.01-0.10% range, so comparing a
 * wrapped-denominated quote against an underlying-denominated reference produces an
 * error several times larger than the signal. Every comparison must be normalised first,
 * and any asset whose rate could not be read is marked unverified rather than assumed 1:1.
 *
 * The wrappers are ERC-4626 vaults, so the rate comes from `convertToAssets(1e18)` and
 * the underlying is confirmed by `asset()`.
 */

const ONE_E18 = 10n ** 18n;

export type NormalizationStatus = "verified" | "unverified";

export interface WrapperRate {
  wrapperAddress: string;
  /** Underlying token reported by the wrapper contract itself. */
  underlyingAddress: string | null;
  /** How many underlying tokens one wrapped token represents. */
  assetsPerShare: number | null;
  status: NormalizationStatus;
  /** Present when the rate could not be established. */
  error: string | null;
  readAt: string;
}

/**
 * Reads the wrapper's conversion rate and confirms it wraps the token we expect.
 *
 * A rate that reads successfully but points at a different underlying is treated as a
 * failure — that mismatch means our address mapping is wrong, which is worse than a
 * missing rate.
 */
export async function readWrapperRate(
  wrapperAddress: string,
  expectedUnderlying: string,
): Promise<WrapperRate> {
  const readAt = new Date().toISOString();
  const base = { wrapperAddress, readAt };

  try {
    const [assetHex, convertHex] = await Promise.all([
      ethCall(wrapperAddress, SELECTOR.asset),
      ethCall(wrapperAddress, `${SELECTOR.convertToAssets}${encodeUint(ONE_E18)}`),
    ]);

    const underlyingAddress = decodeAddress(assetHex);
    if (underlyingAddress !== expectedUnderlying.toLowerCase()) {
      return {
        ...base,
        underlyingAddress,
        assetsPerShare: null,
        status: "unverified",
        error: `wrapper wraps ${underlyingAddress}, expected ${expectedUnderlying.toLowerCase()}`,
      };
    }

    const assetsPerShare = Number(decodeUint(convertHex)) / Number(ONE_E18);
    if (!Number.isFinite(assetsPerShare) || assetsPerShare <= 0) {
      return {
        ...base,
        underlyingAddress,
        assetsPerShare: null,
        status: "unverified",
        error: "conversion rate was not a positive number",
      };
    }

    return { ...base, underlyingAddress, assetsPerShare, status: "verified", error: null };
  } catch (cause) {
    return {
      ...base,
      underlyingAddress: null,
      assetsPerShare: null,
      status: "unverified",
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/**
 * Converts a price denominated per wrapped token into a price per underlying token.
 *
 * Returns `null` when the rate is unknown, so callers are forced to render a blank
 * instead of silently falling back to an unnormalised number.
 */
export function toUnderlyingPrice(
  pricePerWrapped: number,
  rate: WrapperRate,
): number | null {
  if (rate.status !== "verified" || rate.assetsPerShare === null) return null;
  return pricePerWrapped / rate.assetsPerShare;
}
