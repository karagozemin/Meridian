/**
 * Minimal JSON-RPC client for X Layer.
 *
 * Used only for reads the OKX CLI does not expose — specifically the wrapper token's
 * ERC-4626 conversion rate, which has to come from the contract itself because no
 * price API reports it.
 */

const X_LAYER_RPC = process.env["X_LAYER_RPC"] ?? "https://rpc.xlayer.tech";
const TIMEOUT_MS = 15_000;

export class RpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcError";
  }
}

/** Performs `eth_call` against a contract and returns the raw hex result. */
export async function ethCall(to: string, data: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(X_LAYER_RPC, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to, data }, "latest"],
      }),
    });
    if (!response.ok) throw new RpcError(`HTTP ${response.status}`);

    const body = (await response.json()) as { result?: string; error?: { message?: string } };
    if (body.error) throw new RpcError(body.error.message ?? "rpc error");
    if (typeof body.result !== "string") throw new RpcError("missing result");
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

/** Decodes a single uint256 return value. */
export function decodeUint(hex: string): bigint {
  return BigInt(hex);
}

/** Decodes a single address return value, lowercased. */
export function decodeAddress(hex: string): string {
  return `0x${hex.slice(-40)}`.toLowerCase();
}

/** Encodes a uint256 argument as a 32-byte hex word. */
export function encodeUint(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

/** Function selectors used by the wrapper reader. */
export const SELECTOR = {
  decimals: "0x313ce567",
  totalSupply: "0x18160ddd",
  /** ERC-4626 `asset()` — the underlying token the vault wraps. */
  asset: "0x38d52e0f",
  /** ERC-4626 `convertToAssets(uint256)`. */
  convertToAssets: "0x07a2d13a",
} as const;
