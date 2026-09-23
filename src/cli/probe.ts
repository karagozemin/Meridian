import { CONTROL_TOKENS, TRACKED_ASSETS } from "../config/assets.js";
import { probeControls, probeIndex } from "../core/index-probe.js";
import { fetchReferenceQuote } from "../lib/xstocks.js";
import { classifySession } from "../lib/session.js";
import { exact, pct, pad, padStart } from "../lib/format.js";

/**
 * Reproduces the index-feed finding on demand.
 *
 * This is the demo's opening evidence and it is meant to be run live: two OKX feeds
 * return the same number to the last decimal for tokenized equities, while the control
 * tokens show the same feeds genuinely diverging. Anyone can re-run it and get the
 * same result, which is why it holds up under questioning.
 */

async function main(): Promise<void> {
  const session = classifySession();
  process.stdout.write(
    `Session: ${session.regime} — ${session.detail}\n` +
      `Eastern time: ${session.easternTime}\n\n`,
  );

  process.stdout.write(
    `${pad("TOKEN", 10)}${padStart("market price", 24)}${padStart("market index", 24)}${padStart("divergence", 14)}${padStart("identical", 12)}\n`,
  );

  for (const asset of TRACKED_ASSETS) {
    const probe = await probeIndex(asset.address);
    process.stdout.write(
      pad(asset.symbol, 10) +
        padStart(exact(probe.poolPrice), 24) +
        padStart(exact(probe.indexPrice), 24) +
        padStart(pct(probe.divergence, 4), 14) +
        padStart(probe.identical ? "yes" : "no", 12) +
        "\n",
    );
  }

  process.stdout.write("\nControl tokens (the same two feeds, assets that are not equities):\n");
  for (const { symbol, probe } of await probeControls(CONTROL_TOKENS)) {
    process.stdout.write(
      pad(symbol, 10) +
        padStart(exact(probe.poolPrice), 24) +
        padStart(exact(probe.indexPrice), 24) +
        padStart(pct(probe.divergence, 4), 14) +
        padStart(probe.identical ? "yes" : "no", 12) +
        "\n",
    );
  }

  process.stdout.write("\nIssuer reference (xStocks public price-data):\n");
  for (const asset of TRACKED_ASSETS) {
    const reference = await fetchReferenceQuote(asset.symbol);
    process.stdout.write(
      pad(asset.symbol, 10) +
        padStart(reference.quote === null ? "—" : reference.quote.toFixed(3), 24) +
        (reference.error ? `   ${reference.error}` : "") +
        "\n",
    );
  }
}

void main();
