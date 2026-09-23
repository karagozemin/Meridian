import { TRACKED_ASSETS } from "../config/assets.js";
import { ATTESTATION } from "../config/attestation.js";
import { encodeUint, ethCall } from "../lib/rpc.js";
import { SESSION_REGIME } from "./attest.js";

/**
 * Reads one measurement back from X Layer.
 *
 * The numbers are the integers stored in the contract, scaled back to decimals.
 * This does not recompute a price, a gap, or a hash. A record proves Meridian's
 * claim, not the correctness of the price.
 */

const WORD = 64;

const REGIME_NAME: Record<number, string> = {
  [SESSION_REGIME.market]: "market",
  [SESSION_REGIME.extended]: "extended",
  [SESSION_REGIME.overnight]: "overnight",
  [SESSION_REGIME.closed]: "closed",
};

export interface RecordField {
  label: string;
  text: string;
  reason: string | null;
}

export interface RecordView {
  claim: string;
  chainId: number;
  address: string;
  written: boolean;
  reason: string | null;
  fields: RecordField[];
}

const CLAIM = "A record proves Meridian's claim, not the correctness of the price.";

function blank(label: string, reason: string): RecordField {
  return { label, text: "—", reason };
}

function shown(label: string, text: string): RecordField {
  return { label, text, reason: null };
}

function words(hex: string): string[] | null {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (body.length === 0 || body.length % WORD !== 0) return null;
  const out: string[] = [];
  for (let index = 0; index < body.length; index += WORD) {
    out.push(body.slice(index, index + WORD));
  }
  return out;
}

function formatUnits(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction.length === 0 ? whole.toString() : `${whole.toString()}.${fraction}`;
}

function unixIso(seconds: bigint): string | null {
  if (seconds <= 0n || seconds > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const date = new Date(Number(seconds) * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function empty(reason: string): RecordView {
  return {
    claim: CLAIM,
    chainId: ATTESTATION.chainId,
    address: ATTESTATION.address,
    written: false,
    reason,
    fields: [],
  };
}

function presentWords(id: bigint, stored: string[]): RecordView {
  const tokenWord = stored[0];
  const effective = stored[1];
  const reference = stored[2];
  const parity = stored[3];
  const rate = stored[4];
  const size = stored[5];
  const regimeWord = stored[6];
  const fetched = stored[7];
  const measured = stored[8];
  const hash = stored[9];
  if (
    tokenWord === undefined ||
    effective === undefined ||
    reference === undefined ||
    parity === undefined ||
    rate === undefined ||
    size === undefined ||
    regimeWord === undefined ||
    fetched === undefined ||
    measured === undefined ||
    hash === undefined
  ) {
    return empty("The contract returned a measurement that could not be decoded.");
  }

  const token = `0x${tokenWord.slice(-40)}`.toLowerCase();
  const known = TRACKED_ASSETS.find((asset) => asset.address.toLowerCase() === token);
  const regime = Number(BigInt(`0x${regimeWord}`));
  const regimeName = REGIME_NAME[regime];
  const fetchedAt = unixIso(BigInt(`0x${fetched}`));
  const measuredAt = unixIso(BigInt(`0x${measured}`));

  return {
    claim: CLAIM,
    chainId: ATTESTATION.chainId,
    address: ATTESTATION.address,
    written: true,
    reason: null,
    fields: [
      shown("id", id.toString()),
      known ? shown("token", known.symbol) : blank("token", "this address is not one of the tracked assets"),
      shown("token address", token),
      shown("effective price, USD per underlying share", formatUnits(BigInt(`0x${effective}`), 8)),
      shown("issuer reference, USD per share", formatUnits(BigInt(`0x${reference}`), 8)),
      shown("USDG in USD, as stored", formatUnits(BigInt(`0x${parity}`), 8)),
      shown("assets per share, raw convertToAssets(1e18)", BigInt(`0x${rate}`).toString()),
      shown("size, bare tokens", formatUnits(BigInt(`0x${size}`), 18)),
      regimeName === undefined
        ? blank("issuer session regime", "the stored regime is not market, extended, overnight, or closed")
        : shown("issuer session regime", regimeName),
      fetchedAt === null
        ? blank("reference fetched at", "the stored fetch time is not a unix second")
        : shown("reference fetched at", fetchedAt),
      measuredAt === null
        ? blank("measured at", "the stored measurement time is not a unix second")
        : shown("measured at", measuredAt),
      shown("sources hash", `0x${hash}`),
    ],
  };
}

/**
 * Reads `measurement(id)`. When `id` is omitted, reads the latest written id.
 * A contract with no records returns a reason, not a row of zeros.
 */
export async function presentRecord(id: number | null): Promise<RecordView> {
  let nextId: bigint;
  try {
    const nextHex = await ethCall(ATTESTATION.address, ATTESTATION.nextIdSelector);
    nextId = BigInt(nextHex);
  } catch (error) {
    const message = error instanceof Error ? error.message : "the next-id read failed";
    return empty(`The contract could not be read: ${message}`);
  }

  if (nextId === 0n) {
    return empty("No measurement has been written to this contract.");
  }

  const selected = id === null ? nextId - 1n : BigInt(id);
  if (selected < 0n || selected >= nextId) {
    return empty(`Measurement ${selected.toString()} has not been written. The contract holds ${nextId.toString()}.`);
  }

  let hex: string;
  try {
    hex = await ethCall(ATTESTATION.address, ATTESTATION.measurementSelector + encodeUint(selected));
  } catch (error) {
    const message = error instanceof Error ? error.message : "the measurement read failed";
    return empty(`Measurement ${selected.toString()} could not be read: ${message}`);
  }

  const stored = words(hex);
  if (!stored || stored.length < 10) {
    return empty("The contract returned a measurement that could not be decoded.");
  }
  return presentWords(selected, stored);
}
