import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  analyzeVibe,
  GeminiCallError,
  generateDoodleAvatar,
  getModelHealth,
  isGeminiConfigured,
  REQUEST_BUDGET_MS,
  speakVibeRoast,
  warmUpGemini,
  type VibeMode,
} from "./services/geminiService.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VALID_VIBE_MODES = new Set<VibeMode>(["wholesome", "roast", "cyberpunk"]);

/** Keep-alive cadence for NDJSON streams. Proxies (Cloud Run front-end, AI
 *  Studio preview, corporate Wi-Fi) drop "silent" connections; a tiny line
 *  every few seconds keeps the socket demonstrably alive during cold starts. */
const HEARTBEAT_INTERVAL_MS = 5_000;

/** Some buffering proxies hold the first ~1–2 KB before forwarding anything.
 *  Padding the very first heartbeat pushes it through immediately. */
const FIRST_FLUSH_PADDING = " ".repeat(2048);

const bootedAt = Date.now();

type WorkContext = {
  onStatus: (msg: string) => void;
  signal: AbortSignal;
};

function toClientError(error: unknown, fallbackError: string) {
  if (error instanceof GeminiCallError) {
    return { status: error.httpStatus, kind: error.kind, message: error.message };
  }
  const message = error instanceof Error ? error.message : fallbackError;
  return { status: 500, kind: "unknown", message };
}

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;

  app.disable("x-powered-by");
  app.use(express.json({ limit: "15mb" }));

  /**
   * Runs `work` and replies either as a single JSON body or — when the client
   * sends `Accept: application/x-ndjson` — as a live NDJSON stream:
   *   {"type":"heartbeat","status":"connected"}   ← flushed the instant the request lands
   *   {"type":"heartbeat","status":"alive",...}   ← every 5s
   *   {"type":"status","message":"..."}           ← retry / fallback progress
   *   {"type":"result","data":{...}}  |  {"type":"error","status":503,...}
   */
  async function handleWithOptionalStatusStream<T>(
    req: express.Request,
    res: express.Response,
    work: (ctx: WorkContext) => Promise<T>,
    fallbackError: string
  ) {
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) {
        abort.abort(new Error("Client disconnected before the response finished."));
      }
    });

    const wantsStream = Boolean(req.headers.accept?.includes("application/x-ndjson"));

    if (!wantsStream) {
      try {
        const result = await work({ onStatus: () => undefined, signal: abort.signal });
        res.json(result);
      } catch (error) {
        const info = toClientError(error, fallbackError);
        if (info.kind !== "aborted") console.error(`[${req.path}] ${info.kind}:`, info.message);
        if (!res.headersSent) res.status(info.status).json({ error: info.message, kind: info.kind });
      }
      return;
    }

    res.status(200);
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Connection", "keep-alive");
    res.socket?.setNoDelay(true);
    res.socket?.setKeepAlive(true);
    res.flushHeaders();

    const sendLine = (payload: unknown) => {
      if (!res.writableEnded && !res.destroyed) {
        res.write(`${JSON.stringify(payload)}\n`);
      }
    };

    const startedAt = Date.now();
    sendLine({
      type: "heartbeat",
      status: "connected",
      budgetMs: REQUEST_BUDGET_MS,
      pad: FIRST_FLUSH_PADDING,
    });
    const heartbeat = setInterval(() => {
      sendLine({ type: "heartbeat", status: "alive", elapsedMs: Date.now() - startedAt });
    }, HEARTBEAT_INTERVAL_MS);

    try {
      const result = await work({
        onStatus: (message) => sendLine({ type: "status", message }),
        signal: abort.signal,
      });
      sendLine({ type: "result", data: result });
    } catch (error) {
      const info = toClientError(error, fallbackError);
      if (info.kind !== "aborted") console.error(`[${req.path}] ${info.kind}:`, info.message);
      sendLine({ type: "error", status: info.status, kind: info.kind, error: info.message });
    } finally {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    }
  }

  /** Lightweight wake-up / readiness probe. The client pings this on page load
   *  so the Cloud Run instance is already warm before the first GENERATE. */
  app.get("/api/health", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      uptimeMs: Date.now() - bootedAt,
      geminiConfigured: isGeminiConfigured(),
      models: getModelHealth(),
    });
  });

  app.post("/api/analyze-vibe", async (req, res) => {
    const { imageBase64, vibeMode } = req.body ?? {};

    if (typeof imageBase64 !== "string" || !imageBase64.trim()) {
      res.status(400).json({ error: "Missing or invalid imageBase64 payload." });
      return;
    }
    if (typeof vibeMode !== "string" || !VALID_VIBE_MODES.has(vibeMode as VibeMode)) {
      res.status(400).json({
        error: "Invalid vibeMode. Expected 'wholesome', 'roast', or 'cyberpunk'.",
      });
      return;
    }

    await handleWithOptionalStatusStream(
      req,
      res,
      ({ onStatus, signal }) => analyzeVibe(imageBase64, vibeMode as VibeMode, onStatus, signal),
      "Failed to analyze image vibe."
    );
  });

  app.post("/api/generate-doodle", async (req, res) => {
    const { doodlePrompt, imageBase64, isDuo } = req.body ?? {};

    if (typeof doodlePrompt !== "string" || !doodlePrompt.trim()) {
      res.status(400).json({ error: "Missing or invalid doodlePrompt." });
      return;
    }

    await handleWithOptionalStatusStream(
      req,
      res,
      async ({ onStatus, signal }) => {
        const imageDataUrl = await generateDoodleAvatar(doodlePrompt, {
          referenceImageBase64:
            typeof imageBase64 === "string" && imageBase64.trim() ? imageBase64 : undefined,
          isDuo: Boolean(isDuo),
          onStatus,
          signal,
        });
        return { imageDataUrl };
      },
      "Failed to generate doodle avatar."
    );
  });

  app.post("/api/speak-vibe", async (req, res) => {
    const { characterClass, vibeRoast, vibeMode } = req.body ?? {};

    if (typeof characterClass !== "string" || !characterClass.trim()) {
      res.status(400).json({ error: "Missing or invalid characterClass." });
      return;
    }
    if (typeof vibeRoast !== "string" || !vibeRoast.trim()) {
      res.status(400).json({ error: "Missing or invalid vibeRoast." });
      return;
    }

    const safeMode =
      typeof vibeMode === "string" && VALID_VIBE_MODES.has(vibeMode as VibeMode)
        ? vibeMode
        : "wholesome";

    await handleWithOptionalStatusStream(
      req,
      res,
      async ({ onStatus, signal }) => {
        const audioDataUrl = await speakVibeRoast(characterClass, vibeRoast, safeMode, onStatus, signal);
        return { audioDataUrl };
      },
      "Failed to synthesize spoken roast."
    );
  });

  // Unknown /api routes should 404 as JSON, never fall through to the SPA.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Unknown API route." });
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    app.use(
      express.static(distDir, {
        index: false,
        setHeaders: (res, filePath) => {
          // Hashed Vite assets (incl. bundled sample portraits) are immutable.
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          }
        },
      })
    );
    app.get("*", (_req, res) => {
      const indexFile = path.join(distDir, "index.html");
      if (fs.existsSync(indexFile)) {
        res.setHeader("Cache-Control", "no-cache");
        res.sendFile(indexFile);
      } else {
        res.status(404).send("Build artifacts not found. Run `npm run build` first.");
      }
    });
  }

  const server = app.listen(port, "0.0.0.0", () => {
    console.log(`VibeCheck 3000 server listening on http://0.0.0.0:${port}`);

    // Fire-and-forget: warm TLS to Gemini + verify every model ID once.
    warmUpGemini()
      .then((results) => {
        if (!results.length) {
          console.warn("[Warm-up] GEMINI_API_KEY not set — skipping model probe.");
          return;
        }
        for (const r of results) {
          console.log(`[Warm-up] ${r.ok ? "✓" : "✗"} ${r.model}${r.detail ? ` — ${r.detail}` : ""}`);
        }
      })
      .catch((error) => console.warn("[Warm-up] Model probe failed:", error));
  });

  // Requests can legitimately stream for up to the 60s Gemini budget.
  server.requestTimeout = REQUEST_BUDGET_MS + 30_000;
  server.headersTimeout = 65_000;
  server.keepAliveTimeout = 65_000;
}

startServer();
