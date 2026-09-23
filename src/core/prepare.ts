import { QUOTE_TOKEN } from "../config/assets.js";
import { exact, pct, usd } from "../lib/format.js";
import type { Sample } from "../types.js";
import { scaleFixed } from "./attest.js";

/**
 * The confirmation screen.
 *
 * The panel reading is not reusable as a trade. Preparing takes a second sample and
 * shows how the two differ. Nothing here signs, broadcasts, or remembers a wallet key.
 *
 * The deadline offset is not fixed in the product spec. Two minutes from the fresh
 * sample's own timestamp is the instant this screen would pass to the router. A clock
 * drawn in the browser is not that instant.
 */

export const ROUTER_DEADLINE_SECONDS = 120;

export interface TextField {
  text: string;
  reason: string | null;
}

export interface PreparationView {
  state: "prepared";
  symbol: string;
  sizeTokens: string;
  effectiveUsd: TextField;
  minReceive: TextField;
  minReceiveUnits: TextField;
  proceedsUsd: TextField;
  gap: TextField;
  deadline: TextField;
  panelEffectiveUsd: TextField;
  freshEffectiveUsd: TextField;
  quoteMove: TextField;
  panelTakenAt: string;
  freshTakenAt: string;
  issuerPeriod: string;
  notice: string;
  protection: string;
}

function num(value: number | null, render: (n: number) => string, reason: string): TextField {
  if (value === null || !Number.isFinite(value)) return { text: "—", reason };
  return { text: render(value), reason: null };
}

function quoteAt(sample: Sample) {
  if (sample.requestedSizeTokens === null) return undefined;
  return sample.quotes.find((quote) => quote.sizeTokens === sample.requestedSizeTokens);
}

export function presentPreparation(
  panel: Sample,
  fresh: Sample,
): { ok: true; view: PreparationView } | { ok: false; reason: string } {
  if (panel.symbol !== fresh.symbol || panel.requestedSizeTokens !== fresh.requestedSizeTokens) {
    return { ok: false, reason: "The fresh quote is not for the same asset and size as the panel." };
  }
  if (panel.sampleId === fresh.sampleId) {
    return { ok: false, reason: "The fresh quote is the panel quote. It cannot be prepared." };
  }

  const panelQuote = quoteAt(panel);
  const freshQuote = quoteAt(fresh);
  if (!freshQuote) {
    return { ok: false, reason: "The router did not quote the requested size on the fresh read." };
  }

  const freshTaken = Date.parse(fresh.sampledAt);
  if (!Number.isFinite(freshTaken)) {
    return { ok: false, reason: "The fresh quote has no timestamp, so a deadline cannot be set." };
  }
  const deadline = new Date(freshTaken + ROUTER_DEADLINE_SECONDS * 1000).toISOString();

  const panelPrice = panelQuote?.effectivePriceUsdPerUnderlying ?? null;
  const freshPrice = freshQuote.effectivePriceUsdPerUnderlying;
  const move =
    panelPrice !== null && freshPrice !== null && panelPrice !== 0
      ? freshPrice / panelPrice - 1
      : null;

  const units = scaleFixed(freshQuote.proceedsQuoteToken, QUOTE_TOKEN.decimals);
  const period = fresh.issuerTrading.currentPeriod ?? "unreported";

  return {
    ok: true,
    view: {
      state: "prepared",
      symbol: fresh.symbol,
      sizeTokens: String(fresh.requestedSizeTokens),
      effectiveUsd: num(freshPrice, (value) => usd(value), "effective USD price is missing on the fresh quote"),
      minReceive: {
        text: `${usd(freshQuote.proceedsQuoteToken)} ${QUOTE_TOKEN.symbol}`,
        reason: null,
      },
      minReceiveUnits:
        units === null
          ? { text: "—", reason: "the quoted proceeds could not be scaled to router units" }
          : { text: units.toString(), reason: null },
      proceedsUsd: num(
        freshQuote.proceedsUsd,
        (value) => usd(value),
        "USDG/USD parity was not read, so the proceeds were not restated in USD",
      ),
      gap: num(
        fresh.referenceGapAtRequestedSize,
        (value) => pct(value, 4),
        "the gap on the fresh quote is unavailable",
      ),
      deadline: { text: deadline, reason: null },
      panelEffectiveUsd: num(panelPrice, (value) => usd(value), "the panel quote has no USD price"),
      freshEffectiveUsd: num(freshPrice, (value) => usd(value), "the fresh quote has no USD price"),
      quoteMove: num(move, (value) => pct(value, 4), "the two quotes could not be compared"),
      panelTakenAt: panel.sampledAt,
      freshTakenAt: fresh.sampledAt,
      issuerPeriod: period,
      notice: `Issuer period on the fresh quote is ${period}. A session notice is not protection. The deviation shown above is not protection either.`,
      protection:
        "A deviation threshold and a session notice are interface warnings. The only on-chain protections on a trade are the minimum amount received and the deadline. This page does not sign and does not submit a transaction. State: prepared. Not submitted. Not confirmed.",
    },
  };
}
