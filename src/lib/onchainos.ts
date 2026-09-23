import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 30_000;

export class OnchainosError extends Error {
  constructor(
    message: string,
    readonly args: string[],
    readonly stderr?: string,
  ) {
    super(message);
    this.name = "OnchainosError";
  }
}

/** Envelope every `onchainos` subcommand wraps its payload in. */
interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
  msg?: string;
}

/**
 * Run an `onchainos` subcommand and return its `data` payload.
 *
 * The CLI prints a single JSON envelope on stdout. Anything else — a usage error, a
 * crash, a non-JSON line — is surfaced as an OnchainosError rather than being coerced
 * into a shape the caller might mistake for real data.
 */
export async function run<T>(args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  let stdout: string;
  try {
    const result = await execFileAsync("onchainos", args, {
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch (cause) {
    const err = cause as { stderr?: string; message?: string };
    throw new OnchainosError(
      `onchainos ${args.join(" ")} failed: ${err.message ?? "unknown error"}`,
      args,
      err.stderr,
    );
  }

  let envelope: Envelope<T>;
  try {
    envelope = JSON.parse(stdout) as Envelope<T>;
  } catch {
    throw new OnchainosError(
      `onchainos ${args.join(" ")} returned non-JSON output`,
      args,
      stdout.slice(0, 500),
    );
  }

  if (!envelope.ok || envelope.data === undefined) {
    throw new OnchainosError(
      `onchainos ${args.join(" ")} returned ok=false: ${envelope.error ?? envelope.msg ?? "no detail"}`,
      args,
    );
  }

  return envelope.data;
}

/**
 * Same as `run`, but resolves to `null` instead of throwing.
 *
 * Used by the sampler, where one unavailable feed must not discard the rest of the
 * observation. The caller records the failure as a warning on the sample.
 */
export async function tryRun<T>(
  args: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ data: T | null; error: string | null }> {
  try {
    return { data: await run<T>(args, timeoutMs), error: null };
  } catch (cause) {
    return { data: null, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

export async function version(): Promise<string> {
  const { stdout } = await execFileAsync("onchainos", ["--version"], { timeout: 10_000 });
  return stdout.trim();
}
