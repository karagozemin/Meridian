import { tryRun } from "../lib/onchainos.js";
import { X_LAYER_CHAIN_INDEX, type IndexProbe } from "../types.js";

/**
 * Compares OKX's `market price` against its `market index` for a token.
 *
 * `market index` is documented as a price aggregated from multiple sources. For control
 * tokens it behaves that way and diverges from the pool by a few basis points. For the
 * tokenized equities measured so far it returns the pool price to the last decimal,
 * meaning there is no independent anchor in the stack for those assets — if the pool
 * moves, the index moves with it.
 *
 * Always probe the controls alongside the equities. Without them the result is a single
 * coincidence rather than a finding, and it will not survive a hostile question.
 */

interface PriceRow {
  price?: string;
  tokenContractAddress?: string;
  time?: string;
}

async function readPrice(command: "price" | "index", address: string): Promise<number | null> {
  const { data } = await tryRun<PriceRow[]>([
    "market",
    command,
    "--address",
    address,
    "--chain",
    String(X_LAYER_CHAIN_INDEX),
  ]);
  const raw = data?.[0]?.price;
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Runs both feeds for one token.
 *
 * The two calls are issued in parallel deliberately: the comparison is only meaningful
 * if both reads describe roughly the same instant.
 */
export async function probeIndex(address: string): Promise<IndexProbe> {
  const [okxMarketPrice, okxIndexPrice] = await Promise.all([
    readPrice("price", address),
    readPrice("index", address),
  ]);

  if (okxMarketPrice === null || okxIndexPrice === null || okxMarketPrice === 0) {
    return { okxMarketPrice, okxIndexPrice, divergence: null, identical: false };
  }

  return {
    okxMarketPrice,
    okxIndexPrice,
    divergence: okxIndexPrice / okxMarketPrice - 1,
    // Exact equality is the signal. Near-equality is normal and means nothing.
    identical: okxMarketPrice === okxIndexPrice,
  };
}

export interface ControlResult {
  symbol: string;
  probe: IndexProbe;
}

/** Probes the control tokens so the equity result can be read against a working baseline. */
export async function probeControls(
  controls: ReadonlyArray<{ symbol: string; address: string }>,
): Promise<ControlResult[]> {
  const results: ControlResult[] = [];
  for (const control of controls) {
    results.push({ symbol: control.symbol, probe: await probeIndex(control.address) });
  }
  return results;
}
