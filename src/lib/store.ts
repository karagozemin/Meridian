import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Sample } from "../types.js";

/**
 * Append-only sample log.
 *
 * JSON Lines rather than a database: the series only ever grows, the writer only ever
 * appends, and a half-written run leaves every earlier line readable. The whole point of
 * this store is that it keeps running unattended for weeks, so recoverability beats
 * query convenience.
 */

export const DEFAULT_SAMPLE_PATH = resolve(process.cwd(), "data", "samples.jsonl");

export async function appendSamples(
  samples: readonly Sample[],
  path: string = DEFAULT_SAMPLE_PATH,
): Promise<void> {
  if (samples.length === 0) return;
  await mkdir(dirname(path), { recursive: true });
  const lines = samples.map((sample) => JSON.stringify(sample)).join("\n");
  await appendFile(path, `${lines}\n`, "utf8");
}

/** Reads the log back, skipping any line a crash left truncated. */
export async function readSamples(path: string = DEFAULT_SAMPLE_PATH): Promise<Sample[]> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch {
    return [];
  }

  const samples: Sample[] = [];
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      samples.push(JSON.parse(trimmed) as Sample);
    } catch {
      // Truncated tail from an interrupted write; earlier lines remain valid.
    }
  }
  return samples;
}
