import { QUOTE_TOKEN } from "../config/assets.js";
import { tryRun } from "../lib/onchainos.js";
import { X_LAYER_CHAIN_INDEX, type QuoteTokenRate } from "../types.js";

/**
 * Reads the USD value of the token the router prices trades in.
 *
 * Router output is denominated in USDG, the issuer's reference is denominated in USD, and
 * the two are not the same number. USDG trades a few basis points off parity — small in
 * absolute terms, but the deviations this project measures are themselves on the order of
 * 10-20 basis points, so treating USDG as exactly one dollar would put an error of the
 * same magnitude as the signal directly into every comparison.
 *
 * When this read fails the rate is returned as null rather than defaulting to 1. Callers
 * suppress the USD comparison instead of silently publishing a USDG figure labelled USD.
 */
export async function readQuoteTokenRate(): Promise<QuoteTokenRate> {
  const fetchedAt = new Date().toISOString();

  const { data, error } = await tryRun<Array<{ price?: string }>>([
    "market",
    "price",
    "--address",
    QUOTE_TOKEN.address,
    "--chain",
    String(X_LAYER_CHAIN_INDEX),
  ]);

  const raw = data?.[0]?.price;
  const usdPerQuoteToken = raw === undefined ? null : Number(raw);

  if (usdPerQuoteToken === null || !Number.isFinite(usdPerQuoteToken) || usdPerQuoteToken <= 0) {
    return {
      symbol: QUOTE_TOKEN.symbol,
      address: QUOTE_TOKEN.address,
      usdPerQuoteToken: null,
      deviationFromParity: null,
      fetchedAt,
      error: error ?? "quote token price unavailable",
    };
  }

  return {
    symbol: QUOTE_TOKEN.symbol,
    address: QUOTE_TOKEN.address,
    usdPerQuoteToken,
    deviationFromParity: usdPerQuoteToken - 1,
    fetchedAt,
    error: null,
  };
}

/** Restates a quote-token-denominated price in USD. Null in, null out. */
export function toUsd(priceInQuoteToken: number | null, rate: QuoteTokenRate): number | null {
  if (priceInQuoteToken === null || rate.usdPerQuoteToken === null) return null;
  return priceInQuoteToken * rate.usdPerQuoteToken;
}
