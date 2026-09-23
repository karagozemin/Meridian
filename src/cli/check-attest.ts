import { SOURCES_HASH_FIXTURE, bareSizeWei, scaleFixed, sourcesHash } from "../core/attest.js";

/**
 * Confirms the off-chain encoder matches the hash pinned in the Solidity test.
 * Run with the contract tests: npm run test:contract
 */

const hash = await sourcesHash(SOURCES_HASH_FIXTURE);
if (hash !== SOURCES_HASH_FIXTURE.expected) {
  process.stderr.write(`sourcesHash drifted: ${hash}\n`);
  process.exit(1);
}

const parity = scaleFixed(0.999363708138609, 8);
if (parity !== 99_936_371n) {
  process.stderr.write(`parity scale drifted: ${parity}\n`);
  process.exit(1);
}

const raw = 1_001_701_196_801_074_000n;
const bare = bareSizeWei(10, raw);
const expectedBare = (10n * 10n ** 18n * raw) / 10n ** 18n;
if (bare !== expectedBare) {
  process.stderr.write(`bare size drifted: ${bare}\n`);
  process.exit(1);
}

process.stdout.write("attestation encoding matches the contract\n");
