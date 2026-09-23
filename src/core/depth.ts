import { tryRun } from "../lib/onchainos.js";
import { X_LAYER_CHAIN_INDEX, type PoolSnapshot } from "../types.js";

/**
 * Reads the pools backing a token.
 *
 * Headline liquidity is the sum across every pool, which flatters the tradable depth:
 * some of that total sits in pairs that are useless for exiting into a stablecoin. One
 * tokenized equity observed so far has a sizeable share of its liquidity paired against
 * a memecoin rather than a stable, so listing pools individually is the honest view.
 */

interface RawPool {
  pool?: string;
  protocolName?: string;
  liquidityUsd?: string;
  liquidityProviderFeePercent?: string | null;
  poolBasicFeePercent?: string | null;
  poolAddress?: string;
}

export async function fetchPools(address: string): Promise<PoolSnapshot[]> {
  const { data } = await tryRun<RawPool[]>([
    "token",
    "liquidity",
    "--address",
    address,
    "--chain",
    String(X_LAYER_CHAIN_INDEX),
  ]);
  if (!data) return [];

  return data.map((pool) => ({
    pair: pool.pool ?? "unknown",
    protocol: pool.protocolName ?? "unknown",
    liquidityUsd: Number(pool.liquidityUsd ?? 0),
    feePercent: pool.liquidityProviderFeePercent ?? pool.poolBasicFeePercent ?? null,
    poolAddress: pool.poolAddress ?? "",
  }));
}

export function totalLiquidity(pools: PoolSnapshot[]): number | null {
  if (pools.length === 0) return null;
  return pools.reduce((sum, pool) => sum + (Number.isFinite(pool.liquidityUsd) ? pool.liquidityUsd : 0), 0);
}

/**
 * Share of total liquidity sitting in pools quoted against a stablecoin.
 *
 * A low share means the headline figure overstates how much of the position can
 * actually be exited without a second hop.
 */
export function stableQuotedShare(pools: PoolSnapshot[], stableSymbols: string[]): number | null {
  const total = totalLiquidity(pools);
  if (total === null || total === 0) return null;

  const stable = pools
    .filter((pool) =>
      stableSymbols.some((symbol) => pool.pair.toUpperCase().includes(symbol.toUpperCase())),
    )
    .reduce((sum, pool) => sum + pool.liquidityUsd, 0);

  return stable / total;
}
