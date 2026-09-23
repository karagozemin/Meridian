import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CONTROL_TOKENS, QUOTE_SIZE_LADDER, findAsset } from "../config/assets.js";
import { probeControls } from "../core/index-probe.js";
import { presentPanel } from "../core/panel.js";
import { presentPreparation } from "../core/prepare.js";
import { presentSeries } from "../core/series.js";
import { takeSample } from "../core/sample.js";
import { readSamples } from "../lib/store.js";
import type { Sample } from "../types.js";

/**
 * Serves the single pre-trade page.
 *
 * The page never talks to OKX or the issuer. It asks this process for one sample, and
 * this process returns text that was already measured. Nothing here is written to the
 * sampler log: ad-hoc sizes would distort the continuous series.
 */

const PORT = Number(process.env.PORT ?? 4173);
const PAGE = resolve(process.cwd(), "web/index.html");
const MAX_SIZE = 10_000;

/** Panel readings kept only so a later prepare can show how the quote moved. Not the sample log. */
const panelReadings = new Map<string, Sample>();

function rememberPanel(sample: Sample): void {
  panelReadings.set(sample.sampleId, sample);
  while (panelReadings.size > 8) {
    const oldest = panelReadings.keys().next().value;
    if (oldest === undefined) break;
    panelReadings.delete(oldest);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function parseRequest(url: URL): { symbol: string; size: number } | { error: string } {
  const symbol = url.searchParams.get("symbol")?.trim() ?? "";
  const size = Number(url.searchParams.get("size"));
  if (!findAsset(symbol)) return { error: `unknown asset: ${symbol || "(none)"}` };
  if (!Number.isFinite(size) || size <= 0 || size > MAX_SIZE) {
    return { error: `size must be a number between 0 and ${MAX_SIZE}` };
  }
  return { symbol, size };
}

async function handlePanel(url: URL, res: ServerResponse): Promise<void> {
  const parsed = parseRequest(url);
  if ("error" in parsed) {
    sendJson(res, 400, parsed);
    return;
  }

  const asset = findAsset(parsed.symbol);
  if (!asset) {
    sendJson(res, 400, { error: `unknown asset: ${parsed.symbol}` });
    return;
  }

  const [sample, controls] = await Promise.all([
    takeSample(asset, QUOTE_SIZE_LADDER, parsed.size),
    probeControls(CONTROL_TOKENS),
  ]);

  rememberPanel(sample);
  sendJson(res, 200, presentPanel(sample, controls));
}

async function handlePrepare(url: URL, res: ServerResponse): Promise<void> {
  const parsed = parseRequest(url);
  if ("error" in parsed) {
    sendJson(res, 400, parsed);
    return;
  }
  const sampleId = url.searchParams.get("sampleId")?.trim() ?? "";
  const panel = panelReadings.get(sampleId);
  if (!panel) {
    sendJson(res, 400, {
      error: "That panel reading is no longer held. Check the size again, then prepare.",
    });
    return;
  }
  if (panel.symbol !== parsed.symbol || panel.requestedSizeTokens !== parsed.size) {
    sendJson(res, 400, { error: "The panel reading does not match this asset and size." });
    return;
  }

  const asset = findAsset(parsed.symbol);
  if (!asset) {
    sendJson(res, 400, { error: `unknown asset: ${parsed.symbol}` });
    return;
  }

  const fresh = await takeSample(asset, QUOTE_SIZE_LADDER, parsed.size);
  const prepared = presentPreparation(panel, fresh);
  if (!prepared.ok) {
    sendJson(res, 400, { error: prepared.reason });
    return;
  }
  sendJson(res, 200, prepared.view);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/api/panel" && req.method === "GET") {
    await handlePanel(url, res);
    return;
  }

  if (url.pathname === "/api/prepare" && req.method === "GET") {
    await handlePrepare(url, res);
    return;
  }

  if (url.pathname === "/api/series" && req.method === "GET") {
    const samples = await readSamples();
    sendJson(res, 200, presentSeries(samples));
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    const html = await readFile(PAGE, "utf8");
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(html);
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("not found");
}

const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "panel request failed";
    if (!res.headersSent) sendJson(res, 500, { error: message });
    else res.end();
  });
});

server.requestTimeout = 120_000;
server.listen(PORT, () => {
  process.stdout.write(`Meridian panel  http://localhost:${PORT}\n`);
});
