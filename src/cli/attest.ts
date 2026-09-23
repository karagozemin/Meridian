import { findAsset } from "../config/assets.js";
import { buildMeasurement } from "../core/attest.js";
import { takeSample } from "../core/sample.js";

/**
 * Builds the attestation record for one asset at one size and prints it.
 *
 * This does not broadcast. The contract is already on X Layer mainnet; this command
 * only prints the measurement it would write. A record proves Meridian's claim, not
 * the correctness of the price.
 *
 * Usage: npm run attest -- NVDAx 10
 */

function usage(): never {
  process.stderr.write("usage: npm run attest -- <symbol> <size>\n");
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const symbol = args[0];
  const size = Number(args[1]);
  if (!symbol || !Number.isFinite(size) || size <= 0) usage();

  const asset = findAsset(symbol);
  if (!asset) {
    process.stderr.write(`unknown asset: ${symbol}\n`);
    process.exit(1);
  }

  const sample = await takeSample(asset, undefined, size);
  const built = await buildMeasurement(sample);

  if (!built.ok) {
    process.stderr.write(`${built.reason}\n`);
    process.exit(1);
  }

  const measurement = built.measurement;
  process.stdout.write(
    `${sample.symbol} measurement (not broadcast)\n` +
      `  A record proves Meridian's claim, not the correctness of the price.\n` +
      `  token               ${measurement.token}\n` +
      `  effectivePriceUsd   ${measurement.effectivePriceUsd}   (USD, 1e8)\n` +
      `  referencePriceUsd   ${measurement.referencePriceUsd}   (USD, 1e8)\n` +
      `  quoteTokenUsd       ${measurement.quoteTokenUsd}   (USDG/USD, 1e8)\n` +
      `  assetsPerShare      ${measurement.assetsPerShare}   (raw convertToAssets(1e18))\n` +
      `  sizeTokens          ${measurement.sizeTokens}   (bare tokens, 1e18)\n` +
      `  sessionRegime       ${measurement.sessionRegime}   (issuer ${sample.issuerTrading.currentPeriod})\n` +
      `  referenceFetchedAt  ${measurement.referenceFetchedAt}\n` +
      `  measuredAt          ${measurement.measuredAt}\n` +
      `  sourcesHash         ${measurement.sourcesHash}\n`,
  );
}

void main();
