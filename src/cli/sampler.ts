import { TRACKED_ASSETS } from "../config/assets.js";
import { takeSamples } from "../core/sample.js";
import { appendSamples, DEFAULT_SAMPLE_PATH } from "../lib/store.js";
import { classifySession } from "../lib/session.js";
import { pct } from "../lib/format.js";

/**
 * Continuous sampler.
 *
 * This is the one part of the project that cannot be rebuilt later: the divergence
 * history between the pool price and the issuer reference only exists if something was
 * recording while it happened. Start it early and leave it running.
 *
 * Usage:
 *   npm run sampler                 # default 5 minute interval
 *   npm run sampler -- --interval 60
 */

const DEFAULT_INTERVAL_SECONDS = 300;

function parseInterval(argv: string[]): number {
  const flagIndex = argv.indexOf("--interval");
  if (flagIndex === -1) return DEFAULT_INTERVAL_SECONDS;
  const parsed = Number(argv[flagIndex + 1]);
  return Number.isFinite(parsed) && parsed >= 15 ? parsed : DEFAULT_INTERVAL_SECONDS;
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

async function tick(): Promise<void> {
  const samples = await takeSamples(TRACKED_ASSETS);
  await appendSamples(samples);

  const session = classifySession();
  // Log the min-size gap, which is the pricing figure. The basis-size gap folds in the
  // cost of trading size and would read as mispricing in a one-line summary.
  const summary = samples
    .map((sample) => `${sample.symbol} ${pct(sample.referenceGapAtMinSize, 3)}`)
    .join("  ");
  const warningCount = samples.reduce((sum, sample) => sum + sample.warnings.length, 0);

  process.stdout.write(
    `[${new Date().toISOString()}] ${session.regime.padEnd(9)} ${summary}` +
      (warningCount > 0 ? `  (${warningCount} warnings)` : "") +
      "\n",
  );
}

async function main(): Promise<void> {
  const intervalSeconds = parseInterval(process.argv.slice(2));

  process.stdout.write(
    `Meridian sampler\n` +
      `  assets   : ${TRACKED_ASSETS.map((a) => a.symbol).join(", ")}\n` +
      `  interval : ${intervalSeconds}s\n` +
      `  output   : ${DEFAULT_SAMPLE_PATH}\n\n`,
  );

  let running = true;
  const stop = (): void => {
    running = false;
    process.stdout.write("\nStopping after current tick.\n");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (running) {
    const startedAt = Date.now();
    try {
      await tick();
    } catch (cause) {
      // Never exit on a failed tick. Upstream outages are expected and are exactly the
      // condition this series is meant to capture.
      process.stderr.write(
        `[${new Date().toISOString()}] tick failed: ${cause instanceof Error ? cause.message : String(cause)}\n`,
      );
    }
    if (!running) break;
    const elapsed = Date.now() - startedAt;
    await sleep(Math.max(0, intervalSeconds * 1000 - elapsed));
  }
}

void main();
