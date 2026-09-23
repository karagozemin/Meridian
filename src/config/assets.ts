import type { TrackedAsset } from "../types.js";

/**
 * Tokenized equities tracked by Meridian, as deployed on X Layer (chainIndex 196).
 *
 * Addresses are issuer-confirmed. The xStocks deployments list records the same
 * contract on every EVM chain, including X Layer.
 *
 * Each equity exists both bare and wrapped. The wrapped variant is the one paired
 * into the deep pools, so it is what we quote against. One bare token represents
 * one underlying share; the wrapper accrues dividends and is not 1:1.
 */
export const TRACKED_ASSETS: TrackedAsset[] = [
  {
    symbol: "NVDAx",
    underlying: "NVDA",
    address: "0xc845b2894dbddd03858fd2d643b4ef725fe0849d",
    wrappedAddress: "0xa8ddb5cd96b5222afe198316e9a57caa642850d5",
    quoteFromAddress: "0xa8ddb5cd96b5222afe198316e9a57caa642850d5",
    decimals: 18,
  },
  {
    symbol: "TSLAx",
    underlying: "TSLA",
    address: "0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0",
    wrappedAddress: "0xc3fdbe3a68ee5de461d30415a8165cf9aefe1171",
    quoteFromAddress: "0xc3fdbe3a68ee5de461d30415a8165cf9aefe1171",
    decimals: 18,
  },
  {
    symbol: "AAPLx",
    underlying: "AAPL",
    address: "0x9d275685dc284c8eb1c79f6aba7a63dc75ec890a",
    wrappedAddress: "0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f",
    quoteFromAddress: "0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f",
    decimals: 18,
  },
];

/** Stablecoin every tracked pool quotes against. Six decimals, not eighteen. */
export const QUOTE_TOKEN = {
  symbol: "USDG",
  address: "0x4ae46a509f6b1d9056937ba4500cb143933d2dc8",
  decimals: 6,
} as const;

/**
 * Control tokens for the index probe.
 *
 * `market index` is documented as an aggregate of multiple sources. These two show
 * it genuinely diverging from the pool price, which is what makes the tokenized-stock
 * result meaningful rather than a single-sample coincidence. Always sample them
 * alongside the equities.
 */
export const CONTROL_TOKENS = [
  { symbol: "USDG", address: "0x4ae46a509f6b1d9056937ba4500cb143933d2dc8" },
  { symbol: "WOKB", address: "0xe538905cf8410324e03a5a23c1c177a474d59b2b" },
] as const;

/**
 * Trade sizes, in whole tokens, used to build the slippage ladder.
 *
 * The headline liquidity figure is misleading on its own — the point of quoting a
 * ladder is to show where the depth actually runs out.
 */
export const QUOTE_SIZE_LADDER = [1, 10, 50, 200, 500, 1000] as const;

/** Symbols treated as stable when measuring how much headline liquidity is actually exitable. */
export const STABLE_SYMBOLS = ["USDG", "USDC", "USDT"] as const;

export function findAsset(symbol: string): TrackedAsset | undefined {
  return TRACKED_ASSETS.find((a) => a.symbol.toLowerCase() === symbol.toLowerCase());
}
