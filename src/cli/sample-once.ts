import { TRACKED_ASSETS, findAsset } from "../config/assets.js";
import { takeSample } from "../core/sample.js";
import { appendSamples } from "../lib/store.js";
import { stableQuotedShare } from "../core/depth.js";
import { exact, pct, usd, share, pad, padStart } from "../lib/format.js";
import type { Sample } from "../types.js";

/**
 * Takes one sample per asset and prints it in the shape the product's pre-trade panel
 * will use. Also appends to the sample log, so running it by hand contributes to the series.
 *
 * Usage:
 *   npm run sample              # every tracked asset
 *   npm run sample -- NVDAx     # one asset
 */

function render(sample: Sample): void {
  process.stdout.write(
    `\n${sample.symbol}  (${sample.underlying})  ${sample.address}\n` +
      `  session        : ${sample.session.regime} — ${sample.session.detail}\n` +
      `  issuer period  : ${sample.issuerTrading.currentPeriod ?? "—"}` +
      `  (openNow=${sample.issuerTrading.openNow ?? "—"}, next ${sample.issuerTrading.nextChangeAt ?? "—"})\n` +
      `  wrap rate      : ${sample.normalization.assetsPerShare ?? "—"} underlying per wrapped` +
      `   [${sample.normalization.status}]\n` +
      `  okx market px  : ${exact(sample.index.okxMarketPrice)}\n` +
      `  okx index      : ${exact(sample.index.okxIndexPrice)}` +
      `${sample.index.identical ? "   [identical to pool price]" : ""}\n` +
      `  issuer quote   : ${sample.reference.quote === null ? "—" : sample.reference.quote.toFixed(3)}` +
      `   (fetched ${sample.reference.fetchedAt}, ${sample.reference.sourceAgeStatus})\n` +
      `  ${sample.quoteTokenRate.symbol} parity    : ${exact(sample.quoteTokenRate.usdPerQuoteToken)} USD` +
      `   (${pct(sample.quoteTokenRate.deviationFromParity, 4)} off parity)\n` +
      `  gap @ min size : ${pct(sample.referenceGapAtMinSize, 4)}` +
      `   (${sample.referenceGapMinSizeTokens ?? "—"} tokens — pricing, excludes size cost)\n` +
      `  gap @ basis    : ${pct(sample.referenceGap, 4)}` +
      `${sample.referenceGapBasisTokens === null ? "" : `   (${sample.referenceGapBasisTokens} tokens — pricing plus size cost)`}\n`,
  );

  if (sample.quotes.length > 0) {
    process.stdout.write(
      `\n  ${pad("size", 8)}${padStart("notional", 14)}${padStart("eff/wrapped", 14)}${padStart("eff/underlying", 16)}${padStart("size impact", 13)}\n`,
    );
    for (const quote of sample.quotes) {
      process.stdout.write(
        `  ${pad(String(quote.sizeTokens), 8)}` +
          padStart(usd(quote.notional, 0), 14) +
          padStart(usd(quote.effectivePricePerWrapped), 14) +
          padStart(usd(quote.effectivePricePerUnderlying), 16) +
          padStart(pct(quote.sizeImpact), 13) +
          "\n",
      );
    }
  }

  if (sample.pools.length > 0) {
    const stableShare = stableQuotedShare(sample.pools, ["USDG", "USDC", "USDT"]);
    process.stdout.write(
      `\n  pools (total ${usd(sample.totalPoolLiquidityUsd, 0)}, ` +
        `${share(stableShare)} stable-quoted):\n`,
    );
    for (const pool of sample.pools) {
      process.stdout.write(
        `    ${pad(pool.pair, 22)}${pad(pool.protocol, 14)}${padStart(usd(pool.liquidityUsd, 0), 14)}` +
          `${pool.feePercent ? `   fee ${pool.feePercent}` : ""}\n`,
      );
    }
  }

  if (sample.warnings.length > 0) {
    process.stdout.write(`\n  warnings: ${sample.warnings.join("; ")}\n`);
  }
}

async function main(): Promise<void> {
  const requested = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const assets =
    requested.length > 0
      ? requested.map((symbol) => {
          const asset = findAsset(symbol);
          if (!asset) throw new Error(`unknown asset: ${symbol}`);
          return asset;
        })
      : TRACKED_ASSETS;

  const samples: Sample[] = [];
  for (const asset of assets) {
    const sample = await takeSample(asset);
    samples.push(sample);
    render(sample);
  }

  await appendSamples(samples);
  process.stdout.write(`\nAppended ${samples.length} sample(s) to the log.\n`);
}

void main();
