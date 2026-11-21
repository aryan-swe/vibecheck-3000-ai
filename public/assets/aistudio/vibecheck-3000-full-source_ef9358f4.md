# VibeCheck 3000 — Full Source Bundle (DevFest Auckland 2026 fixes)

Every file below is copied verbatim from the build that passed `npm install`, `tsc --noEmit` and `vite build`. Replace each file in AI Studio with the *entire* code block under its path.

## Contents

1. `PROJECT_SPEC.md`
2. `package.json`
3. `metadata.json`
4. `server.ts`
5. `services/geminiService.ts`
6. `src/types/vibe.ts`
7. `src/data/samplePresets.ts`
8. `src/hooks/useCameraStream.ts`
9. `src/utils/apiClient.ts`
10. `src/utils/imageUtils.ts`
11. `src/utils/retroBadgeSvg.ts`
12. `src/components/CameraBooth.tsx`
13. `src/components/VibeCardPanel.tsx`
14. `src/App.tsx`

---

## Part 1 — Summary of Architectural & Bug Fixes

### Fix 1 — Cold-start timeouts (`server.ts`, `services/geminiService.ts`, `src/utils/apiClient.ts`, `src/App.tsx`)
- **Bad first model ID.** The analysis chain started with `gemini-4-hydrogen`, which doesn't exist, so every first request wasted a failed call. New verified chains:
  - Analysis: `gemini-3.8-flash` → `gemini-3.5-flash-lite` → `gemini-3.6-flash` → `gemini-3-flash-preview`
  - Doodle: `gemini-nano-banana-2.1` → `gemini-3.1-flash-image` → `gemini-3.1-flash-lite-image`
  - Voice: `gemini-3.8-flash-lite-tts` → `gemini-3.8-flash-tts`
  - (`gemini-3.8-flash-lite` isn't a real model ID, and Gemini 3 Flash only exists as `gemini-3-flash-preview`.)
- **Instant NDJSON heartbeat.** The server sends `{"type":"heartbeat","status":"connected"}` about 30ms after a request arrives, padded to 2 KB so buffering proxies pass it straight through. After that it sends an `alive` line every 5 seconds and sets anti-buffering headers.
- **60s budget.** The server allows 60 seconds per request. The browser waits up to 65 seconds, so the server always gets to report its own error first. A 20-second "silence" watchdog notices a dropped connection and retries once automatically.
- **Smarter retries.** Busy or rate-limited models (429/503/5xx) are retried with increasing waits plus a little randomness (0.6s up to 4s). Each attempt has its own time cap so one hung model can't use up the whole budget. If a model doesn't exist, refuses the request or returns nothing, the next model takes over. The SDK's own retries are turned off so they don't stack with these.
- **Warm-up.** The page pings `/api/health` as soon as it loads, which wakes the server early. On startup the server checks every model ID (free, no tokens used) and skips any that don't exist.
- **Card first, doodle second.** The card text appears in about 2–3 seconds. The doodle draws in the background, and RESET, START OVER and HEAR MY VIBE all keep working while it does. If the user closes the tab, the server cancels its in-flight Gemini calls.

### Fix 2 — Doodle quality (`services/geminiService.ts`, `src/utils/retroBadgeSvg.ts`)
- **Detailed trait sheet.** `analyzeVibe` now returns a `subjects[]` sheet for each person: hairstyle, hair and skin colours, eyewear, accessories, expression, hand gesture, outfit pattern and main/accent colours. The server turns this into a precise drawing brief.
- **Photo as likeness reference.** The user's photo is sent to the image model alongside the brief. If a photo-referenced request is refused, it retries with the text brief only.
- **Locked art direction.** The prompt enforces the 1990s MTV / Keith Haring sticker style:
  - thick black ink outlines and big-headed caricature proportions
  - flat cel-shading in the electric yellow / coral / cyan / mint palette
  - die-cut white sticker border with a hard shadow
  - an explicit "never include" list (text, logos, watermarks, photorealism, extra fingers or people, background scenery)
- **New SVG fallback.** If image generation fails, the app draws a layered comic character from the same traits: matching colours, 7 hairstyles, glasses and sunglasses, 7 expressions, 8 hand gestures, 7 outfit patterns, accessories, and a duo layout. It's labelled **SVG COMIC** and comes with a **REDRAW AI DOODLE** button.

### Fix 3 — 8 sample photos with a Co-Op Duo preset (`src/data/samplePresets.ts`, `src/utils/imageUtils.ts`, `src/App.tsx`)
- There are 6 solo and 2 duo sample photos. All are bundled with the app and served from the same site, so CORS problems can't happen; the loader also has an `<img>` fallback if `fetch` is blocked.
- A random sample loads when the page opens, so GENERATE works in one click.
- **SHUFFLE SAMPLE** goes through all 8 before repeating, and a new **DUO** button loads a two-person photo in one click.

### Fix 4 — Camera that works in iframes (`src/hooks/useCameraStream.ts`, `src/components/CameraBooth.tsx`, `metadata.json`)
- **Settings fallback.** It tries `{facingMode:'user', width:{ideal:1280}}` first, then `{video:true}`.
- **No black box on Safari/iOS.** It sets `muted` and `playsInline` before attaching the stream, then waits for `video.play()` inside `onloadedmetadata`. If the browser blocks autoplay, a "Tap to start preview" button appears.
- **Blocked camera.** It detects a blocked camera through the page's permission rules, the iframe check, `NotAllowedError`/`SecurityError`, or a 12-second timeout. Then it shows the friendly sandbox message with **Use Upload**, **Use Sample** and **Open in New Tab** buttons.
- **Permission request.** `metadata.json` now asks AI Studio for `"camera"`.
- **Webcam light turns off** on snap, tab switch, unmount, page hide and when the tab is hidden.

### Other fixes
- **Install fix.** `package.json` bumps `esbuild` from `^0.25.0` to `^0.28.0`, because Vite 8 requires 0.27 or 0.28. Plain `npm install` was failing with an ERESOLVE dependency conflict.
- **Panel updates.** `VibeCardPanel.tsx` gained the REDRAW button and the SVG COMIC tag. START OVER now only locks while the card is being analyzed, and the voice request timeout is now 30 seconds.


---

## Part 2 — Full Source Files

### 1. `PROJECT_SPEC.md`

_127 lines_

````markdown
# VibeCheck 3000 — Project Specification & Checklist

## 1. Architecture & Modular File Structure

VibeCheck 3000 follows a strict client/server separation so API keys and `@google/genai` calls remain exclusively on the backend:

```text
/
├── PROJECT_SPEC.md              # Design system, architecture, HCI principles, reliability + QA audit
├── metadata.json                # AI Studio applet manifest — requests `camera` for the preview iframe
├── server.ts                    # Express + Vite middleware; /api/* routes with NDJSON heartbeat streaming
├── services/
│   └── geminiService.ts         # analyzeVibe · generateDoodleAvatar · speakVibeRoast · callWithFallback · warmUpGemini
└── src/
    ├── index.css                # Tailwind v4 entry + butter-yellow halftone canvas, 3D push buttons
    ├── App.tsx                  # 2-column workspace coordinator (INPUT BOOTH + VIBE CARD STUDIO)
    ├── data/
    │   └── samplePresets.ts     # 8 bundled sample portraits (6 solo + 2 duo) + shuffle-bag picker
    ├── hooks/
    │   └── useCameraStream.ts   # getUserMedia ladder, iOS-safe playback, sandbox detection, track cleanup
    ├── types/
    │   └── vibe.ts              # Shared TS types incl. DoodleSubject trait sheet
    ├── utils/
    │   ├── apiClient.ts         # NDJSON client: 65s hard cap, 20s idle watchdog, 1 transport retry, warm-up ping
    │   ├── imageUtils.ts        # Validation, resize/JPEG compression, webcam frame capture, same-origin sample loader
    │   ├── cardExporter.ts      # 2x Retina canvas trading-card PNG export
    │   └── retroBadgeSvg.ts     # Trait-driven multi-layer SVG comic character (zero-fail doodle fallback)
    ├── assets/samples/          # Optimised (~65–160 KB) AI-generated sample portraits, bundled by Vite
    └── components/
        ├── PixelIcons.tsx       # Circular retro-pop SVG logo & placeholder art
        ├── RetroWindow.tsx      # Neo-brutalist window container
        ├── TopOsBar.tsx         # Header (VIBECHECK 3000 + AUCKLAND EDITION + RESET)
        ├── CameraBooth.tsx      # INPUT BOOTH — Camera / Upload / Sample, DUO + SHUFFLE SAMPLE, Step 2/3
        └── VibeCardPanel.tsx    # VIBE CARD STUDIO — duo badge, HEAR MY VIBE, PNG export, REDRAW AI DOODLE
```

### Separation Guarantee
- [x] `services/geminiService.ts` is only imported by `server.ts`.
- [x] Frontend talks solely to `/api/health`, `/api/analyze-vibe`, `/api/generate-doodle`, `/api/speak-vibe` via `fetch`.
- [x] `GEMINI_API_KEY` is read only on the server.

---

## 2. Bright Retro-Pop Color Palette & Branding Rules

- [x] **Clean naming**: `VIBECHECK 3000`, `INPUT BOOTH`, `VIBE CARD STUDIO` + custom circular SVG logo.
- [x] **Butter-yellow halftone canvas** `#FFF099`.
- [x] **Panels**: Input Booth `#FFE4C4` / coral `#FF3B5C` header · Card Studio `#D9F9FF` / gold `#FFD60A` header · Top bar cyan `#00C2FF`.
- [x] **Borders & shadows**: `3px solid #111111`, `5px 5px 0 #111111` hard offset shadows.

---

## 3. Reliability Upgrade — Fix #1: First-Request Cold Start (COMPLETED)

**Root causes found**
1. The analysis chain led with `gemini-4-hydrogen`, which is not a published model ID → every first request burned a failed round-trip before reaching a real model.
2. Server budget (45s) and client timeout (45s) were identical, so the browser often aborted at the same moment the server was about to answer or report a clear error.
3. The NDJSON response flushed headers but sent no body bytes until the result, so buffering proxies (Cloud Run front end, AI Studio preview, venue Wi-Fi) could hold or drop a "silent" connection during cold start.
4. A fresh `GoogleGenAI` client per request meant no warm TLS connection pool.

**Fixes**
- [x] **60s request budget** (`REQUEST_BUDGET_MS = 60_000`) for every Gemini pipeline; browser hard cap is **65s** (60s + 5s grace) so the server always reports first.
- [x] **Instant heartbeat**: the moment a request arrives, `server.ts` flushes `{"type":"heartbeat","status":"connected"}` (padded to 2 KB to punch through buffering proxies), then `{"type":"heartbeat","status":"alive"}` every 5s. Headers: `X-Accel-Buffering: no`, `Cache-Control: no-transform`, `TCP_NODELAY`.
- [x] **Idle watchdog** in `apiClient.ts`: 20s of stream silence ⇒ dropped connection ⇒ one automatic transparent retry within the remaining budget.
- [x] **Warm-up**: the page pings `GET /api/health` on load (wakes a scaled-to-zero instance before the first click); on boot the server runs `warmUpGemini()` — a token-free `models.get` probe of every configured model that opens the TLS pool and auto-skips any model that 404s.
- [x] **Card first, doodle second**: `analyzeVibe` uses `thinkingLevel: LOW` + JSON schema and streams the result immediately (≈2–3s warm); the card renders right away while `generateDoodleAvatar` runs in the background. RESET / START OVER / HEAR MY VIBE stay usable while the doodle draws.
- [x] **`callWithFallback` v2**: exponential backoff with equal jitter (600ms → 4s cap, honours `retry in Xs` hints) on `429`/`503`/5xx/network, max 2 retries per model, per-attempt timeouts (analysis 25s, doodle 40s, TTS 20s) so one hung model can't eat the budget, model-chain fallback on 404/400/safety/empty output, SDK-level retries disabled (`retryOptions: { attempts: 1 }`) so they don't stack.
- [x] **Client disconnect ⇒ cancel**: closing the tab/aborting aborts in-flight Gemini calls (no wasted quota).
- [x] Typed `GeminiCallError` kinds mapped to meaningful HTTP statuses (429 / 503 / 504 / 422).

**Verified model chains** (checked against ai.google.dev/models, Nov 2026)

| Pipeline | Chain |
|---|---|
| Vision / JSON analysis | `gemini-3.8-flash` → `gemini-3.5-flash-lite` → `gemini-3.6-flash` → `gemini-3-flash-preview` |
| Doodle image | `gemini-nano-banana-2.1` → `gemini-3.1-flash-image` → `gemini-3.1-flash-lite-image` |
| Oracle TTS | `gemini-3.8-flash-lite-tts` → `gemini-3.8-flash-tts` (+ Web Speech fallback) |

> `gemini-3.8-flash-lite` is **not** a published ID, so the fastest stable Flash-Lite (`gemini-3.5-flash-lite`) takes its slot. "Gemini 3 Flash" is only available as `gemini-3-flash-preview`, so it's last-resort.

---

## 4. Doodle Quality — Fix #2 (COMPLETED)

- [x] **Structured trait extraction**: `analyzeVibe` now returns a `subjects[]` trait sheet per person (max 2, left→right): hairstyle (length/texture/parting/bangs), hair + skin hex, eyewear type + frame detail, accessories, expression enum + detail, gesture enum + which hand/where, outfit layers + pattern enum + main/accent hex, plus a `caricatureHook`. Values are sanitised (hex/enum validation, length caps).
- [x] **`doodlePrompt` composed server-side** from the trait sheet into an unambiguous per-person brief (`PERSON A (left)` / `PERSON B (right)`).
- [x] **Photo used as a likeness reference**: the user's photo is sent to the image model alongside the brief (style instructions forbid copying its realism/background). If a referenced request is declined, it automatically retries text-only within budget.
- [x] **Art direction locked**: 1990s MTV / Keith Haring-inspired retro comic sticker — thick uniform `#111111` ink lines, ~40% oversized caricature heads, flat cel-shading (no gradients/airbrush/3D/photo texture), palette locked to `#FFD60A / #FF3B5C / #00C2FF / #2EE59D / #FFF4D6` + real skin/hair tones, Haring motion ticks, die-cut white sticker border + keyline + hard shadow on solid `#FFF8E7`; explicit NEVER list (text, logos, watermarks, photorealism, extra fingers/people, scenery).
- [x] **Image-less replies handled**: text-only or safety-blocked responses are detected, retried once, then fall through the chain.
- [x] **New SVG fallback (`retroBadgeSvg.ts`)**: a deterministic multi-layer comic character built from the same traits — matching skin/hair colours, 7 hairstyles (curly cloud, long, short, quiff, buzz, bun, ponytail + bangs), glasses/sunglasses with tint, 7 expressions, 8 hand gestures (peace sign, thinking, arms crossed, thumbs-up, finger guns, waving, hands up, holding a mug), 7 outfit patterns (denim, plaid, stripes, graphic print, colour-block, knit, solid) with layered jackets/hoodies, accessories (hoops, chains, lanyards, headphones, beanies, caps), duo layout, pop burst rays, halftone, Haring ticks, mode doodles (hearts / flames / bolts) and an SVG-filter die-cut sticker border. Tagged `SVG COMIC` with a **REDRAW AI DOODLE** button.

---

## 5. Sample Portraits — Fix #3 (COMPLETED)

- [x] `src/data/samplePresets.ts` with **8 presets**: Peace Sign & Denim · Thinking Pose & Round Glasses · Big Laugh & Plaid · Amber Shades & Finger Guns · Crossed Arms & Smirk · Hackathon Windbreaker · **Duo: Peace Sign + Finger Guns** · **Duo: Smirk + Big Laugh**. All are AI-generated people; the duos are split-screen composites.
- [x] **Zero CORS by construction**: every sample is `import`ed through Vite ⇒ fingerprinted and served from the app's own origin; `urlToBase64` refuses cross-origin URLs and has an `<img>` decode fallback. No third-party hosts or proxy endpoint needed. Images re-encoded from ~800 KB to ~65–160 KB.
- [x] **Random sample on page load** (Sample tab is the default, so GENERATE works in one click) and **shuffle-bag** SHUFFLE SAMPLE (all 8 cycle before any repeat; never the same twice in a row).
- [x] **1-click DUO** button + `CO-OP DUO TEST` tag for judges.

---

## 6. Camera Capture — Fix #4 (COMPLETED)

- [x] `useCameraStream` hook: constraint ladder `{ facingMode: 'user', width: { ideal: 1280 } }` → `{ video: true }` on `OverconstrainedError` / `NotReadableError` / `TypeError`.
- [x] `video.muted = true`, `video.playsInline = true` (+ `playsinline` / `webkit-playsinline` attributes) set before `srcObject`; `await video.play()` inside `onloadedmetadata`; autoplay refusal shows a **Tap to start preview** button instead of a black box.
- [x] **Sandbox detection**: Permissions-Policy check (`document.permissionsPolicy/featurePolicy.allowsFeature('camera')`), iframe detection, `NotAllowedError` / `SecurityError`, and a 12s getUserMedia timeout (some sandboxes never resolve). Shows: *"Camera blocked in preview sandbox — works automatically on live site! Use Upload or Sample here"* with **Use Upload**, **Use Sample** and **Open in New Tab** buttons (outside iframes: **Retry** + padlock-icon guidance).
- [x] `metadata.json` now requests `"camera"` in `requestFramePermissions`, so the AI Studio preview iframe can be granted camera access.
- [x] Every `MediaStreamTrack` is stopped on snap, tab switch, unmount, page hide and tab-hidden (webcam light turns off); late streams arriving after a timeout are released too. Insecure-context, no-camera, camera-busy and unplugged-camera cases each get a clear message.
- [x] Mirrored selfie preview; snapshot saved un-mirrored.

---

## 7. Interactive Button & Clickability Audit (Verified)

- [x] Every visible control is wired: `RESET`, `Camera`, `Upload`, `Sample`, `Snap Photo`, `Tap to start preview`, `Retake` / `Change`, `Choose Photo`, `DUO`, `SHUFFLE SAMPLE`, `Use Upload`, `Use Sample`, `Open in New Tab` / `Retry`, `Wholesome`, `Roast`, `Cyberpunk`, `GENERATE MY VIBE CARD`, `TRY AGAIN`, `DISMISS`, `HEAR MY VIBE` / `STOP AUDIO`, `REDRAW AI DOODLE`, `DOWNLOAD CARD (PNG)`, `START OVER`.
- [x] `z-20` overlays above `<video>`, `pointer-events: none` on holo sheen, `touch-action: manipulation`, ≥ 40px touch targets; sample label gets its own row on phones.

---

## 8. Deployment & Verification

- [x] `npm install` fixed: `esbuild` devDependency bumped `^0.25.0` → `^0.28.0` (Vite 8's peer range); plain `npm install` previously failed with `ERESOLVE`. `bun.lock` regenerated.
- [x] `npm run lint` (`tsc --noEmit`) — **0 errors**.
- [x] `npm run build` (`vite build`) — **0 errors**.
- [x] `NODE_ENV=production node server.ts` and `npm run dev` both boot and serve the bundled samples.
- [x] End-to-end tests (Playwright + Chrome, mocked Gemini API via `GOOGLE_GEMINI_BASE_URL`) — **26/26 passing**: sample auto-load, CORS-safe data URLs, 8-preset shuffle bag, DUO button, 503 → backoff → success, heartbeat timing (first byte ≈30ms, keep-alive every 5s), card-before-doodle, text-only image reply → fallback model, forced doodle failure → SVG comic → REDRAW, fake-webcam capture with `playsInline`/`muted`/playing, constraint fallback to `{video:true}`, tracks stopped after snap & tab switch, cross-origin iframe without `allow="camera"` → sandbox message + 1-click Sample, mobile viewport, PNG export of the SVG fallback, client disconnect cancels Gemini calls.
````

### 2. `package.json`

_37 lines_

```json
{
  "name": "react-example",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx server.ts",
    "start": "node server.ts",
    "build": "vite build",
    "preview": "vite preview",
    "clean": "rm -rf dist server.js",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@google/genai": "^3.6.1",
    "@tailwindcss/vite": "^4.3.3",
    "@vitejs/plugin-react": "^6.1.1",
    "dotenv": "^17.2.3",
    "express": "^4.21.2",
    "lucide-react": "^0.546.0",
    "motion": "^12.23.24",
    "react": "^19.0.1",
    "react-dom": "^19.0.1",
    "vite": "^8.3.0"
  },
  "devDependencies": {
    "@types/node": "^22.14.0",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "autoprefixer": "^10.4.21",
    "esbuild": "^0.28.0",
    "tailwindcss": "^4.3.3",
    "tsx": "^4.21.0",
    "typescript": "^7.0.2",
    "@types/express": "^4.17.21"
  }
}
```

### 3. `metadata.json`

_10 lines_

```json
{
  "name": "VibeCheck 3000",
  "description": "Analyze your vibe from a photo and generate a retro 1990s cartoon doodle caricature.",
  "requestFramePermissions": [
    "camera"
  ],
  "majorCapabilities": [
    "MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API"
  ]
}
```

### 4. `server.ts`

_277 lines_

```ts
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
```

### 5. `services/geminiService.ts`

_1083 lines_

```ts
import {
  ApiError,
  GoogleGenAI,
  ThinkingLevel,
  Type,
  type GenerateContentResponse,
  type Part,
} from "@google/genai";

/* ────────────────────────────────────────────────────────────────────────────
 * Timing budgets
 * ──────────────────────────────────────────────────────────────────────────── */

/** Hard ceiling for a whole API request (all retries + fallbacks). */
export const REQUEST_BUDGET_MS = 60_000;

/** Per-attempt caps so one hung model can't eat the whole 60s budget. */
const ANALYZE_ATTEMPT_TIMEOUT_MS = 25_000;
const DOODLE_ATTEMPT_TIMEOUT_MS = 40_000;
const TTS_ATTEMPT_TIMEOUT_MS = 20_000;

/** Exponential backoff for 429 / 503 / 5xx / network blips. */
const BACKOFF_BASE_MS = 600;
const BACKOFF_MAX_MS = 4_000;
const MAX_RETRIES_PER_MODEL = 2;
/** Don't start an attempt with less than this much budget left. */
const MIN_ATTEMPT_WINDOW_MS = 3_500;

/** A 404'd model is skipped for this long before being probed again. */
const UNAVAILABLE_MODEL_TTL_MS = 10 * 60_000;

/* ────────────────────────────────────────────────────────────────────────────
 * Model chains — verified against https://ai.google.dev/models (Nov 2026).
 * Notes:
 *  - "gemini-3.8-flash-lite" is NOT a published model ID; the fastest stable
 *    Flash-Lite text/vision model is "gemini-3.5-flash-lite".
 *  - "gemini-3-flash" only exists as the preview ID "gemini-3-flash-preview".
 *  - Any model that 404s at boot probe or at runtime is auto-skipped.
 * ──────────────────────────────────────────────────────────────────────────── */

export const ANALYZE_MODEL_CHAIN = [
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3-flash-preview",
] as const;

/** Thinking is kept LOW on models documented to accept it (fast ~2–3s card). */
const ANALYZE_THINKING_LEVEL: Record<string, ThinkingLevel | undefined> = {
  "gemini-3.8-flash": ThinkingLevel.LOW,
  "gemini-3.6-flash": ThinkingLevel.LOW,
  "gemini-3-flash-preview": ThinkingLevel.LOW,
};

/** Quality-first (doodle is non-blocking), then faster fallbacks. */
export const DOODLE_MODEL_CHAIN = [
  "gemini-nano-banana-2.1",
  "gemini-3.1-flash-image",
  "gemini-3.1-flash-lite-image",
] as const;

export const TTS_MODEL_CHAIN = [
  "gemini-3.8-flash-lite-tts",
  "gemini-3.8-flash-tts",
] as const;

/* ────────────────────────────────────────────────────────────────────────────
 * Shared types (server-owned API contract; mirrored in src/types/vibe.ts)
 * ──────────────────────────────────────────────────────────────────────────── */

export type VibeMode = "wholesome" | "roast" | "cyberpunk";

export interface VibeStats {
  debugging: number;
  caffeineTolerance: number;
  pureVibes: number;
}

export const EXPRESSIONS = [
  "big-laugh",
  "grin",
  "soft-smile",
  "smirk",
  "focused",
  "surprised",
  "deadpan",
] as const;
export const GESTURES = [
  "peace-sign",
  "thinking",
  "arms-crossed",
  "thumbs-up",
  "finger-guns",
  "waving",
  "hands-up",
  "holding-object",
  "relaxed",
] as const;
export const EYEWEAR = ["none", "glasses", "sunglasses"] as const;
export const OUTFIT_PATTERNS = [
  "solid",
  "denim",
  "plaid",
  "stripes",
  "graphic-print",
  "color-block",
  "knit",
] as const;
export const POSITIONS = ["left", "center", "right"] as const;

export interface DoodleSubject {
  position: (typeof POSITIONS)[number];
  hairstyle: string;
  hairColorHex: string;
  skinToneHex: string;
  eyewear: (typeof EYEWEAR)[number];
  eyewearDetail: string;
  accessories: string;
  expression: (typeof EXPRESSIONS)[number];
  expressionDetail: string;
  gesture: (typeof GESTURES)[number];
  gestureDetail: string;
  outfit: string;
  outfitPattern: (typeof OUTFIT_PATTERNS)[number];
  topColorHex: string;
  accentColorHex: string;
}

export interface VibeAnalysisResult {
  isDuo: boolean;
  synergyScore?: number;
  characterClass: string;
  vibeRoast: string;
  stats: VibeStats;
  superpower: string;
  caricatureHook: string;
  subjects: DoodleSubject[];
  /** Art-direction-ready subject description composed from `subjects`. */
  doodlePrompt: string;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Errors
 * ──────────────────────────────────────────────────────────────────────────── */

export type GeminiErrorKind =
  | "config"
  | "auth"
  | "rate_limit"
  | "overloaded"
  | "server"
  | "network"
  | "attempt_timeout"
  | "deadline"
  | "aborted"
  | "not_found"
  | "bad_request"
  | "no_output"
  | "safety"
  | "unknown";

export class GeminiCallError extends Error {
  readonly kind: GeminiErrorKind;
  readonly status?: number;
  readonly model?: string;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    kind: GeminiErrorKind,
    opts: { status?: number; model?: string; retryAfterMs?: number; cause?: unknown } = {}
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "GeminiCallError";
    this.kind = kind;
    this.status = opts.status;
    this.model = opts.model;
    this.retryAfterMs = opts.retryAfterMs;
  }

  /** HTTP status the Express layer should surface to the browser. */
  get httpStatus(): number {
    switch (this.kind) {
      case "rate_limit":
        return 429;
      case "overloaded":
      case "server":
      case "network":
        return 503;
      case "deadline":
      case "attempt_timeout":
        return 504;
      case "bad_request":
      case "safety":
      case "no_output":
        return 422;
      case "auth":
      case "config":
        return 500;
      default:
        return 500;
    }
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? "Unknown error");
}

function parseRetryAfterMs(text: string): number | undefined {
  const match = /retry(?:\s+in|Delay"?\s*:\s*"?)\s*([\d.]+)\s*s/i.exec(text);
  if (!match) return undefined;
  const secs = Number(match[1]);
  return Number.isFinite(secs) ? Math.round(secs * 1000) : undefined;
}

function classifyError(error: unknown, model?: string): GeminiCallError {
  if (error instanceof GeminiCallError) return error;

  const text = errorText(error);
  const lower = text.toLowerCase();
  const status =
    error instanceof ApiError
      ? error.status
      : typeof (error as { status?: unknown })?.status === "number"
        ? ((error as { status: number }).status)
        : undefined;

  const make = (kind: GeminiErrorKind, extra: { retryAfterMs?: number } = {}) =>
    new GeminiCallError(text, kind, { status, model, cause: error, ...extra });

  if (status === 429 || /resource_exhausted|rate limit|too many requests|quota/.test(lower)) {
    return make("rate_limit", { retryAfterMs: parseRetryAfterMs(text) });
  }
  if (status === 503 || /unavailable|overloaded|high demand/.test(lower)) {
    return make("overloaded");
  }
  if (status === 401 || status === 403 || /api_key_invalid|permission_denied|api key not valid/.test(lower)) {
    return make("auth");
  }
  if (status === 404 || /not_found|is not found|not supported for generatecontent/.test(lower)) {
    return make("not_found");
  }
  if (status === 400 || /invalid_argument|invalid argument/.test(lower)) {
    return make("bad_request");
  }
  if (status === 500 || status === 502 || status === 504 || /internal error|bad gateway|deadline exceeded/.test(lower)) {
    return make("server");
  }
  if (/fetch failed|network|econnreset|econnrefused|etimedout|enotfound|socket hang up|und_err/.test(lower)) {
    return make("network");
  }
  return make("unknown");
}

const RETRY_SAME_MODEL: ReadonlySet<GeminiErrorKind> = new Set([
  "rate_limit",
  "overloaded",
  "server",
  "network",
  "attempt_timeout",
  "no_output",
]);

const FALLBACK_TO_NEXT_MODEL: ReadonlySet<GeminiErrorKind> = new Set([
  ...RETRY_SAME_MODEL,
  "not_found",
  "bad_request",
  "safety",
  "unknown",
]);

/* ────────────────────────────────────────────────────────────────────────────
 * Client + model availability registry
 * ──────────────────────────────────────────────────────────────────────────── */

let cachedClient: GoogleGenAI | null = null;
let cachedKey: string | null = null;

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new GeminiCallError(
      "GEMINI_API_KEY is not configured. Add it in Settings > Secrets (AI Studio) or your .env file.",
      "config"
    );
  }
  // Reuse one client so the TLS/HTTP keep-alive pool stays warm between requests.
  if (cachedClient && cachedKey === apiKey) return cachedClient;
  cachedKey = apiKey;
  cachedClient = new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: REQUEST_BUDGET_MS,
      // We own retry/backoff in callWithFallback — disable SDK-level retries so
      // they don't silently stack on top and blow the 60s budget.
      retryOptions: { attempts: 1 },
      headers: { "User-Agent": "aistudio-build" },
    },
  });
  return cachedClient;
}

const unavailableModels = new Map<string, number>();

function markUnavailable(model: string) {
  unavailableModels.set(model, Date.now());
}

function isUnavailable(model: string): boolean {
  const markedAt = unavailableModels.get(model);
  if (markedAt === undefined) return false;
  if (Date.now() - markedAt > UNAVAILABLE_MODEL_TTL_MS) {
    unavailableModels.delete(model);
    return false;
  }
  return true;
}

function activeChain(models: readonly string[]): string[] {
  const live = models.filter((m) => !isUnavailable(m));
  return live.length ? live : [...models];
}

export interface ModelProbeResult {
  model: string;
  ok: boolean;
  detail?: string;
}

let lastProbe: { at: number; results: ModelProbeResult[] } | null = null;

export function getModelHealth() {
  return {
    probedAt: lastProbe ? new Date(lastProbe.at).toISOString() : null,
    results: lastProbe?.results ?? [],
    skipped: [...unavailableModels.keys()],
    chains: {
      analyze: activeChain(ANALYZE_MODEL_CHAIN),
      doodle: activeChain(DOODLE_MODEL_CHAIN),
      tts: activeChain(TTS_MODEL_CHAIN),
    },
  };
}

/**
 * Cold-start warm-up: opens the TLS connection to the Gemini API and checks
 * every configured model ID with a cheap metadata GET (no tokens). Models that
 * 404 are skipped at request time, so a stale ID can never cost the first
 * user request a wasted round-trip.
 */
export async function warmUpGemini(): Promise<ModelProbeResult[]> {
  if (!isGeminiConfigured()) return [];
  const ai = getGenAIClient();
  const models = [...ANALYZE_MODEL_CHAIN, ...DOODLE_MODEL_CHAIN, ...TTS_MODEL_CHAIN];

  const results = await Promise.all(
    models.map(async (model): Promise<ModelProbeResult> => {
      try {
        await ai.models.get({
          model,
          config: { abortSignal: AbortSignal.timeout(8_000) },
        });
        unavailableModels.delete(model);
        return { model, ok: true };
      } catch (error) {
        const classified = classifyError(error, model);
        if (classified.kind === "not_found") markUnavailable(model);
        return { model, ok: false, detail: `${classified.kind}: ${classified.message.slice(0, 140)}` };
      }
    })
  );

  lastProbe = { at: Date.now(), results };
  return results;
}

/* ────────────────────────────────────────────────────────────────────────────
 * callWithFallback — exponential backoff + model chain + hard deadline
 * ──────────────────────────────────────────────────────────────────────────── */

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function backoffDelay(retryIndex: number, hintMs?: number): number {
  if (hintMs && hintMs > 0) return Math.min(hintMs, BACKOFF_MAX_MS * 2);
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** retryIndex);
  // "Equal jitter": half fixed, half random — avoids thundering-herd retries.
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}

export interface CallWithFallbackOptions<T> {
  context: string;
  models: readonly string[];
  /** Absolute epoch-ms deadline shared across chained calls. */
  deadlineAt?: number;
  attemptTimeoutMs?: number;
  /** Aborts when the browser disconnects. */
  signal?: AbortSignal;
  onStatus?: (message: string) => void;
  execute: (model: string, signal: AbortSignal) => Promise<T>;
}

export async function callWithFallback<T>({
  context,
  models,
  deadlineAt = Date.now() + REQUEST_BUDGET_MS,
  attemptTimeoutMs = ANALYZE_ATTEMPT_TIMEOUT_MS,
  signal,
  onStatus,
  execute,
}: CallWithFallbackOptions<T>): Promise<T> {
  const chain = activeChain(models);
  let lastError: GeminiCallError | null = null;
  let totalRetries = 0;

  const remaining = () => deadlineAt - Date.now();

  for (let i = 0; i < chain.length; i += 1) {
    const model = chain[i];
    const hasNext = i + 1 < chain.length;

    for (let retry = 0; retry <= MAX_RETRIES_PER_MODEL; retry += 1) {
      if (signal?.aborted) {
        throw new GeminiCallError(`${context} cancelled by client.`, "aborted", { model });
      }
      if (remaining() < MIN_ATTEMPT_WINDOW_MS) {
        throw (
          lastError ??
          new GeminiCallError(`${context} ran out of time (${REQUEST_BUDGET_MS / 1000}s budget).`, "deadline", { model })
        );
      }

      const windowMs = Math.min(attemptTimeoutMs, remaining());
      const attemptSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(windowMs)])
        : AbortSignal.timeout(windowMs);

      try {
        // Race guards against SDK paths that don't reject promptly on abort.
        return await new Promise<T>((resolve, reject) => {
          const onAbort = () => reject(attemptSignal.reason ?? new Error("aborted"));
          if (attemptSignal.aborted) {
            onAbort();
            return;
          }
          attemptSignal.addEventListener("abort", onAbort, { once: true });
          execute(model, attemptSignal).then(
            (value) => {
              attemptSignal.removeEventListener("abort", onAbort);
              resolve(value);
            },
            (err) => {
              attemptSignal.removeEventListener("abort", onAbort);
              reject(err);
            }
          );
        });
      } catch (rawError) {
        if (signal?.aborted) {
          throw new GeminiCallError(`${context} cancelled by client.`, "aborted", { model });
        }

        const error =
          attemptSignal.aborted && !(rawError instanceof GeminiCallError)
            ? new GeminiCallError(
                `${model} did not answer within ${Math.round(windowMs / 1000)}s.`,
                remaining() < MIN_ATTEMPT_WINDOW_MS ? "deadline" : "attempt_timeout",
                { model, cause: rawError }
              )
            : classifyError(rawError, model);

        lastError = error;
        console.warn(
          `[GeminiService] ${context} · ${model} · try ${retry + 1} failed (${error.kind}${
            error.status ? ` ${error.status}` : ""
          }): ${error.message.slice(0, 200)}`
        );

        if (error.kind === "auth" || error.kind === "config" || error.kind === "deadline") {
          throw error;
        }
        if (error.kind === "not_found") {
          markUnavailable(model);
        }

        const canRetrySameModel =
          RETRY_SAME_MODEL.has(error.kind) &&
          retry < MAX_RETRIES_PER_MODEL &&
          // A long quota cooldown is better spent on the next model.
          !(error.kind === "rate_limit" && (error.retryAfterMs ?? 0) > BACKOFF_MAX_MS * 2 && hasNext) &&
          // Attempt timeouts mean the model is slow right now — move on if we can.
          !(error.kind === "attempt_timeout" && hasNext) &&
          // A model that answered with no usable output gets one more shot, max.
          !(error.kind === "no_output" && retry >= 1);

        if (canRetrySameModel) {
          const delay = backoffDelay(totalRetries, error.retryAfterMs);
          if (remaining() - delay < MIN_ATTEMPT_WINDOW_MS) break;
          totalRetries += 1;
          onStatus?.(
            error.kind === "rate_limit" || error.kind === "overloaded"
              ? `Routing around DevFest traffic spike... retrying in ${(delay / 1000).toFixed(1)}s`
              : `Signal glitch — retrying in ${(delay / 1000).toFixed(1)}s...`
          );
          try {
            await sleep(delay, signal ?? new AbortController().signal);
          } catch {
            throw new GeminiCallError(`${context} cancelled by client.`, "aborted", { model });
          }
          continue;
        }

        if (hasNext && FALLBACK_TO_NEXT_MODEL.has(error.kind)) {
          onStatus?.("Routing around DevFest traffic spike... switching to backup model");
          break;
        }

        throw error;
      }
    }
  }

  throw lastError ?? new GeminiCallError(`${context} failed across all fallback models.`, "unknown");
}

/* ────────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────────── */

function parseBase64Image(input: string): { mimeType: string; data: string } {
  const trimmed = input.trim();
  const dataUrlMatch = /^data:([^;]+);base64,(.+)$/s.exec(trimmed);
  if (dataUrlMatch) {
    return {
      mimeType: dataUrlMatch[1] || "image/jpeg",
      data: dataUrlMatch[2].replace(/\s+/g, ""),
    };
  }
  return { mimeType: "image/jpeg", data: trimmed.replace(/\s+/g, "") };
}

function clampStat(value: unknown): number {
  const num = typeof value === "number" ? Math.round(value) : Number(value);
  if (!Number.isFinite(num)) return 50;
  return Math.max(1, Math.min(100, num));
}

const HEX_RE = /^#[0-9a-f]{6}$/i;

function safeHex(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const v = value.trim();
  if (HEX_RE.test(v)) return v.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toUpperCase();
  }
  return fallback;
}

function safeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function safeText(value: unknown, fallback: string, max = 220): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return fallback;
  return cleaned.length > max ? `${cleaned.slice(0, max - 1).trimEnd()}…` : cleaned;
}

function sanitizeSubject(raw: unknown, index: number): DoodleSubject {
  const s = (raw ?? {}) as Record<string, unknown>;
  return {
    position: safeEnum(s.position, POSITIONS, index === 0 ? "left" : "right"),
    hairstyle: safeText(s.hairstyle, "short tousled hair"),
    hairColorHex: safeHex(s.hairColorHex, "#2B1B12"),
    skinToneHex: safeHex(s.skinToneHex, "#C68A5E"),
    eyewear: safeEnum(s.eyewear, EYEWEAR, "none"),
    eyewearDetail: safeText(s.eyewearDetail, "none"),
    accessories: safeText(s.accessories, "none"),
    expression: safeEnum(s.expression, EXPRESSIONS, "grin"),
    expressionDetail: safeText(s.expressionDetail, "friendly confident grin"),
    gesture: safeEnum(s.gesture, GESTURES, "relaxed"),
    gestureDetail: safeText(s.gestureDetail, "relaxed stance"),
    outfit: safeText(s.outfit, "casual top"),
    outfitPattern: safeEnum(s.outfitPattern, OUTFIT_PATTERNS, "solid"),
    topColorHex: safeHex(s.topColorHex, "#00C2FF"),
    accentColorHex: safeHex(s.accentColorHex, "#FF3B5C"),
  };
}

/** Turns structured traits into a dense, unambiguous art-direction brief. */
export function composeDoodlePrompt(
  subjects: DoodleSubject[],
  caricatureHook: string,
  isDuo: boolean
): string {
  const describe = (s: DoodleSubject, label: string) =>
    [
      `${label}:`,
      `• Hair: ${s.hairstyle} (hair colour ${s.hairColorHex}).`,
      `• Skin tone: ${s.skinToneHex}.`,
      `• Eyewear: ${s.eyewear === "none" ? "none" : `${s.eyewear} — ${s.eyewearDetail}`}.`,
      `• Accessories: ${s.accessories}.`,
      `• Expression: ${s.expression.replace("-", " ")} — ${s.expressionDetail}.`,
      `• Pose / hands: ${s.gesture.replace("-", " ")} — ${s.gestureDetail}.`,
      `• Outfit: ${s.outfit} (${s.outfitPattern.replace("-", " ")}; main colour ${s.topColorHex}, accent ${s.accentColorHex}).`,
    ].join("\n");

  const ordered = [...subjects].sort(
    (a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position)
  );

  const body = isDuo && ordered.length >= 2
    ? `${describe(ordered[0], "PERSON A (left)")}\n${describe(ordered[1], "PERSON B (right)")}`
    : describe(ordered[0], "THE PERSON");

  return `${body}\nCARICATURE HOOK — exaggerate this most: ${caricatureHook}`;
}

const VIBE_MODE_INSTRUCTIONS: Record<VibeMode, string> = {
  wholesome:
    "Keep the commentary genuinely warm, uplifting, affectionate, and playfully nerdy—celebrating their energy, expression, and style.",
  roast:
    "Keep the commentary sharp, sarcastic, hilarious, and playfully savage like a comedy roast among developer friends (never mean-spirited, never about body, age, race, gender or anything they can't change).",
  cyberpunk:
    "Write the commentary in dramatic neon-noir hacker slang, referencing cybernetics, late-night terminals, megacorps, and electric rain.",
};

/* ────────────────────────────────────────────────────────────────────────────
 * 1) analyzeVibe — fast multimodal read → card data + structured doodle traits
 * ──────────────────────────────────────────────────────────────────────────── */

const SUBJECT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    position: { type: Type.STRING, enum: [...POSITIONS], description: "Where this person stands in the frame." },
    hairstyle: {
      type: Type.STRING,
      description:
        "Exact hairstyle: length, texture, volume, parting, fringe/bangs, ties. e.g. 'voluminous shoulder-length black spiral curls with a centre part'.",
    },
    hairColorHex: { type: Type.STRING, description: "Dominant hair colour as #RRGGBB." },
    skinToneHex: { type: Type.STRING, description: "Visible skin tone as #RRGGBB, for faithful illustration." },
    eyewear: { type: Type.STRING, enum: [...EYEWEAR] },
    eyewearDetail: {
      type: Type.STRING,
      description: "Frame shape + colour + lens tint, e.g. 'oversized round amber-tinted sunglasses', or 'none'.",
    },
    accessories: {
      type: Type.STRING,
      description: "Visible earrings, necklaces, watches, hats, lanyards, headphones — or 'none'. No brand names.",
    },
    expression: { type: Type.STRING, enum: [...EXPRESSIONS] },
    expressionDetail: {
      type: Type.STRING,
      description: "Precise facial read: mouth shape, eyes, brows. e.g. 'open-mouth belly laugh, eyes squeezed shut, brows lifted'.",
    },
    gesture: { type: Type.STRING, enum: [...GESTURES] },
    gestureDetail: {
      type: Type.STRING,
      description: "Which hand, where, and how. e.g. 'right hand raised beside face making a V peace sign, palm out'.",
    },
    outfit: {
      type: Type.STRING,
      description:
        "Garments + layers + fit + notable prints described generically (no readable text or brand names). e.g. 'light-wash denim jacket with rust corduroy collar over a charcoal graphic tee'.",
    },
    outfitPattern: { type: Type.STRING, enum: [...OUTFIT_PATTERNS] },
    topColorHex: { type: Type.STRING, description: "Main outer-garment colour as #RRGGBB." },
    accentColorHex: { type: Type.STRING, description: "Secondary garment/pattern colour as #RRGGBB." },
  },
  required: [
    "position",
    "hairstyle",
    "hairColorHex",
    "skinToneHex",
    "eyewear",
    "eyewearDetail",
    "accessories",
    "expression",
    "expressionDetail",
    "gesture",
    "gestureDetail",
    "outfit",
    "outfitPattern",
    "topColorHex",
    "accentColorHex",
  ],
};

const ANALYSIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    isDuo: { type: Type.BOOLEAN, description: "True if 2 or more people are prominently visible." },
    synergyScore: { type: Type.INTEGER, description: "1–100 tag-team chemistry (duo only)." },
    characterClass: { type: Type.STRING, description: "Creative tech RPG class (solo) or tag-team class (duo)." },
    vibeRoast: { type: Type.STRING, description: "Exactly 2 punchy sentences in the requested tone." },
    stats: {
      type: Type.OBJECT,
      properties: {
        debugging: { type: Type.INTEGER },
        caffeineTolerance: { type: Type.INTEGER },
        pureVibes: { type: Type.INTEGER },
      },
      required: ["debugging", "caffeineTolerance", "pureVibes"],
    },
    superpower: { type: Type.STRING, description: "Funny tech-themed signature (or co-op combo) ability." },
    caricatureHook: {
      type: Type.STRING,
      description: "The single most exaggeration-worthy visual trait for a caricaturist, e.g. 'gigantic curly hair cloud and a beaming laugh'.",
    },
    subjects: {
      type: Type.ARRAY,
      description: "One entry per prominent person (max 2), ordered left to right.",
      items: SUBJECT_SCHEMA,
    },
  },
  required: [
    "isDuo",
    "characterClass",
    "vibeRoast",
    "stats",
    "superpower",
    "caricatureHook",
    "subjects",
  ],
};

export async function analyzeVibe(
  imageBase64: string,
  vibeMode: VibeMode,
  onStatus?: (message: string) => void,
  signal?: AbortSignal
): Promise<VibeAnalysisResult> {
  if (!imageBase64 || typeof imageBase64 !== "string") {
    throw new GeminiCallError("Please provide a valid image before running vibe analysis.", "bad_request");
  }

  const { mimeType, data } = parseBase64Image(imageBase64);
  if (!data) {
    throw new GeminiCallError("The uploaded image data was empty.", "bad_request");
  }

  const modeTone = VIBE_MODE_INSTRUCTIONS[vibeMode] ?? VIBE_MODE_INSTRUCTIONS.wholesome;
  const ai = getGenAIClient();

  const prompt = `You are VibeCheck 3000, a witty character-sheet generator AND a meticulous caricature art director.

STEP 1 — COUNT: How many people are prominently visible? 2+ → isDuo = true (CO-OP DUO MODE). 1 → isDuo = false.

STEP 2 — READ THE VIBE (do not invent props; only mention objects that are actually visible):
pose & hands, facial expression, hairstyle, eyewear, accessories, outfit colours/patterns, overall energy.

Selected vibe mode: "${vibeMode}". Tone: ${modeTone}

STEP 3 — RETURN JSON:
- characterClass: solo → a creative tech RPG title rooted in their pose/expression/style (e.g. "Level 42 Peace-Sign Frontend Tactician"). Duo → a tag-team class combining both (e.g. "Level 88 Chaos Architect & Silent Debugger").
- vibeRoast: exactly 2 punchy sentences in the "${vibeMode}" tone that name SPECIFIC visible details (and the duo dynamic if isDuo).
- stats: debugging, caffeineTolerance, pureVibes — integers 1–100 calibrated to visible energy.
- superpower: funny tech-themed signature ability (co-op combo if duo).
- synergyScore: 1–100 (duo only).
- caricatureHook: the one trait a caricaturist should exaggerate most.
- subjects: for EACH prominent person (max 2, left→right) fill every field with HYPER-SPECIFIC visual facts a cartoonist could draw from without seeing the photo:
  • hairstyle with length/texture/volume/parting/bangs • hair colour hex • skin tone hex
  • eyewear type + exact frame shape/colour/tint • accessories (earrings, chains, watch, lanyard…)
  • expression enum + precise mouth/eyes/brows • gesture enum + which hand, where, angle
  • outfit layers + fit + pattern (describe graphics generically, never transcribe text/logos) • main + accent garment colour hex
Be literal and concrete. No guesses about identity, age, ethnicity, or anything not visible.`;

  const response = await callWithFallback<GenerateContentResponse>({
    context: "Vibe analysis",
    models: ANALYZE_MODEL_CHAIN,
    attemptTimeoutMs: ANALYZE_ATTEMPT_TIMEOUT_MS,
    signal,
    onStatus,
    execute: async (model, abortSignal) => {
      const thinkingLevel = ANALYZE_THINKING_LEVEL[model];
      const res = await ai.models.generateContent({
        model,
        contents: {
          parts: [{ inlineData: { mimeType, data } }, { text: prompt }],
        },
        config: {
          abortSignal,
          ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
          responseMimeType: "application/json",
          responseSchema: ANALYSIS_SCHEMA,
        },
      });
      if (!res.text?.trim()) {
        throw new GeminiCallError(`${model} returned an empty analysis.`, "no_output", { model });
      }
      return res;
    },
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(response.text ?? "") as Record<string, unknown>;
  } catch (error) {
    throw new GeminiCallError("The vibe oracle replied with malformed JSON. Please try again.", "no_output", {
      cause: error,
    });
  }

  if (typeof parsed.characterClass !== "string" || typeof parsed.vibeRoast !== "string") {
    throw new GeminiCallError("Model response was missing required vibe analysis fields.", "no_output");
  }

  const rawSubjects = Array.isArray(parsed.subjects) ? parsed.subjects.slice(0, 2) : [];
  const subjects = (rawSubjects.length ? rawSubjects : [{}]).map(sanitizeSubject);
  const isDuo = Boolean(parsed.isDuo) || subjects.length >= 2;
  const finalSubjects = isDuo ? subjects : subjects.slice(0, 1);
  if (isDuo && finalSubjects.length === 2 && finalSubjects[0].position === finalSubjects[1].position) {
    finalSubjects[0].position = "left";
    finalSubjects[1].position = "right";
  }

  const stats = (parsed.stats ?? {}) as Record<string, unknown>;
  const caricatureHook = safeText(parsed.caricatureHook, "their signature expression and hairstyle", 160);

  return {
    isDuo,
    ...(isDuo ? { synergyScore: clampStat(parsed.synergyScore ?? 88) } : {}),
    characterClass: safeText(parsed.characterClass, "Level 1 DevFest Challenger", 90),
    vibeRoast: safeText(parsed.vibeRoast, "Pure signal, zero noise.", 360),
    stats: {
      debugging: clampStat(stats.debugging),
      caffeineTolerance: clampStat(stats.caffeineTolerance),
      pureVibes: clampStat(stats.pureVibes),
    },
    superpower: safeText(parsed.superpower, "Ships on Friday and lives to tell the tale", 140),
    caricatureHook,
    subjects: finalSubjects,
    doodlePrompt: composeDoodlePrompt(finalSubjects, caricatureHook, isDuo),
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2) generateDoodleAvatar — high-craft 90s sticker caricature
 * ──────────────────────────────────────────────────────────────────────────── */

function buildDoodleArtDirection(subjectBrief: string, hasReference: boolean, isDuo: boolean): string {
  return `Create ONE finished sticker illustration: a high-craft 1990s MTV-era pop-art caricature sticker of the ${
    isDuo ? "two people" : "person"
  } described below.${
    hasReference
      ? " The attached photo is a LIKENESS REFERENCE ONLY (face shape, hairstyle, eyewear, outfit, pose). Do NOT copy its background, lighting, camera blur or photographic realism — redraw everything from scratch in the illustration style."
      : ""
  }

STYLE — non-negotiable
• Hand-inked retro comic sticker art in the spirit of 90s MTV idents, Keith Haring-inspired pop energy and Saturday-morning cartoon stickers.
• Thick, confident, uniform black ink outlines (#111111) on every shape; clean closed contours; no sketchy construction lines, no hatching.
• Expressive caricature proportions: head ~40% larger than life, exaggerate the signature traits (hair volume, eyewear, grin, hand gesture) while keeping the person instantly recognisable.
• Flat cel-shading only: one solid base colour + one hard-edged shadow tone per area. NO gradients, NO airbrush, NO soft blur, NO 3D render, NO photo texture.
• Pop palette locked to electric yellow #FFD60A, coral red #FF3B5C, cyan #00C2FF, mint #2EE59D, cream #FFF4D6 and ink #111111 — plus each person's real skin and hair tones, kept faithful.
• A few bold Haring-style radiating motion ticks and tiny doodled sparkles around the figure${isDuo ? "s" : ""} for energy.

SUBJECT${isDuo ? "S" : ""}
${subjectBrief}

COMPOSITION
• Square 1:1, ${isDuo ? "both figures side by side at equal size, shoulders slightly overlapping, interacting like a tag-team," : "figure"} centred and framed from mid-torso up so every hand gesture is fully visible, filling ~80% of the canvas.
• Die-cut sticker finish: the whole figure group wrapped in ONE thick, smooth, continuous pure-white sticker border (~24px) with a thin black outer keyline and a small hard offset drop shadow.
• Background outside the sticker: flat, solid, empty off-white #FFF8E7.

NEVER INCLUDE: text, letters, numbers, logos, speech bubbles, captions, watermarks or signatures; photorealism; muddy or desaturated colours; extra fingers or limbs; extra people; background scenery or props from the photo.`;
}

function extractImageDataUrl(response: GenerateContentResponse, model: string): string {
  const candidate = response.candidates?.[0];
  const parts: Part[] = candidate?.content?.parts ?? [];
  for (const part of parts) {
    if (part.inlineData?.data && (part.inlineData.mimeType ?? "image/png").startsWith("image/")) {
      const mimeType = part.inlineData.mimeType || "image/png";
      return `data:${mimeType};base64,${part.inlineData.data}`;
    }
  }

  const blockReason = response.promptFeedback?.blockReason;
  const finishReason = candidate?.finishReason;
  if (blockReason || /safety|prohibited|blocklist|image_safety/i.test(String(finishReason ?? ""))) {
    throw new GeminiCallError(
      `${model} declined to draw this one (${blockReason ?? finishReason}).`,
      "safety",
      { model }
    );
  }
  const textOnly = parts
    .map((p) => p.text)
    .filter(Boolean)
    .join(" ")
    .trim()
    .slice(0, 160);
  throw new GeminiCallError(
    textOnly ? `${model} replied with text instead of an image (${textOnly}).` : `${model} returned no image data.`,
    "no_output",
    { model }
  );
}

export async function generateDoodleAvatar(
  doodlePrompt: string,
  options: {
    referenceImageBase64?: string;
    isDuo?: boolean;
    onStatus?: (message: string) => void;
    signal?: AbortSignal;
  } = {}
): Promise<string> {
  if (!doodlePrompt || !doodlePrompt.trim()) {
    throw new GeminiCallError("A doodlePrompt is required to generate the doodle avatar.", "bad_request");
  }

  const { referenceImageBase64, isDuo = false, onStatus, signal } = options;
  const ai = getGenAIClient();
  const deadlineAt = Date.now() + REQUEST_BUDGET_MS;
  const brief = doodlePrompt.trim().slice(0, 4_000);
  const reference = referenceImageBase64 ? parseBase64Image(referenceImageBase64) : null;

  const run = (withReference: boolean) =>
    callWithFallback<string>({
      context: withReference ? "Doodle (photo-referenced)" : "Doodle (text-only)",
      models: DOODLE_MODEL_CHAIN,
      deadlineAt,
      attemptTimeoutMs: DOODLE_ATTEMPT_TIMEOUT_MS,
      signal,
      onStatus,
      execute: async (model, abortSignal) => {
        const parts: Part[] = [];
        if (withReference && reference?.data) {
          parts.push({ inlineData: { mimeType: reference.mimeType, data: reference.data } });
        }
        parts.push({ text: buildDoodleArtDirection(brief, Boolean(withReference && reference), isDuo) });

        const response = await ai.models.generateContent({
          model,
          contents: { parts },
          config: {
            abortSignal,
            imageConfig: { aspectRatio: "1:1" },
          },
        });
        return extractImageDataUrl(response, model);
      },
    });

  if (!reference) return run(false);

  try {
    return await run(true);
  } catch (error) {
    const classified = classifyError(error);
    const timeLeft = deadlineAt - Date.now();
    // A likeness-referenced request can be declined where a pure text brief is
    // fine — fall back to text-only while budget remains.
    if (
      !signal?.aborted &&
      classified.kind !== "auth" &&
      classified.kind !== "config" &&
      classified.kind !== "aborted" &&
      timeLeft > 15_000
    ) {
      onStatus?.("Re-inking from your trait sheet...");
      return run(false);
    }
    throw classified;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3) speakVibeRoast — arcade-announcer TTS
 * ──────────────────────────────────────────────────────────────────────────── */

function wrapPcm16AsWav(pcmBuffer: Buffer, sampleRate = 24000, channels = 1): Buffer {
  const byteRate = sampleRate * channels * 2;
  const blockAlign = channels * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmBuffer.length, 40);
  return Buffer.concat([header, pcmBuffer]);
}

const ORACLE_VOICE_STYLES: Record<string, string> = {
  wholesome: "Enthusiastic, warm, upbeat 1990s arcade announcer with cheerful comedic timing",
  roast: "Expressive, snappy comedy roast host with crisp pacing and playful energy",
  cyberpunk: "Dramatic, electric neon-noir arcade oracle announcer with punchy cadence",
};

export async function speakVibeRoast(
  characterClass: string,
  vibeRoast: string,
  vibeMode: string,
  onStatus?: (message: string) => void,
  signal?: AbortSignal
): Promise<string> {
  if (!characterClass?.trim() || !vibeRoast?.trim()) {
    throw new GeminiCallError("Both characterClass and vibeRoast are required for spoken audio.", "bad_request");
  }

  const ai = getGenAIClient();
  const style = ORACLE_VOICE_STYLES[vibeMode] ?? ORACLE_VOICE_STYLES.wholesome;
  const script = `${characterClass.trim().slice(0, 120)}! ${vibeRoast.trim().slice(0, 400)}`;

  return callWithFallback<string>({
    context: "Oracle voice synthesis",
    models: TTS_MODEL_CHAIN,
    attemptTimeoutMs: TTS_ATTEMPT_TIMEOUT_MS,
    signal,
    onStatus,
    execute: async (model, abortSignal) => {
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [{ text: script, speechMetadata: { style } }],
          },
        ],
        config: {
          abortSignal,
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } },
          },
        },
      });

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (part.inlineData?.data) {
          const mimeType = (part.inlineData.mimeType || "audio/wav").toLowerCase();
          if (mimeType.includes("l16") || mimeType.includes("pcm")) {
            const rateMatch = /rate=(\d+)/.exec(mimeType);
            const wavBuffer = wrapPcm16AsWav(
              Buffer.from(part.inlineData.data, "base64"),
              rateMatch ? Number(rateMatch[1]) : 24000
            );
            return `data:audio/wav;base64,${wavBuffer.toString("base64")}`;
          }
          return `data:${mimeType};base64,${part.inlineData.data}`;
        }
      }
      throw new GeminiCallError(`${model} returned no audio data.`, "no_output", { model });
    },
  });
}
```

### 6. `src/types/vibe.ts`

_107 lines_

```ts
export type VibeMode = "wholesome" | "roast" | "cyberpunk";

export type CaptureTab = "camera" | "upload" | "sample";

export type GenerationStage = "idle" | "analyzing" | "drawing" | "complete";

export interface VibeStats {
  debugging: number;
  caffeineTolerance: number;
  pureVibes: number;
}

export type SubjectExpression =
  | "big-laugh"
  | "grin"
  | "soft-smile"
  | "smirk"
  | "focused"
  | "surprised"
  | "deadpan";

export type SubjectGesture =
  | "peace-sign"
  | "thinking"
  | "arms-crossed"
  | "thumbs-up"
  | "finger-guns"
  | "waving"
  | "hands-up"
  | "holding-object"
  | "relaxed";

export type OutfitPattern =
  | "solid"
  | "denim"
  | "plaid"
  | "stripes"
  | "graphic-print"
  | "color-block"
  | "knit";

/** Hyper-specific visual traits extracted by analyzeVibe (one per person). */
export interface DoodleSubject {
  position: "left" | "center" | "right";
  hairstyle: string;
  hairColorHex: string;
  skinToneHex: string;
  eyewear: "none" | "glasses" | "sunglasses";
  eyewearDetail: string;
  accessories: string;
  expression: SubjectExpression;
  expressionDetail: string;
  gesture: SubjectGesture;
  gestureDetail: string;
  outfit: string;
  outfitPattern: OutfitPattern;
  topColorHex: string;
  accentColorHex: string;
}

export interface VibeAnalysisResult {
  isDuo: boolean;
  synergyScore?: number;
  characterClass: string;
  vibeRoast: string;
  stats: VibeStats;
  superpower: string;
  caricatureHook?: string;
  subjects?: DoodleSubject[];
  doodlePrompt: string;
}

export interface VibeModeOption {
  id: VibeMode;
  label: string;
  shortTag: string;
  activeBgClass: string;
}

export const RETRO_LOADING_MESSAGES: string[] = [
  "Reading pose & facial aura...",
  "Consulting 1999 pixel spirits...",
  "Sketching your chaotic energy...",
  "Calibrating outfit drip factor...",
  "Inking bold 90s comic outlines...",
];

export const VIBE_MODE_OPTIONS: VibeModeOption[] = [
  {
    id: "wholesome",
    label: "Wholesome",
    shortTag: "Warm Hype",
    activeBgClass: "bg-[#2EE59D]",
  },
  {
    id: "roast",
    label: "Roast",
    shortTag: "Playful Roast",
    activeBgClass: "bg-[#FFD60A]",
  },
  {
    id: "cyberpunk",
    label: "Cyberpunk",
    shortTag: "Neon Oracle",
    activeBgClass: "bg-[#00C2FF]",
  },
];
```

### 7. `src/data/samplePresets.ts`

_93 lines_

```ts
/**
 * Built-in sample portraits.
 *
 * Every image is imported through Vite, so it is fingerprinted and served from
 * the app's OWN origin (dev: Vite middleware, prod: express.static(dist)).
 * Same-origin pixels never taint a <canvas>, so converting them to base64 for
 * Gemini can't hit CORS — online, offline, inside the AI Studio iframe or on
 * the deployed Cloud Run URL. No third-party hosts, no proxy needed.
 *
 * All portraits are AI-generated people (no real attendees). The two duo
 * presets are split-screen composites of two solo portraits so Co-Op Duo Mode
 * can be demoed in one click.
 */
import duoPeaceAndShades from "../assets/samples/duo-peace-and-shades.jpg";
import duoSmirkAndLaugh from "../assets/samples/duo-smirk-and-laugh.jpg";
import soloBigLaugh from "../assets/samples/solo-big-laugh.jpg";
import soloCoolSunglasses from "../assets/samples/solo-cool-sunglasses.jpg";
import soloCrossedArms from "../assets/samples/solo-crossed-arms.jpg";
import soloHackathonWindbreaker from "../assets/samples/solo-hackathon-windbreaker.jpg";
import soloPeaceSign from "../assets/samples/solo-peace-sign.jpg";
import soloThinkingPose from "../assets/samples/solo-thinking-pose.jpg";

export interface SamplePreset {
  id: string;
  url: string;
  label: string;
  kind: "solo" | "duo";
}

export const SAMPLE_PRESETS: readonly SamplePreset[] = [
  { id: "peace-sign", url: soloPeaceSign, label: "Sample · Peace Sign & Denim", kind: "solo" },
  { id: "thinking-pose", url: soloThinkingPose, label: "Sample · Thinking Pose & Round Glasses", kind: "solo" },
  { id: "big-laugh", url: soloBigLaugh, label: "Sample · Big Laugh & Plaid", kind: "solo" },
  { id: "cool-sunglasses", url: soloCoolSunglasses, label: "Sample · Amber Shades & Finger Guns", kind: "solo" },
  { id: "crossed-arms", url: soloCrossedArms, label: "Sample · Crossed Arms & Smirk", kind: "solo" },
  {
    id: "hackathon-windbreaker",
    url: soloHackathonWindbreaker,
    label: "Sample · Hackathon Windbreaker",
    kind: "solo",
  },
  { id: "duo-peace-shades", url: duoPeaceAndShades, label: "Duo Sample · Peace Sign + Finger Guns", kind: "duo" },
  { id: "duo-smirk-laugh", url: duoSmirkAndLaugh, label: "Duo Sample · Smirk + Big Laugh", kind: "duo" },
];

export const DUO_PRESET_INDICES: readonly number[] = SAMPLE_PRESETS.flatMap((preset, idx) =>
  preset.kind === "duo" ? [idx] : []
);

function shuffled(values: number[]): number[] {
  const arr = [...values];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * "Shuffle bag" picker: cycles through every preset in random order before any
 * repeats, and never serves the same portrait twice in a row.
 */
export function createSampleShuffler() {
  let bag: number[] = [];

  return (currentIndex?: number): number => {
    if (SAMPLE_PRESETS.length <= 1) return 0;
    if (!bag.length) {
      bag = shuffled(SAMPLE_PRESETS.map((_, i) => i));
      if (bag[bag.length - 1] === currentIndex) {
        // Avoid an immediate repeat across bag refills.
        [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
      }
    }
    let next = bag.pop() as number;
    if (next === currentIndex && bag.length) {
      const swap = bag.pop() as number;
      bag.push(next);
      next = swap;
    }
    return next;
  };
}

/** Alternates between duo presets (1-click Co-Op Duo demo). */
export function nextDuoIndex(currentIndex?: number): number {
  if (!DUO_PRESET_INDICES.length) return 0;
  const pos = currentIndex === undefined ? -1 : DUO_PRESET_INDICES.indexOf(currentIndex);
  if (pos === -1) {
    return DUO_PRESET_INDICES[Math.floor(Math.random() * DUO_PRESET_INDICES.length)];
  }
  return DUO_PRESET_INDICES[(pos + 1) % DUO_PRESET_INDICES.length];
}
```

### 8. `src/hooks/useCameraStream.ts`

_290 lines_

```ts
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

export type CameraStatus =
  | "idle"
  | "starting"
  | "ready"
  | "needs-tap" // stream is live but autoplay was refused — one tap starts it
  | "blocked" // permission / sandbox / permissions-policy block
  | "error"; // no camera, busy camera, insecure context, timeout…

export interface CameraStreamState {
  status: CameraStatus;
  message: string | null;
  /** True when the app runs inside an iframe (e.g. AI Studio preview). */
  inIframe: boolean;
  retry: () => void;
  stop: () => void;
  tapToPlay: () => void;
}

/** Ideal-first, then "anything that works" (older Android, odd USB webcams, iPad). */
const CONSTRAINT_LADDER: MediaStreamConstraints[] = [
  { video: { facingMode: "user", width: { ideal: 1280 } }, audio: false },
  { video: true, audio: false },
];

/** Some sandboxed iframes never resolve or reject getUserMedia. */
const GET_USER_MEDIA_TIMEOUT_MS = 12_000;
const METADATA_TIMEOUT_MS = 8_000;

export const SANDBOX_BLOCKED_MESSAGE =
  "Camera blocked in preview sandbox — works automatically on live site! Use Upload or Sample here.";

function detectIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true; // cross-origin parent → definitely framed
  }
}

/** null = browser can't tell us; false = the embedding page disallows camera. */
function cameraAllowedByPermissionsPolicy(): boolean | null {
  const doc = document as Document & {
    permissionsPolicy?: { allowsFeature?: (feature: string) => boolean };
    featurePolicy?: { allowsFeature?: (feature: string) => boolean };
  };
  const policy = doc.permissionsPolicy ?? doc.featurePolicy;
  if (!policy?.allowsFeature) return null;
  try {
    return policy.allowsFeature("camera");
  } catch {
    return null;
  }
}

function errorName(err: unknown): string {
  if (err && typeof err === "object" && "name" in err) return String((err as { name: unknown }).name);
  return "";
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      /* already stopped */
    }
  });
}

export function useCameraStream(
  videoRef: RefObject<HTMLVideoElement | null>,
  active: boolean
): CameraStreamState {
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const requestIdRef = useRef(0);
  const inIframeRef = useRef(detectIframe());

  const stop = useCallback(() => {
    requestIdRef.current += 1;
    stopStream(streamRef.current);
    streamRef.current = null;
    const video = videoRef.current;
    if (video) {
      video.onloadedmetadata = null;
      try {
        video.pause();
      } catch {
        /* noop */
      }
      video.srcObject = null;
    }
    setStatus("idle");
  }, [videoRef]);

  const fail = useCallback((nextStatus: "blocked" | "error", nextMessage: string) => {
    setStatus(nextStatus);
    setMessage(nextMessage);
  }, []);

  const start = useCallback(async () => {
    stop();
    const requestId = ++requestIdRef.current;
    const isCurrent = () => requestIdRef.current === requestId;
    const inIframe = inIframeRef.current;

    setStatus("starting");
    setMessage(null);

    if (!window.isSecureContext) {
      fail("error", "Camera needs a secure (https://) page. Use Upload or Sample here.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      fail(inIframe ? "blocked" : "error", inIframe ? SANDBOX_BLOCKED_MESSAGE : "This browser has no camera API. Use Upload or Sample instead.");
      return;
    }
    if (cameraAllowedByPermissionsPolicy() === false) {
      // The embedding page didn't grant `allow="camera"` — calling getUserMedia
      // would just throw (or hang), so short-circuit with the friendly message.
      fail("blocked", SANDBOX_BLOCKED_MESSAGE);
      return;
    }

    let stream: MediaStream | null = null;
    let lastError: unknown = null;

    for (const constraints of CONSTRAINT_LADDER) {
      try {
        stream = await new Promise<MediaStream>((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new DOMException("getUserMedia timed out", "TimeoutError")), GET_USER_MEDIA_TIMEOUT_MS);
          navigator.mediaDevices.getUserMedia(constraints).then(
            (s) => {
              window.clearTimeout(timer);
              // A late stream after timeout/unmount must still be released.
              if (!isCurrent()) {
                stopStream(s);
                reject(new DOMException("stale", "AbortError"));
                return;
              }
              resolve(s);
            },
            (e) => {
              window.clearTimeout(timer);
              reject(e);
            }
          );
        });
        break;
      } catch (err) {
        if (!isCurrent()) return;
        lastError = err;
        const name = errorName(err);
        // Permission/sandbox blocks won't change with looser constraints.
        if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") break;
        if (name === "NotFoundError" || name === "DevicesNotFoundError") break;
        if (name === "TimeoutError") break;
        // OverconstrainedError / NotReadableError / AbortError / TypeError → try looser constraints.
      }
    }

    if (!isCurrent()) {
      stopStream(stream);
      return;
    }

    if (!stream) {
      const name = errorName(lastError);
      if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
        fail(
          "blocked",
          inIframe
            ? SANDBOX_BLOCKED_MESSAGE
            : "Camera permission was denied. Allow it via the padlock icon in the address bar, then hit RETRY — or use Upload/Sample."
        );
      } else if (name === "TimeoutError") {
        fail(
          inIframe ? "blocked" : "error",
          inIframe ? SANDBOX_BLOCKED_MESSAGE : "The camera didn't respond. Check for a permission prompt, then hit RETRY."
        );
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
        fail("error", "No camera detected on this device. Use Upload or Sample instead.");
      } else if (name === "NotReadableError" || name === "TrackStartError") {
        fail("error", "Your camera is busy in another app (Zoom/Meet?). Close it and hit RETRY.");
      } else {
        fail("error", "Could not start the camera feed. Hit RETRY, or use Upload or Sample.");
      }
      return;
    }

    streamRef.current = stream;
    stream.getVideoTracks().forEach((track) => {
      track.addEventListener("ended", () => {
        if (streamRef.current === stream) {
          fail("error", "Camera disconnected. Hit RETRY to reconnect.");
        }
      });
    });

    const video = videoRef.current;
    if (!video) {
      stopStream(stream);
      streamRef.current = null;
      setStatus("idle");
      return;
    }

    // iOS Safari & Chrome need all three BEFORE srcObject, or you get a black box.
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("muted", "");
    video.srcObject = stream;

    const playback = await new Promise<"playing" | "needs-tap" | "timeout">((resolve) => {
      const timer = window.setTimeout(() => resolve("timeout"), METADATA_TIMEOUT_MS);
      const onMeta = async () => {
        video.onloadedmetadata = null;
        window.clearTimeout(timer);
        try {
          await video.play();
          resolve("playing");
        } catch {
          resolve("needs-tap");
        }
      };
      video.onloadedmetadata = () => void onMeta();
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) void onMeta();
    });

    if (!isCurrent()) return;

    if (playback === "playing") {
      setStatus("ready");
    } else if (playback === "needs-tap") {
      setStatus("needs-tap");
    } else {
      fail("error", "Camera started but sent no frames. Hit RETRY.");
    }
  }, [fail, stop, videoRef]);

  const tapToPlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video
      .play()
      .then(() => setStatus("ready"))
      .catch(() => fail("error", "Your browser blocked the preview. Hit RETRY."));
  }, [fail, videoRef]);

  const retry = useCallback(() => setRetryToken((t) => t + 1), []);

  // Start/stop with the Camera tab; always release tracks on unmount/tab switch.
  useEffect(() => {
    if (!active) {
      stop();
      return;
    }
    void start();
    return () => stop();
  }, [active, retryToken, start, stop]);

  // Turn the webcam light off when the tab is hidden; resume when visible.
  useEffect(() => {
    if (!active) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
      } else if (!streamRef.current) {
        setRetryToken((t) => t + 1);
      }
    };
    const onPageHide = () => stop();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [active, stop]);

  return { status, message, inIframe: inIframeRef.current, retry, stop, tapToPlay };
}
```

### 9. `src/utils/apiClient.ts`

_217 lines_

```ts
/**
 * Resilient NDJSON client for the VibeCheck API.
 *
 * - Hard timeout (default 65s) = server's 60s Gemini budget + 5s grace, so the
 *   server always gets to report its own, more specific error first.
 * - Idle watchdog: the server heartbeats every 5s, so 20s of silence means the
 *   connection was dropped by a proxy → fail fast instead of hanging.
 * - Transport failures (dropped stream, gateway 502/503/504 HTML, network
 *   error, idle timeout) are flagged `retryable` so callers can retry once.
 */

export const CLIENT_REQUEST_TIMEOUT_MS = 65_000;
export const CLIENT_IDLE_TIMEOUT_MS = 20_000;

type StreamEvent<T> =
  | { type: "heartbeat"; status: string }
  | { type: "status"; message: string }
  | { type: "result"; data: T }
  | { type: "error"; status?: number; kind?: string; error: string };

export class ApiRequestError extends Error {
  readonly retryable: boolean;
  readonly status?: number;
  readonly kind?: string;

  constructor(message: string, opts: { retryable: boolean; status?: number; kind?: string }) {
    super(message);
    this.name = "ApiRequestError";
    this.retryable = opts.retryable;
    this.status = opts.status;
    this.kind = opts.kind;
  }
}

export interface StreamRequestOptions {
  timeoutMs?: number;
  idleTimeoutMs?: number;
  signal?: AbortSignal;
  onStatus?: (message: string) => void;
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export async function postNdjson<T>(
  url: string,
  payload: unknown,
  { timeoutMs = CLIENT_REQUEST_TIMEOUT_MS, idleTimeoutMs = CLIENT_IDLE_TIMEOUT_MS, signal, onStatus }: StreamRequestOptions = {}
): Promise<T> {
  if (signal?.aborted) throw new DOMException("Request cancelled.", "AbortError");

  const controller = new AbortController();
  let timeoutReason: "hard" | "idle" | null = null;

  const onExternalAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onExternalAbort, { once: true });

  const hardTimer = window.setTimeout(() => {
    timeoutReason = "hard";
    controller.abort();
  }, timeoutMs);

  let idleTimer = 0;
  const armIdle = () => {
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      timeoutReason = "idle";
      controller.abort();
    }, idleTimeoutMs);
  };

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  try {
    // The idle watchdog only starts once headers arrive: a scaled-to-zero
    // container can legitimately take a while to accept the connection.
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson, application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: "no-store",
    });
    armIdle();

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

    if (response.ok && contentType.includes("application/x-ndjson") && response.body) {
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResult: T | undefined;
      let hasResult = false;

      const handleLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let evt: StreamEvent<T>;
        try {
          evt = JSON.parse(trimmed) as StreamEvent<T>;
        } catch {
          return; // ignore partial/garbled keep-alive noise
        }
        if (evt.type === "status" && evt.message) {
          onStatus?.(evt.message);
        } else if (evt.type === "result") {
          finalResult = evt.data;
          hasResult = true;
        } else if (evt.type === "error") {
          throw new ApiRequestError(evt.error || `Server error on ${url}`, {
            retryable: false,
            status: evt.status,
            kind: evt.kind,
          });
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        armIdle();
        if (value) {
          buffer += decoder.decode(value, { stream: !done });
          let newlineIndex = buffer.indexOf("\n");
          while (newlineIndex !== -1) {
            handleLine(buffer.slice(0, newlineIndex));
            buffer = buffer.slice(newlineIndex + 1);
            newlineIndex = buffer.indexOf("\n");
          }
        }
        if (done) break;
      }
      if (buffer.trim()) handleLine(buffer);

      if (!hasResult || finalResult === undefined) {
        throw new ApiRequestError("Connection dropped before the result arrived.", { retryable: true });
      }
      return finalResult;
    }

    const rawText = await response.text();
    let data: (T & { error?: string; kind?: string }) | null = null;
    try {
      data = rawText ? (JSON.parse(rawText) as T & { error?: string; kind?: string }) : null;
    } catch {
      data = null;
    }

    if (!response.ok || !data) {
      // A non-JSON 502/503/504 is a proxy/gateway hiccup (cold start) — retryable.
      const gatewayHiccup = !data && [502, 503, 504].includes(response.status);
      throw new ApiRequestError(
        data?.error || (gatewayHiccup ? "Server is waking up — retrying..." : `HTTP ${response.status} ${response.statusText}`),
        { retryable: gatewayHiccup, status: response.status, kind: data?.kind }
      );
    }
    return data as T;
  } catch (err) {
    if (timeoutReason === "hard") {
      throw new ApiRequestError(
        `The vibe oracle took longer than ${Math.round(timeoutMs / 1000)}s. Hit TRY AGAIN — it's usually instant once warm.`,
        { retryable: false, kind: "timeout" }
      );
    }
    if (timeoutReason === "idle") {
      throw new ApiRequestError("Connection went quiet (dropped by a proxy).", { retryable: true, kind: "idle" });
    }
    if (isAbortError(err)) throw err;
    if (err instanceof ApiRequestError) throw err;
    // fetch() TypeError = network failure / connection reset.
    throw new ApiRequestError(err instanceof Error ? err.message : "Network request failed.", {
      retryable: true,
      kind: "network",
    });
  } finally {
    window.clearTimeout(hardTimer);
    window.clearTimeout(idleTimer);
    signal?.removeEventListener("abort", onExternalAbort);
    reader?.cancel().catch(() => undefined);
  }
}

/**
 * Same as postNdjson but transparently retries ONE time on transport failures
 * (dropped stream during a cold start, gateway hiccup), within an overall
 * time budget. Server-reported errors are not retried — the server already
 * did exponential backoff + model fallback.
 */
export async function postNdjsonWithRetry<T>(
  url: string,
  payload: unknown,
  options: StreamRequestOptions & { totalBudgetMs?: number } = {}
): Promise<T> {
  const { totalBudgetMs = CLIENT_REQUEST_TIMEOUT_MS, ...rest } = options;
  const startedAt = Date.now();

  try {
    return await postNdjson<T>(url, payload, { ...rest, timeoutMs: totalBudgetMs });
  } catch (err) {
    const remaining = totalBudgetMs - (Date.now() - startedAt);
    if (!(err instanceof ApiRequestError) || !err.retryable || remaining < 15_000 || rest.signal?.aborted) {
      throw err;
    }
    console.warn(`[API ${url}] transport hiccup, retrying once:`, err.message);
    rest.onStatus?.("Reconnecting to the vibe oracle...");
    await new Promise((r) => window.setTimeout(r, 600));
    return postNdjson<T>(url, payload, { ...rest, timeoutMs: remaining - 600 });
  }
}

/** Fire-and-forget wake-up ping so a scaled-to-zero instance boots early. */
export function warmUpServer(): void {
  fetch("/api/health", { cache: "no-store" }).catch(() => undefined);
}
```

### 10. `src/utils/imageUtils.ts`

_134 lines_

```ts
const MAX_RAW_FILE_BYTES = 30 * 1024 * 1024;
const MAX_DIMENSION_PX = 1024;
const JPEG_QUALITY = 0.85;

export function validateImageFile(file: File): void {
  if (!file.type.startsWith("image/")) {
    throw new Error("Unsupported file type. Please choose a PNG, JPG, or WebP image.");
  }
  if (file.size === 0) {
    throw new Error("The selected image file appears to be empty.");
  }
  if (file.size > MAX_RAW_FILE_BYTES) {
    throw new Error("Image file is larger than 30 MB. Please choose a smaller photo.");
  }
}

function compressObjectUrl(objectUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        if (!width || !height) {
          reject(new Error("Could not read image dimensions."));
          return;
        }

        const scale = Math.min(1, MAX_DIMENSION_PX / Math.max(width, height));
        const targetWidth = Math.max(1, Math.round(width * scale));
        const targetHeight = Math.max(1, Math.round(height * scale));

        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas context unavailable for image optimization."));
          return;
        }

        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, targetWidth, targetHeight);
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
      } catch (err) {
        reject(
          err instanceof Error
            ? err
            : new Error("Failed to process selected image.")
        );
      }
    };
    img.onerror = () => reject(new Error("Could not decode the selected image."));
    img.src = objectUrl;
  });
}

export async function fileToBase64(file: File): Promise<string> {
  validateImageFile(file);
  const objectUrl = URL.createObjectURL(file);
  try {
    return await compressObjectUrl(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Converts a SAME-ORIGIN image URL (e.g. a Vite-bundled sample) to a compressed
 * JPEG data URL. Path 1 reads the bytes via fetch → Blob → object URL, which can
 * never taint the canvas. Path 2 (if fetch is blocked, e.g. by a strict service
 * worker or sandbox) decodes the same-origin URL directly in an <img>; same-
 * origin pixels are still canvas-safe.
 */
export async function urlToBase64(imageUrl: string): Promise<string> {
  const absolute = new URL(imageUrl, window.location.href);
  if (absolute.origin !== window.location.origin && !absolute.protocol.startsWith("data")) {
    throw new Error(
      "Sample images must be bundled with the app (same origin) to avoid CORS canvas tainting."
    );
  }

  try {
    const response = await fetch(absolute.href, { cache: "force-cache" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) {
      throw new Error(`Unexpected content-type ${blob.type || "unknown"}`);
    }
    const objectUrl = URL.createObjectURL(blob);
    try {
      return await compressObjectUrl(objectUrl);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch (fetchErr) {
    console.warn("[Sample Loader] fetch path failed, decoding via <img>:", fetchErr);
    try {
      return await compressObjectUrl(absolute.href);
    } catch {
      throw new Error("Could not load the built-in sample photo. Try SHUFFLE SAMPLE or Upload.");
    }
  }
}

export function captureVideoFrame(video: HTMLVideoElement): string {
  const width = video.videoWidth;
  const height = video.videoHeight;

  if (video.readyState < 2 || !width || !height) {
    throw new Error("Camera feed is still warming up. Please try again in a second.");
  }

  const scale = Math.min(1, MAX_DIMENSION_PX / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not access canvas context to snap photo.");
  }

  ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}
```

### 11. `src/utils/retroBadgeSvg.ts`

_725 lines_

```ts
/**
 * Zero-fail fallback art: a deterministic, multi-layer 1990s comic sticker
 * character drawn entirely in SVG from the traits analyzeVibe extracted
 * (hair, skin tone, eyewear, expression, hand gesture, outfit pattern/colours).
 *
 * Layers (back → front):
 *   mode-coloured backdrop → halftone → pop burst rays → Haring motion ticks
 *   → die-cut sticker character(s) (white border + ink keyline + hard shadow)
 *   → sparkles / mode doodles → level pill → class ribbon
 *
 * No network, no fonts to load, no canvas tainting (data: URL).
 */
import type { DoodleSubject, VibeAnalysisResult, VibeMode } from "../types/vibe";

const INK = "#111111";
const WHITE = "#FFFFFF";
const POP = {
  yellow: "#FFD60A",
  coral: "#FF3B5C",
  cyan: "#00C2FF",
  mint: "#2EE59D",
  cream: "#FFF4D6",
  purple: "#7B61FF",
};

/* ── small utils ─────────────────────────────────────────────────────────── */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const HEX_RE = /^#[0-9a-f]{6}$/i;
function hex(value: string | undefined, fallback: string): string {
  return value && HEX_RE.test(value) ? value : fallback;
}

function shade(color: string, amount: number): string {
  // amount < 0 darkens, > 0 lightens
  const n = parseInt(color.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const target = amount < 0 ? 0 : 255;
    return Math.round(c + (target - c) * Math.abs(amount));
  });
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function luminance(color: string): number {
  const n = parseInt(color.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seed: number) {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10_000) / 10_000;
  };
}

const f = (n: number) => Number(n.toFixed(1));

/* ── defaults when traits are missing (legacy payloads) ──────────────────── */

const DEFAULT_SUBJECT: DoodleSubject = {
  position: "center",
  hairstyle: "short tousled hair",
  hairColorHex: "#2B1B12",
  skinToneHex: "#C68A5E",
  eyewear: "none",
  eyewearDetail: "none",
  accessories: "none",
  expression: "grin",
  expressionDetail: "",
  gesture: "relaxed",
  gestureDetail: "",
  outfit: "casual tee",
  outfitPattern: "solid",
  topColorHex: POP.cyan,
  accentColorHex: POP.coral,
};

/* ── primitives ─────────────────────────────────────────────────────────── */

/** Thick inked limb: ink stroke underneath, colour stroke on top. */
function limb(d: string, color: string, width = 30): string {
  return `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${width + 12}" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function finger(x: number, y: number, len: number, angle: number, skin: string): string {
  return `<rect x="${f(x - 6.5)}" y="${f(y - len)}" width="13" height="${len}" rx="6.5" fill="${skin}" stroke="${INK}" stroke-width="5" transform="rotate(${angle} ${f(x)} ${f(y)})"/>`;
}

function fist(x: number, y: number, skin: string, r = 19): string {
  return `<circle cx="${f(x)}" cy="${f(y)}" r="${r}" fill="${skin}" stroke="${INK}" stroke-width="6"/>
  <path d="M${f(x - r * 0.55)} ${f(y - r * 0.1)} h${f(r * 1.1)} M${f(x - r * 0.55)} ${f(y + r * 0.35)} h${f(r * 1.1)}" stroke="${shade(skin, -0.35)}" stroke-width="3.5" stroke-linecap="round"/>`;
}

function openPalm(x: number, y: number, skin: string, tilt = 0): string {
  const fingers = [-24, -8, 8, 24]
    .map((a, i) => finger(x + (i - 1.5) * 9, y - 12, i === 0 || i === 3 ? 24 : 30, a * 0.6 + tilt, skin))
    .join("");
  return `<g>${fingers}${finger(x - 20, y + 4, 22, -70 + tilt, skin)}
  <ellipse cx="${f(x)}" cy="${f(y)}" rx="20" ry="22" fill="${skin}" stroke="${INK}" stroke-width="6"/></g>`;
}

/* ── hair ───────────────────────────────────────────────────────────────── */

type HairKind = "curly" | "long" | "short" | "quiff" | "buzz" | "bun" | "ponytail";

function classifyHair(hairstyle: string): { kind: HairKind; long: boolean; bangs: boolean } {
  const h = hairstyle.toLowerCase();
  const long = /long|shoulder|wavy|flowing|waist|chest-length|past the shoulders/.test(h);
  const bangs = /bangs|fringe/.test(h);
  if (/bald|shaved|buzz|crew ?cut/.test(h)) return { kind: "buzz", long: false, bangs: false };
  if (/curl|coil|afro|ringlet|kinky|spiral/.test(h)) return { kind: "curly", long, bangs };
  if (/bun|top ?knot/.test(h)) return { kind: "bun", long: false, bangs };
  if (/ponytail/.test(h)) return { kind: "ponytail", long: false, bangs };
  if (long) return { kind: "long", long: true, bangs };
  if (/quiff|pompadour|spiky|swept|slick|undercut/.test(h)) return { kind: "quiff", long: false, bangs };
  return { kind: "short", long: false, bangs };
}

/** Cloud of curls — drawn twice (ink pass, then fill pass) so overlaps merge into one silhouette. */
function curlCloud(points: Array<[number, number, number]>, fill: string, highlight: string): string {
  const ink = points.map(([x, y, r]) => `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r + 6)}" fill="${INK}"/>`).join("");
  const body = points.map(([x, y, r]) => `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${fill}"/>`).join("");
  const shine = points
    .filter((_, i) => i % 3 === 0)
    .map(([x, y, r]) => `<path d="M${f(x - r * 0.45)} ${f(y - r * 0.2)} q${f(r * 0.35)} ${f(-r * 0.45)} ${f(r * 0.75)} ${f(-r * 0.1)}" fill="none" stroke="${highlight}" stroke-width="4" stroke-linecap="round"/>`)
    .join("");
  return ink + body + shine;
}

function hairBack(kind: HairKind, long: boolean, hair: string, highlight: string): string {
  switch (kind) {
    case "curly": {
      const pts: Array<[number, number, number]> = [];
      const bottom = long ? 30 : -60;
      for (let a = 160; a <= 380; a += 17) {
        const rad = (a * Math.PI) / 180;
        pts.push([Math.cos(rad) * 82, -108 + Math.sin(rad) * 84, 30]);
      }
      for (let y = -90; y <= bottom; y += 26) {
        pts.push([-86 - (long ? (y + 90) * 0.12 : 0), y, 27]);
        pts.push([86 + (long ? (y + 90) * 0.12 : 0), y, 27]);
      }
      return curlCloud(pts, hair, highlight);
    }
    case "long":
      return `<path d="M-84 -112 C-100 -200 100 -200 84 -112 L98 18 C70 34 -70 34 -98 18 Z" fill="${hair}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>
      <path d="M-62 -40 L-70 10 M64 -40 L72 10" stroke="${shade(hair, -0.3)}" stroke-width="5" stroke-linecap="round"/>`;
    case "bun":
      return `<circle cx="0" cy="-192" r="30" fill="${hair}" stroke="${INK}" stroke-width="7"/>
      <path d="M-14 -200 q14 -10 28 0" stroke="${highlight}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    case "ponytail":
      return `<path d="M58 -150 C120 -150 126 -60 100 -10 C92 -50 80 -90 58 -110 Z" fill="${hair}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>`;
    default:
      return "";
  }
}

function hairFront(kind: HairKind, bangs: boolean, hair: string, highlight: string): string {
  const fringe = bangs
    ? `<path d="M-66 -128 C-60 -170 60 -170 66 -128 L54 -118 L44 -130 L30 -116 L16 -130 L0 -116 L-16 -130 L-30 -116 L-44 -130 L-56 -116 Z" fill="${hair}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>`
    : "";
  switch (kind) {
    case "curly": {
      const pts: Array<[number, number, number]> = [];
      for (let x = -56; x <= 56; x += 22) pts.push([x, -152 + Math.abs(x) * 0.25, 18]);
      return curlCloud(pts, hair, highlight);
    }
    case "long":
      return (
        fringe ||
        `<path d="M-74 -108 C-76 -186 72 -192 76 -106 C50 -150 10 -156 -18 -140 C-40 -150 -62 -136 -74 -108 Z" fill="${hair}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>
        <path d="M-30 -160 q24 -14 50 -6" stroke="${highlight}" stroke-width="5" fill="none" stroke-linecap="round"/>`
      );
    case "quiff":
      return `<path d="M-72 -104 C-80 -176 30 -205 78 -160 C90 -150 80 -120 72 -104 C58 -140 24 -150 -6 -142 C-36 -150 -60 -136 -72 -104 Z" fill="${hair}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>
      <path d="M-20 -176 q40 -26 82 -6" stroke="${highlight}" stroke-width="5" fill="none" stroke-linecap="round"/>${fringe}`;
    case "buzz":
      return `<path d="M-70 -110 C-74 -178 74 -178 70 -110 C50 -150 -50 -150 -70 -110 Z" fill="${hair}" opacity="0.55" stroke="${INK}" stroke-width="5"/>`;
    case "bun":
    case "ponytail":
    case "short":
    default:
      return `<path d="M-72 -102 C-80 -182 78 -186 72 -102 C62 -142 22 -152 -8 -142 C-38 -152 -62 -136 -72 -102 Z" fill="${hair}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>
      <path d="M-28 -164 q24 -12 48 -4" stroke="${highlight}" stroke-width="5" fill="none" stroke-linecap="round"/>${fringe}`;
  }
}

/* ── face ───────────────────────────────────────────────────────────────── */

function eyesAndBrows(s: DoodleSubject, hiddenEyes: boolean): string {
  const brow = (x: number, lift: number, tilt: number) =>
    `<path d="M${x - 16} ${-124 - lift + tilt} Q${x} ${-134 - lift} ${x + 16} ${-124 - lift - tilt}" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`;
  const oval = (x: number, rx = 7.5, ry = 10.5) =>
    `<ellipse cx="${x}" cy="-96" rx="${rx}" ry="${ry}" fill="${INK}"/><circle cx="${x + 2.5}" cy="-100" r="2.8" fill="${WHITE}"/>`;

  let eyes = "";
  let brows = "";
  switch (s.expression) {
    case "big-laugh":
      eyes = `<path d="M-40 -94 Q-27 -112 -14 -94 M14 -94 Q27 -112 40 -94" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`;
      brows = brow(-27, 8, 0) + brow(27, 8, 0);
      break;
    case "surprised":
      eyes = `<circle cx="-27" cy="-96" r="13" fill="${WHITE}" stroke="${INK}" stroke-width="5"/><circle cx="27" cy="-96" r="13" fill="${WHITE}" stroke="${INK}" stroke-width="5"/><circle cx="-27" cy="-95" r="5.5" fill="${INK}"/><circle cx="27" cy="-95" r="5.5" fill="${INK}"/>`;
      brows = brow(-27, 12, 0) + brow(27, 12, 0);
      break;
    case "smirk":
      eyes = `${oval(-27)}<ellipse cx="27" cy="-94" rx="8" ry="6" fill="${INK}"/><path d="M15 -99 h24" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`;
      brows = brow(-27, 8, -3) + brow(27, 0, 3);
      break;
    case "focused":
      eyes = `${oval(-27, 6.5, 8)}${oval(27, 6.5, 8)}`;
      brows = `<path d="M-44 -122 L-12 -114 M44 -122 L12 -114" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`;
      break;
    case "deadpan":
      eyes = `<path d="M-38 -96 h22 M16 -96 h22" stroke="${INK}" stroke-width="6" stroke-linecap="round"/><path d="M-34 -92 a6 5 0 0 0 12 0 M22 -92 a6 5 0 0 0 12 0" fill="${INK}"/>`;
      brows = `<path d="M-42 -118 h28 M14 -118 h28" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`;
      break;
    default: // grin / soft-smile
      eyes = `${oval(-27)}${oval(27)}`;
      brows = brow(-27, 3, 0) + brow(27, 3, 0);
  }
  return (hiddenEyes ? "" : eyes) + brows;
}

function mouth(expression: DoodleSubject["expression"]): string {
  switch (expression) {
    case "big-laugh":
      return `<path d="M-36 -62 Q0 -66 36 -62 Q32 -14 0 -12 Q-32 -14 -36 -62 Z" fill="#6E0F22" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>
      <path d="M-30 -60 Q0 -63 30 -60 L28 -50 Q0 -46 -28 -50 Z" fill="${WHITE}"/>
      <ellipse cx="0" cy="-26" rx="17" ry="9" fill="${POP.coral}"/>`;
    case "grin":
      return `<path d="M-34 -64 Q0 -26 34 -64 Z" fill="${WHITE}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/><path d="M-26 -58 Q0 -50 26 -58" stroke="${INK}" stroke-width="3" fill="none"/>`;
    case "soft-smile":
      return `<path d="M-24 -58 Q0 -40 24 -58" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`;
    case "smirk":
      return `<path d="M-20 -54 Q6 -48 30 -66" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/><path d="M27 -70 q6 4 4 9" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`;
    case "surprised":
      return `<ellipse cx="0" cy="-50" rx="12" ry="15" fill="#6E0F22" stroke="${INK}" stroke-width="6"/>`;
    case "focused":
      return `<path d="M-14 -54 Q0 -50 14 -54" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`;
    case "deadpan":
    default:
      return `<path d="M-18 -54 H18" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`;
  }
}

function eyewear(s: DoodleSubject): string {
  if (s.eyewear === "none") return "";
  const d = `${s.eyewearDetail} ${s.eyewear}`.toLowerCase();
  const frame = /tortoise|brown|amber frame/.test(d)
    ? "#6B3A1E"
    : /gold|wire|metal/.test(d)
      ? "#C9A227"
      : /red|pink/.test(d) && s.eyewear === "glasses"
        ? POP.coral
        : /clear|transparent/.test(d)
          ? "#8FA3B0"
          : INK;
  const round = /round|circle|circular/.test(d);
  const sun = s.eyewear === "sunglasses";
  const tint = /amber|orange|yellow|gold/.test(d)
    ? "#FFB000"
    : /red|pink|rose/.test(d)
      ? POP.coral
      : /blue|mirror|cyan/.test(d)
        ? POP.cyan
        : /green/.test(d)
          ? POP.mint
          : "#1C1C1C";
  const lensFill = sun ? tint : WHITE;
  const lensOpacity = sun ? 1 : 0.28;
  const lens = (cx: number) =>
    round
      ? `<circle cx="${cx}" cy="-96" r="22" fill="${lensFill}" fill-opacity="${lensOpacity}" stroke="${frame}" stroke-width="7"/>`
      : `<rect x="${cx - 24}" y="-115" width="48" height="36" rx="10" fill="${lensFill}" fill-opacity="${lensOpacity}" stroke="${frame}" stroke-width="7"/>`;
  const glare = (cx: number) =>
    `<path d="M${cx - 12} -104 l10 -8" stroke="${WHITE}" stroke-width="5" stroke-linecap="round" opacity="${sun ? 0.9 : 0.75}"/>`;
  return `<g>${lens(-28)}${lens(28)}${glare(-28)}${glare(28)}
    <path d="M-5 -98 Q0 -104 5 -98" fill="none" stroke="${frame}" stroke-width="6"/>
    <path d="M-52 -100 L-68 -104 M52 -100 L68 -104" stroke="${frame}" stroke-width="6" stroke-linecap="round"/></g>`;
}

/* ── outfit ─────────────────────────────────────────────────────────────── */

const TORSO_PATH =
  "M-120 210 L-120 44 C-120 4 -84 -12 -40 -16 L40 -16 C84 -12 120 4 120 44 L120 210 Z";

function outfitPattern(s: DoodleSubject, clipId: string, rand: () => number): string {
  const top = s.topColorHex;
  const accent = s.accentColorHex;
  const dark = shade(top, -0.3);
  const light = shade(top, 0.35);
  let pattern = "";

  switch (s.outfitPattern) {
    case "plaid":
      for (let x = -118; x < 120; x += 52) pattern += `<rect x="${x}" y="-20" width="22" height="240" fill="${accent}" opacity="0.55"/>`;
      for (let y = -6; y < 220; y += 52) pattern += `<rect x="-130" y="${y}" width="260" height="22" fill="${accent}" opacity="0.45"/>`;
      for (let x = -106; x < 120; x += 52) pattern += `<path d="M${x} -20 V220" stroke="${dark}" stroke-width="3" opacity="0.6"/>`;
      for (let y = 6; y < 220; y += 52) pattern += `<path d="M-130 ${y} H130" stroke="${dark}" stroke-width="3" opacity="0.6"/>`;
      break;
    case "stripes":
      for (let y = 4; y < 220; y += 30) pattern += `<rect x="-130" y="${y}" width="260" height="13" fill="${accent}"/>`;
      break;
    case "denim":
      pattern += `<path d="M-120 40 Q0 62 120 40" fill="none" stroke="${light}" stroke-width="4" stroke-dasharray="7 6"/>
        <rect x="-82" y="54" width="44" height="34" rx="4" fill="${shade(top, -0.08)}" stroke="${INK}" stroke-width="4"/>
        <rect x="38" y="54" width="44" height="34" rx="4" fill="${shade(top, -0.08)}" stroke="${INK}" stroke-width="4"/>
        <path d="M-78 66 H-42 M42 66 H78" stroke="${light}" stroke-width="3" stroke-dasharray="5 4"/>
        <circle cx="-60" cy="62" r="3.5" fill="${POP.yellow}" stroke="${INK}" stroke-width="2"/><circle cx="60" cy="62" r="3.5" fill="${POP.yellow}" stroke="${INK}" stroke-width="2"/>`;
      break;
    case "graphic-print": {
      const colors = [POP.yellow, POP.coral, POP.cyan, POP.mint, WHITE, accent];
      for (let i = 0; i < 16; i += 1) {
        const x = -110 + rand() * 220;
        const y = 0 + rand() * 200;
        const c = colors[Math.floor(rand() * colors.length)];
        const kind = Math.floor(rand() * 3);
        pattern +=
          kind === 0
            ? `<circle cx="${f(x)}" cy="${f(y)}" r="${f(8 + rand() * 9)}" fill="${c}" stroke="${INK}" stroke-width="3.5"/>`
            : kind === 1
              ? `<path d="M${f(x)} ${f(y)} l10 -10 l10 10 l10 -10 l10 10" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`
              : `<rect x="${f(x)}" y="${f(y)}" width="${f(12 + rand() * 10)}" height="${f(12 + rand() * 10)}" transform="rotate(${f(rand() * 60)} ${f(x)} ${f(y)})" fill="${c}" stroke="${INK}" stroke-width="3.5"/>`;
      }
      break;
    }
    case "color-block":
      pattern += `<path d="M-130 70 L130 10 L130 220 L-130 220 Z" fill="${accent}"/><path d="M-130 70 L130 10" stroke="${INK}" stroke-width="5"/>`;
      break;
    case "knit":
      for (let y = 10; y < 220; y += 20) {
        for (let x = -116; x < 120; x += 18) {
          pattern += `<path d="M${x} ${y} l7 8 l7 -8" fill="none" stroke="${dark}" stroke-width="3" opacity="0.55"/>`;
        }
      }
      break;
    default:
      break;
  }

  return `<g clip-path="url(#${clipId})">${pattern}
    <path d="M44 -20 C96 -6 124 20 124 60 L124 220 L64 220 Z" fill="${INK}" opacity="0.16"/>
  </g>`;
}

function outfitLayers(s: DoodleSubject): { innerPanel: string; overlay: string } {
  const o = s.outfit.toLowerCase();
  const layered = /jacket|hoodie|cardigan|blazer|flannel|overshirt|bomber|windbreaker|shirt over|over a|open/.test(o);
  const hoodie = /hoodie|hooded/.test(o);
  const inner = /tee|t-shirt|shirt|top|tank/.test(o) ? s.accentColorHex : shade(s.topColorHex, -0.25);

  const innerPanel = layered
    ? `<path d="M-34 -16 L34 -16 L40 220 L-40 220 Z" fill="${inner}" stroke="${INK}" stroke-width="6"/>
       <path d="M-26 -16 Q0 14 26 -16" fill="none" stroke="${INK}" stroke-width="5"/>`
    : "";

  const overlay = layered
    ? `<path d="M-34 -16 L-46 50 L-38 220 M34 -16 L46 50 L38 220" fill="none" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>
       <path d="M-34 -16 L-62 -6 L-46 40 Z M34 -16 L62 -6 L46 40 Z" fill="${shade(s.topColorHex, -0.15)}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
       ${hoodie ? `<path d="M-6 6 v34 M6 6 v34" stroke="${WHITE}" stroke-width="4" stroke-linecap="round"/>` : ""}`
    : `<path d="M-30 -16 Q0 20 30 -16" fill="none" stroke="${INK}" stroke-width="6"/>`;

  return { innerPanel, overlay };
}

function hoodBehind(s: DoodleSubject): string {
  if (!/hoodie|hooded/.test(s.outfit.toLowerCase())) return "";
  return `<path d="M-70 -10 C-90 -60 90 -60 70 -10 Z" fill="${shade(s.topColorHex, -0.12)}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>`;
}

function accessoriesNeck(s: DoodleSubject): string {
  const a = s.accessories.toLowerCase();
  let out = "";
  if (/necklace|chain|pendant/.test(a)) {
    out += `<path d="M-26 -12 Q0 30 26 -12" fill="none" stroke="#E0B200" stroke-width="5"/><circle cx="0" cy="16" r="6" fill="${POP.yellow}" stroke="${INK}" stroke-width="3"/>`;
  }
  if (/lanyard|badge/.test(a)) {
    out += `<path d="M-24 -14 L-12 70 M24 -14 L12 70" stroke="${POP.coral}" stroke-width="6"/><rect x="-22" y="66" width="44" height="54" rx="4" fill="${WHITE}" stroke="${INK}" stroke-width="5"/><rect x="-14" y="76" width="28" height="12" fill="${POP.cyan}"/>`;
  }
  return out;
}

function accessoriesHead(s: DoodleSubject, front: boolean): string {
  const a = s.accessories.toLowerCase();
  let out = "";
  if (!front && /earring|hoop|stud/.test(a)) {
    out += /stud/.test(a)
      ? `<circle cx="-70" cy="-80" r="5" fill="${POP.yellow}" stroke="${INK}" stroke-width="3"/><circle cx="70" cy="-80" r="5" fill="${POP.yellow}" stroke="${INK}" stroke-width="3"/>`
      : `<circle cx="-71" cy="-70" r="10" fill="none" stroke="#E0B200" stroke-width="5"/><circle cx="71" cy="-70" r="10" fill="none" stroke="#E0B200" stroke-width="5"/>`;
  }
  if (front && /headphone/.test(a)) {
    out += `<path d="M-80 -96 C-86 -200 86 -200 80 -96" fill="none" stroke="${INK}" stroke-width="12"/>
      <rect x="-96" y="-120" width="26" height="46" rx="10" fill="${POP.coral}" stroke="${INK}" stroke-width="6"/>
      <rect x="70" y="-120" width="26" height="46" rx="10" fill="${POP.coral}" stroke="${INK}" stroke-width="6"/>`;
  }
  if (front && /beanie/.test(a)) {
    out += `<path d="M-76 -128 C-78 -206 78 -206 76 -128 Z" fill="${s.accentColorHex}" stroke="${INK}" stroke-width="7"/><rect x="-82" y="-142" width="164" height="24" rx="10" fill="${shade(s.accentColorHex, -0.2)}" stroke="${INK}" stroke-width="6"/>`;
  } else if (front && /\bcap\b|baseball/.test(a)) {
    out += `<path d="M-74 -132 C-74 -200 74 -200 74 -132 Z" fill="${s.accentColorHex}" stroke="${INK}" stroke-width="7"/><path d="M40 -138 Q100 -140 112 -124 L60 -124 Z" fill="${shade(s.accentColorHex, -0.2)}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>`;
  }
  return out;
}

/* ── gestures ───────────────────────────────────────────────────────────── */

interface GestureLayers {
  /** Drawn over the torso, under the head. */
  body: string;
  /** Drawn on top of everything (hands near the face). */
  top: string;
}

function gesture(s: DoodleSubject): GestureLayers {
  const sleeve = s.topColorHex;
  const skin = s.skinToneHex;
  const wantsBoth = /both|two hands|double/.test(s.gestureDetail.toLowerCase());
  const leftSide = /left/.test(s.gestureDetail.toLowerCase()) && !wantsBoth;
  const m = leftSide ? -1 : 1; // which side of the canvas the main hand goes

  switch (s.gesture) {
    case "peace-sign": {
      const hx = 138 * m;
      return {
        body: limb(`M${100 * m} 24 Q${158 * m} -20 ${hx} -96`, sleeve),
        top: `${finger(hx - 7, -110, 48, -20, skin)}${finger(hx + 7, -110, 48, 20, skin)}${fist(hx, -98, skin, 21)}
          ${finger(hx - 18 * m, -92, 20, -100 * m, skin)}`,
      };
    }
    case "thinking":
      return {
        body: limb(`M${-110 * m} 200 Q${-80 * m} 50 ${-28 * m} 0`, sleeve),
        top: `${finger(-30 * m, -22, 52, -32 * m, skin)}${fist(-24 * m, -10, skin, 21)}
          <circle cx="${92 * m}" cy="-200" r="7" fill="${WHITE}" stroke="${INK}" stroke-width="4"/><circle cx="${112 * m}" cy="-222" r="11" fill="${WHITE}" stroke="${INK}" stroke-width="4"/>`,
      };
    case "arms-crossed":
      return {
        body: `${limb("M-104 52 Q0 92 96 84", sleeve, 34)}${limb("M104 52 Q0 92 -96 84", shade(sleeve, -0.08), 34)}
          <ellipse cx="-104" cy="78" rx="14" ry="17" fill="${skin}" stroke="${INK}" stroke-width="5"/>
          <ellipse cx="104" cy="78" rx="14" ry="17" fill="${skin}" stroke="${INK}" stroke-width="5"/>`,
        top: "",
      };
    case "thumbs-up": {
      const one = (side: number) =>
        `${limb(`M${112 * side} 200 Q${126 * side} 110 ${104 * side} 62`, sleeve)}${finger(104 * side, 46, 34, 0, skin)}${fist(104 * side, 58, skin, 21)}`;
      return { body: wantsBoth ? one(-1) + one(1) : one(m), top: "" };
    }
    case "finger-guns": {
      const one = (side: number) =>
        `${limb(`M${112 * side} 200 Q${100 * side} 120 ${74 * side} 74`, sleeve)}${finger(74 * side + 4 * side, 64, 38, -62 * side, skin)}${finger(74 * side, 58, 22, -8 * side, skin)}${fist(74 * side, 74, skin, 19)}`;
      return { body: one(-1) + one(1), top: "" };
    }
    case "waving":
      return {
        body: limb(`M${100 * m} 24 Q${170 * m} -30 ${158 * m} -98`, sleeve),
        top: `${openPalm(158 * m, -118, skin, 12 * m)}
          <path d="M${190 * m} -150 q12 16 0 32 M${204 * m} -160 q18 26 0 52" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`,
      };
    case "hands-up":
      return {
        body: `${limb("M-100 24 Q-168 -24 -150 -90", sleeve)}${limb("M100 24 Q168 -24 150 -90", sleeve)}`,
        top: `${openPalm(-150, -110, skin, -14)}${openPalm(150, -110, skin, 14)}`,
      };
    case "holding-object":
      return {
        body: `<rect x="-30" y="40" width="60" height="64" rx="8" fill="${s.accentColorHex}" stroke="${INK}" stroke-width="6"/>
          <path d="M30 54 h12 a14 14 0 0 1 0 28 h-12" fill="none" stroke="${INK}" stroke-width="7"/>
          <path d="M-12 30 q-6 -12 0 -24 M10 30 q-6 -12 0 -24" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round" opacity="0.6"/>
          ${limb("M-112 200 Q-70 120 -40 86", sleeve)}${limb("M112 200 Q70 120 40 86", sleeve)}
          ${fist(-38, 78, skin, 17)}${fist(38, 82, skin, 17)}`,
        top: "",
      };
    default:
      return { body: "", top: "" };
  }
}

/* ── full character ─────────────────────────────────────────────────────── */

function drawCharacter(raw: DoodleSubject, id: string, rand: () => number): string {
  const s: DoodleSubject = {
    ...raw,
    skinToneHex: hex(raw.skinToneHex, DEFAULT_SUBJECT.skinToneHex),
    hairColorHex: hex(raw.hairColorHex, DEFAULT_SUBJECT.hairColorHex),
    topColorHex: hex(raw.topColorHex, DEFAULT_SUBJECT.topColorHex),
    accentColorHex: hex(raw.accentColorHex, DEFAULT_SUBJECT.accentColorHex),
  };
  const skin = s.skinToneHex;
  const skinShadow = shade(skin, -0.22);
  const hair = s.hairColorHex;
  const hairHighlight = luminance(hair) < 0.25 ? shade(hair, 0.35) : shade(hair, 0.4);
  const { kind, long, bangs } = classifyHair(s.hairstyle);
  const g = gesture(s);
  const layers = outfitLayers(s);
  const sunglasses = s.eyewear === "sunglasses";

  return `<g>
    <defs><clipPath id="${id}-torso"><path d="${TORSO_PATH}"/></clipPath></defs>
    ${hairBack(kind, long, hair, hairHighlight)}
    ${hoodBehind(s)}
    <!-- torso -->
    <path d="${TORSO_PATH}" fill="${s.topColorHex}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>
    ${layers.innerPanel}
    ${outfitPattern(s, `${id}-torso`, rand)}
    ${layers.overlay}
    ${accessoriesNeck(s)}
    ${g.body}
    <!-- neck -->
    <path d="M-22 -48 L-22 -10 Q0 4 22 -10 L22 -48 Z" fill="${skin}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>
    <path d="M-22 -36 Q0 -20 22 -36 L22 -48 L-22 -48 Z" fill="${skinShadow}"/>
    <!-- ears + head -->
    <ellipse cx="-68" cy="-94" rx="14" ry="19" fill="${skin}" stroke="${INK}" stroke-width="6"/>
    <ellipse cx="68" cy="-94" rx="14" ry="19" fill="${skin}" stroke="${INK}" stroke-width="6"/>
    ${accessoriesHead(s, false)}
    <ellipse cx="0" cy="-100" rx="70" ry="76" fill="${skin}" stroke="${INK}" stroke-width="7"/>
    <path d="M38 -160 C78 -130 78 -60 30 -30 C58 -70 60 -120 38 -160 Z" fill="${skinShadow}" opacity="0.55"/>
    ${s.expression !== "deadpan" ? `<ellipse cx="-44" cy="-70" rx="12" ry="7" fill="${POP.coral}" opacity="0.45"/><ellipse cx="44" cy="-70" rx="12" ry="7" fill="${POP.coral}" opacity="0.45"/>` : ""}
    ${eyesAndBrows(s, sunglasses)}
    <path d="M-3 -88 Q9 -76 -3 -70" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
    ${mouth(s.expression)}
    ${hairFront(kind, bangs, hair, hairHighlight)}
    ${eyewear(s)}
    ${accessoriesHead(s, true)}
    ${g.top}
  </g>`;
}

/* ── backdrop & decorations ─────────────────────────────────────────────── */

function burstRays(cx: number, cy: number, colors: string[]): string {
  const rays: string[] = [];
  const count = 18;
  for (let i = 0; i < count; i += 1) {
    const a0 = (i / count) * Math.PI * 2;
    const a1 = ((i + 0.5) / count) * Math.PI * 2;
    const r = 420;
    rays.push(
      `<path d="M${cx} ${cy} L${f(cx + Math.cos(a0) * r)} ${f(cy + Math.sin(a0) * r)} L${f(cx + Math.cos(a1) * r)} ${f(cy + Math.sin(a1) * r)} Z" fill="${colors[i % colors.length]}" opacity="0.22"/>`
    );
  }
  return rays.join("");
}

function motionTicks(cx: number, cy: number, rand: () => number): string {
  const ticks: string[] = [];
  for (let i = 0; i < 14; i += 1) {
    const a = -Math.PI * 0.95 + (i / 13) * Math.PI * 0.9 + (rand() - 0.5) * 0.08;
    const r0 = 200 + rand() * 12;
    const r1 = r0 + 18 + rand() * 10;
    ticks.push(
      `<path d="M${f(cx + Math.cos(a) * r0)} ${f(cy + Math.sin(a) * r0)} L${f(cx + Math.cos(a) * r1)} ${f(cy + Math.sin(a) * r1)}" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`
    );
  }
  return ticks.join("");
}

function sparkle(x: number, y: number, size: number, fill: string): string {
  const s = size;
  return `<path d="M${x} ${y - s} Q${x + s * 0.18} ${y - s * 0.18} ${x + s} ${y} Q${x + s * 0.18} ${y + s * 0.18} ${x} ${y + s} Q${x - s * 0.18} ${y + s * 0.18} ${x - s} ${y} Q${x - s * 0.18} ${y - s * 0.18} ${x} ${y - s} Z" fill="${fill}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`;
}

function modeDoodles(mode: VibeMode, rand: () => number): string {
  const spots: Array<[number, number]> = [
    [60, 150],
    [452, 170],
    [72, 300],
    [440, 300],
  ];
  return spots
    .map(([x, y]) => {
      const jx = x + (rand() - 0.5) * 16;
      const jy = y + (rand() - 0.5) * 16;
      if (mode === "wholesome") {
        return `<path d="M${f(jx)} ${f(jy + 12)} C${f(jx - 22)} ${f(jy - 4)} ${f(jx - 10)} ${f(jy - 20)} ${f(jx)} ${f(jy - 8)} C${f(jx + 10)} ${f(jy - 20)} ${f(jx + 22)} ${f(jy - 4)} ${f(jx)} ${f(jy + 12)} Z" fill="${POP.coral}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`;
      }
      if (mode === "roast") {
        return `<path d="M${f(jx)} ${f(jy - 22)} C${f(jx + 16)} ${f(jy - 6)} ${f(jx + 14)} ${f(jy + 14)} ${f(jx)} ${f(jy + 16)} C${f(jx - 14)} ${f(jy + 14)} ${f(jx - 14)} ${f(jy - 2)} ${f(jx - 4)} ${f(jy - 8)} C${f(jx - 2)} ${f(jy)} ${f(jx + 2)} ${f(jy)} ${f(jx)} ${f(jy - 22)} Z" fill="#FF8A00" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`;
      }
      return `<polygon points="${f(jx + 4)},${f(jy - 22)} ${f(jx - 10)},${f(jy + 2)} ${f(jx)},${f(jy + 2)} ${f(jx - 4)},${f(jy + 22)} ${f(jx + 10)},${f(jy - 2)} ${f(jx)},${f(jy - 2)}" fill="${POP.cyan}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`;
    })
    .join("");
}

/* ── badge text helpers (kept from v1) ──────────────────────────────────── */

function extractLevelLabel(characterClass: string): string {
  const match = /\b(?:level|lvl|lv\.?)\s*(\d{1,3})\b/i.exec(characterClass);
  return match ? `LVL ${match[1]}` : "CERTIFIED";
}

function splitBadgeTitle(characterClass: string): [string, string] {
  const cleaned = characterClass
    .trim()
    .replace(/\b(?:level|lvl|lv\.?)\s*\d{1,3}\b/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= 24) return [cleaned.toUpperCase(), ""];
  const words = cleaned.split(" ");
  let line1 = "";
  let line2 = "";
  for (const word of words) {
    if ((line1 + " " + word).trim().length <= 24 && !line2) {
      line1 = (line1 + " " + word).trim();
    } else {
      line2 = (line2 + " " + word).trim();
    }
  }
  if (line2.length > 26) line2 = `${line2.slice(0, 23).trimEnd()}...`;
  return [line1.toUpperCase(), line2.toUpperCase()];
}

/* ── public API ─────────────────────────────────────────────────────────── */

export function buildRetroCharacterBadgeSvg(analysis: VibeAnalysisResult, vibeMode: VibeMode): string {
  const rand = seededRandom(hashString(`${analysis.characterClass}|${analysis.superpower}`));
  const subjects = (analysis.subjects?.length ? analysis.subjects : [DEFAULT_SUBJECT]).slice(0, analysis.isDuo ? 2 : 1);
  const isDuo = subjects.length >= 2;

  const bg = vibeMode === "cyberpunk" ? "#D9F9FF" : vibeMode === "roast" ? "#FFE4C4" : "#FFF8E7";
  const rayColors =
    vibeMode === "cyberpunk"
      ? [POP.cyan, POP.purple, POP.mint]
      : vibeMode === "roast"
        ? [POP.coral, POP.yellow, "#FF8A00"]
        : [POP.yellow, POP.mint, POP.cyan];

  const levelLabel = escapeXml(extractLevelLabel(analysis.characterClass));
  const [titleLine1, titleLine2] = splitBadgeTitle(analysis.characterClass);
  const safeLine1 = escapeXml(titleLine1);
  const safeLine2 = escapeXml(titleLine2);
  const ribbonH = safeLine2 ? 100 : 72;
  const ribbonY = 512 - ribbonH - 26;

  const characters = isDuo
    ? (() => {
        const ordered = [...subjects].sort((a, b) => (a.position === "right" ? 1 : 0) - (b.position === "right" ? 1 : 0));
        return `<g transform="translate(166 300) scale(0.7)">${drawCharacter(ordered[0], "c0", rand)}</g>
          <g transform="translate(346 306) scale(0.7)">${drawCharacter(ordered[1], "c1", rand)}</g>`;
      })()
    : `<g transform="translate(256 298) scale(0.92)">${drawCharacter(subjects[0], "c0", rand)}</g>`;

  const sparkles = [
    sparkle(92, 104, 16, POP.coral),
    sparkle(424, 112, 13, POP.cyan),
    sparkle(458, 236, 10, POP.yellow),
    sparkle(52, 230, 10, POP.mint),
  ].join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <clipPath id="stage-clip"><rect x="0" y="0" width="512" height="${ribbonY + Math.round(ribbonH / 2)}"/></clipPath>
    <pattern id="dots" width="16" height="16" patternUnits="userSpaceOnUse">
      <circle cx="4" cy="4" r="2.4" fill="${INK}" opacity="0.13"/>
    </pattern>
    <filter id="sticker" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">
      <feMorphology in="SourceAlpha" operator="dilate" radius="15" result="outer"/>
      <feMorphology in="SourceAlpha" operator="dilate" radius="11" result="inner"/>
      <feFlood flood-color="${INK}" result="ink"/>
      <feComposite in="ink" in2="outer" operator="in" result="keyline"/>
      <feOffset in="keyline" dx="7" dy="7" result="shadow"/>
      <feFlood flood-color="${WHITE}" result="white"/>
      <feComposite in="white" in2="inner" operator="in" result="border"/>
      <feMerge>
        <feMergeNode in="shadow"/>
        <feMergeNode in="keyline"/>
        <feMergeNode in="border"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <rect width="512" height="512" fill="${bg}"/>
  ${burstRays(256, 230, rayColors)}
  <rect width="512" height="512" fill="url(#dots)"/>
  ${motionTicks(256, 250, rand)}

  <g filter="url(#sticker)">
    <g clip-path="url(#stage-clip)">
      ${characters}
    </g>
  </g>

  ${sparkles}
  ${modeDoodles(vibeMode, rand)}

  <!-- level pill -->
  <rect x="180" y="24" width="152" height="38" fill="${INK}"/>
  <rect x="174" y="18" width="152" height="38" fill="${POP.yellow}" stroke="${INK}" stroke-width="6"/>
  <text x="250" y="44" text-anchor="middle" font-family="'Courier New', monospace" font-weight="900" font-size="20" fill="${INK}">${levelLabel}</text>
  ${isDuo ? `<rect x="196" y="66" width="108" height="24" fill="${POP.mint}" stroke="${INK}" stroke-width="4"/><text x="250" y="83" text-anchor="middle" font-family="'Courier New', monospace" font-weight="900" font-size="13" fill="${INK}">CO-OP DUO</text>` : ""}

  <!-- class ribbon -->
  <rect x="44" y="${ribbonY + 6}" width="432" height="${ribbonH}" fill="${INK}"/>
  <rect x="38" y="${ribbonY}" width="432" height="${ribbonH}" fill="${POP.yellow}" stroke="${INK}" stroke-width="7"/>
  <text x="254" y="${safeLine2 ? ribbonY + 42 : ribbonY + 46}" text-anchor="middle" font-family="'Arial Black', Impact, sans-serif" font-weight="900" font-size="23" fill="${INK}">${safeLine1}</text>
  ${safeLine2 ? `<text x="254" y="${ribbonY + 78}" text-anchor="middle" font-family="'Arial Black', Impact, sans-serif" font-weight="900" font-size="23" fill="${INK}">${safeLine2}</text>` : ""}
</svg>`;
}

export function buildRetroCharacterBadgeDataUrl(analysis: VibeAnalysisResult, vibeMode: VibeMode): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildRetroCharacterBadgeSvg(analysis, vibeMode))}`;
}
```

### 12. `src/components/CameraBooth.tsx`

_523 lines_

```tsx
import {
  Camera,
  Check,
  ExternalLink,
  ImageUp,
  Play,
  RefreshCw,
  Shuffle,
  Sparkles,
  Upload,
  Users,
  VideoOff,
  Zap,
} from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { useCameraStream } from "../hooks/useCameraStream";
import {
  type CaptureTab,
  type GenerationStage,
  RETRO_LOADING_MESSAGES,
  VIBE_MODE_OPTIONS,
  type VibeMode,
} from "../types/vibe";
import { captureVideoFrame, fileToBase64 } from "../utils/imageUtils";
import { RetroWindow } from "./RetroWindow";

interface CameraBoothProps {
  captureTab: CaptureTab;
  onChangeTab: (tab: CaptureTab) => void;
  capturedImage: string | null;
  imageLabel: string | null;
  onImageCaptured: (base64: string, label: string) => void;
  onClearImage: () => void;
  isLoadingSample: boolean;
  isDuoSample: boolean;
  onShuffleSample: () => void;
  onPickDuoSample: () => void;
  vibeMode: VibeMode;
  onSelectVibeMode: (mode: VibeMode) => void;
  stage: GenerationStage;
  retryStatusMessage?: string | null;
  errorMessage: string | null;
  onDismissError: () => void;
  onGenerateCard: () => void;
}

const TAB_BASE =
  "flex min-h-[44px] cursor-pointer items-center justify-center gap-1.5 px-2 py-2 font-display text-xs font-extrabold uppercase transition-colors sm:text-sm";
const TAB_ACTIVE = "border-2 border-[#111111] bg-[#FFD60A] text-[#111111]";
const TAB_IDLE = "border-2 border-transparent text-[#111111]/75 hover:text-[#111111]";

export function CameraBooth({
  captureTab,
  onChangeTab,
  capturedImage,
  imageLabel,
  onImageCaptured,
  onClearImage,
  isLoadingSample,
  isDuoSample,
  onShuffleSample,
  onPickDuoSample,
  vibeMode,
  onSelectVibeMode,
  stage,
  retryStatusMessage,
  errorMessage,
  onDismissError,
  onGenerateCard,
}: CameraBoothProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [snapError, setSnapError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isCompressingUpload, setIsCompressingUpload] = useState(false);
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);

  const isGenerating = stage === "analyzing" || stage === "drawing";
  const cameraActive = captureTab === "camera" && !capturedImage;
  const camera = useCameraStream(videoRef, cameraActive);

  useEffect(() => {
    if (!isGenerating) {
      setLoadingMsgIdx(0);
      return;
    }
    const timer = window.setInterval(() => {
      setLoadingMsgIdx((prev) => (prev + 1) % RETRO_LOADING_MESSAGES.length);
    }, 1800);
    return () => window.clearInterval(timer);
  }, [isGenerating]);

  const switchTab = (tab: CaptureTab) => {
    setUploadError(null);
    setSnapError(null);
    if (tab === captureTab) return;
    if (tab !== "sample") onClearImage();
    onChangeTab(tab);
  };

  const handleSnapPhoto = () => {
    if (!videoRef.current || camera.status !== "ready" || isGenerating) return;
    try {
      setSnapError(null);
      const frameDataUrl = captureVideoFrame(videoRef.current);
      camera.stop(); // webcam light off immediately
      onImageCaptured(frameDataUrl, "Camera Snapshot");
    } catch (err) {
      setSnapError(err instanceof Error ? err.message : "Could not capture camera photo.");
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || isGenerating) return;

    try {
      setUploadError(null);
      setIsCompressingUpload(true);
      const base64 = await fileToBase64(file);
      onImageCaptured(base64, file.name);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Could not load selected image.");
    } finally {
      setIsCompressingUpload(false);
    }
  };

  const progressPercent =
    stage === "analyzing" ? 45 : stage === "drawing" ? 85 : stage === "complete" ? 100 : 0;

  const cameraBlockedOrError = camera.status === "blocked" || camera.status === "error";

  return (
    <RetroWindow
      title="INPUT BOOTH"
      headerBgClass="bg-[#FF3B5C]"
      containerBgClass="bg-[#FFE4C4]"
      bodyClassName="flex flex-col gap-6 p-5 sm:p-6"
    >
      {/* STEP 1: Segmented Toggle + Single Framed Preview */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-display text-sm font-extrabold uppercase tracking-wide text-[#111111]">
            1. Add Your Photo
          </h3>
          {capturedImage && (
            <span className="font-mono-retro text-xs font-bold text-[#111111]/80">Ready</span>
          )}
        </div>

        {/* Segmented Control: Camera | Upload | Sample */}
        <div
          role="tablist"
          aria-label="Photo input source"
          className="relative z-10 grid grid-cols-3 border-[3px] border-[#111111] bg-[#FFF4D6] p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={captureTab === "camera"}
            disabled={isGenerating}
            onClick={() => switchTab("camera")}
            className={`${TAB_BASE} ${captureTab === "camera" ? TAB_ACTIVE : TAB_IDLE}`}
          >
            <Camera className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap">Camera</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={captureTab === "upload"}
            disabled={isGenerating}
            onClick={() => switchTab("upload")}
            className={`${TAB_BASE} ${captureTab === "upload" ? TAB_ACTIVE : TAB_IDLE}`}
          >
            <Upload className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap">Upload</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={captureTab === "sample"}
            disabled={isGenerating || isLoadingSample}
            onClick={() => switchTab("sample")}
            className={`${TAB_BASE} ${captureTab === "sample" ? TAB_ACTIVE : TAB_IDLE}`}
          >
            <Sparkles className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap">Sample</span>
          </button>
        </div>

        {/* Single Framed Preview Viewport */}
        <div className="relative overflow-hidden border-[3px] border-[#111111] bg-[#FFF4D6]">
          {capturedImage ? (
            <div className="relative aspect-[4/3] w-full bg-[#FFF4D6]">
              <img
                src={capturedImage}
                alt={imageLabel || "Selected photo preview"}
                className={`h-full w-full object-cover transition-opacity ${isLoadingSample ? "opacity-60" : "opacity-100"}`}
              />
              {captureTab === "sample" && isDuoSample && (
                <span className="font-mono-retro absolute top-3 left-3 z-20 border-2 border-[#111111] bg-[#2EE59D] px-2 py-0.5 text-[11px] font-bold text-[#111111]">
                  CO-OP DUO TEST
                </span>
              )}
              <div className="absolute right-3 bottom-3 left-3 z-20 flex flex-wrap items-center justify-between gap-2 border-[2.5px] border-[#111111] bg-[#FFE4C4]/95 px-3 py-2">
                <span className="font-mono-retro min-w-0 flex-1 basis-full truncate text-xs font-bold text-[#111111] sm:basis-0">
                  {imageLabel || "Photo Ready"}
                </span>
                {captureTab === "sample" ? (
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      disabled={isGenerating || isLoadingSample}
                      onClick={onPickDuoSample}
                      title="Load a two-person photo to test Co-Op Duo Mode"
                      className="retro-btn flex min-h-[40px] cursor-pointer items-center gap-1.5 bg-[#2EE59D] px-3 py-1.5 font-mono-retro text-xs font-bold text-[#111111]"
                    >
                      <Users className="h-3.5 w-3.5" />
                      <span className="whitespace-nowrap">DUO</span>
                    </button>
                    <button
                      type="button"
                      disabled={isGenerating || isLoadingSample}
                      onClick={onShuffleSample}
                      className="retro-btn flex min-h-[40px] cursor-pointer items-center gap-1.5 bg-[#00C2FF] px-3.5 py-1.5 font-mono-retro text-xs font-bold text-[#111111]"
                    >
                      <Shuffle className="h-3.5 w-3.5" />
                      <span className="whitespace-nowrap">
                        {isLoadingSample ? "SHUFFLING..." : "SHUFFLE SAMPLE"}
                      </span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={isGenerating}
                    onClick={onClearImage}
                    className="retro-btn flex min-h-[40px] shrink-0 cursor-pointer items-center gap-1.5 bg-[#FFF4D6] px-3.5 py-1.5 font-mono-retro text-xs font-bold text-[#111111]"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span className="whitespace-nowrap">
                      {captureTab === "camera" ? "Retake" : "Change"}
                    </span>
                  </button>
                )}
              </div>
            </div>
          ) : captureTab === "camera" ? (
            <div className="relative aspect-[4/3] w-full bg-[#1a1a1a]">
              {/* Mirrored preview feels natural for selfies; the snapshot is saved un-mirrored. */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`pointer-events-none h-full w-full -scale-x-100 object-cover ${
                  camera.status === "ready" ? "opacity-100" : "opacity-0"
                }`}
              />

              {(camera.status === "starting" || camera.status === "idle") && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-[#FFF4D6] p-6 text-center">
                  <p className="font-display text-base font-extrabold text-[#111111]">Starting camera...</p>
                  <p className="text-xs text-[#111111]/75">
                    Allow access when prompted, or switch to Upload or Sample above.
                  </p>
                </div>
              )}

              {camera.status === "needs-tap" && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#FFF4D6]/95 p-6 text-center">
                  <button
                    type="button"
                    onClick={camera.tapToPlay}
                    className="retro-btn flex min-h-[46px] cursor-pointer items-center gap-2 bg-[#FFD60A] px-5 py-2.5 font-display text-sm font-extrabold uppercase text-[#111111]"
                  >
                    <Play className="h-4 w-4 stroke-[2.75]" />
                    <span>Tap to start preview</span>
                  </button>
                </div>
              )}

              {camera.status === "ready" && (
                <div className="absolute right-3 bottom-3 left-3 z-20 flex flex-col items-center gap-2">
                  {snapError && (
                    <p className="border-2 border-[#111111] bg-[#FF3B5C] px-3 py-1 text-xs font-bold text-[#111111]">
                      {snapError}
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={isGenerating}
                    onClick={handleSnapPhoto}
                    className="retro-btn flex min-h-[46px] cursor-pointer items-center justify-center gap-2 bg-[#FF3B5C] px-6 py-2.5 font-display text-sm font-extrabold uppercase tracking-wide text-[#111111]"
                  >
                    <Camera className="h-4 w-4 stroke-[2.75]" />
                    <span>Snap Photo</span>
                  </button>
                </div>
              )}

              {cameraBlockedOrError && (
                <div
                  role="alert"
                  className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 overflow-y-auto bg-[#FFF4D6] p-5 text-center"
                >
                  <div
                    className={`flex h-12 w-12 shrink-0 items-center justify-center border-[3px] border-[#111111] ${
                      camera.status === "blocked" ? "bg-[#FFD60A]" : "bg-[#FF3B5C]"
                    }`}
                  >
                    <VideoOff className="h-6 w-6 text-[#111111]" />
                  </div>
                  {camera.status === "blocked" && (
                    <p className="font-mono-retro text-[11px] font-bold uppercase tracking-wider text-[#111111]/80">
                      Signal blocked
                    </p>
                  )}
                  <p className="max-w-sm text-sm font-bold leading-snug text-[#111111]">{camera.message}</p>
                  <div className="flex flex-wrap justify-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => switchTab("upload")}
                      className="retro-btn flex min-h-[44px] cursor-pointer items-center gap-1.5 bg-[#FFD60A] px-4 py-2 font-display text-xs font-extrabold uppercase text-[#111111]"
                    >
                      <ImageUp className="h-4 w-4" />
                      Use Upload
                    </button>
                    <button
                      type="button"
                      onClick={() => switchTab("sample")}
                      className="retro-btn flex min-h-[44px] cursor-pointer items-center gap-1.5 bg-[#00C2FF] px-4 py-2 font-display text-xs font-extrabold uppercase text-[#111111]"
                    >
                      <Sparkles className="h-4 w-4" />
                      Use Sample
                    </button>
                    {camera.inIframe ? (
                      <a
                        href={window.location.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="retro-btn flex min-h-[44px] cursor-pointer items-center gap-1.5 bg-[#2EE59D] px-4 py-2 font-display text-xs font-extrabold uppercase text-[#111111]"
                      >
                        <ExternalLink className="h-4 w-4" />
                        Open in New Tab
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={camera.retry}
                        className="retro-btn flex min-h-[44px] cursor-pointer items-center gap-1.5 bg-[#2EE59D] px-4 py-2 font-display text-xs font-extrabold uppercase text-[#111111]"
                      >
                        <RefreshCw className="h-4 w-4" />
                        Retry
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : captureTab === "upload" ? (
            <div className="relative z-10 flex aspect-[4/3] w-full flex-col items-center justify-center gap-4 bg-[#FFF4D6] p-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center border-[3px] border-[#111111] bg-[#00C2FF]">
                <Upload className="h-7 w-7 text-[#111111]" />
              </div>
              <div>
                <p className="font-display text-base font-extrabold text-[#111111]">
                  Upload a photo from your device
                </p>
                <p className="mt-1 text-xs text-[#111111]/75">
                  Auto-resized for fast analysis (PNG, JPG, WebP)
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="sr-only"
                id="booth-file-upload"
              />
              <button
                type="button"
                disabled={isGenerating || isCompressingUpload}
                onClick={() => fileInputRef.current?.click()}
                className="retro-btn min-h-[46px] cursor-pointer bg-[#FFD60A] px-6 py-2.5 font-display text-sm font-extrabold uppercase text-[#111111]"
              >
                {isCompressingUpload ? "Optimizing..." : "Choose Photo"}
              </button>
              {uploadError && (
                <p className="border-2 border-[#111111] bg-[#FF3B5C] px-3 py-1.5 text-xs font-bold text-[#111111]">
                  {uploadError}
                </p>
              )}
            </div>
          ) : (
            <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 bg-[#FFF4D6] p-6 text-center">
              <Sparkles className="h-7 w-7 animate-pulse text-[#111111]" />
              <p className="font-display text-base font-extrabold text-[#111111]">
                {isLoadingSample ? "Loading fresh sample portrait..." : "Sample portrait ready"}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* STEP 2: Three Spacious Mode Pills with Concise 2-Word Labels */}
      <div className="space-y-3">
        <h3 className="font-display text-sm font-extrabold uppercase tracking-wide text-[#111111]">
          2. Pick Vibe Mode
        </h3>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {VIBE_MODE_OPTIONS.map((option) => {
            const isSelected = vibeMode === option.id;
            return (
              <button
                key={option.id}
                type="button"
                disabled={isGenerating}
                onClick={() => onSelectVibeMode(option.id)}
                aria-pressed={isSelected}
                className={`retro-btn flex min-h-[64px] cursor-pointer flex-col items-start justify-center gap-0.5 px-4 py-3 text-left ${
                  isSelected ? option.activeBgClass : "bg-[#FFF4D6] hover:bg-[#FFEBB3]"
                }`}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="font-display text-sm font-extrabold uppercase text-[#111111]">
                    {option.label}
                  </span>
                  {isSelected && <Check className="h-4 w-4 shrink-0 stroke-[3] text-[#111111]" />}
                </div>
                <span className="font-mono-retro text-xs font-medium text-[#111111]/80">
                  {option.shortTag}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Inline Progress Feedback */}
      {isGenerating && (
        <div role="status" aria-live="polite" className="border-[3px] border-[#111111] bg-[#FFF4D6] p-4">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="font-display text-sm font-extrabold text-[#111111]">
              {stage === "drawing"
                ? "Card unlocked! Sketching your doodle..."
                : RETRO_LOADING_MESSAGES[loadingMsgIdx]}
            </span>
            <span className="font-mono-retro text-xs font-bold tabular-nums text-[#111111]">
              {progressPercent}%
            </span>
          </div>
          <div className="h-4 w-full overflow-hidden border-2 border-[#111111] bg-[#D9F9FF]">
            <div
              className="h-full border-r-2 border-[#111111] bg-[#2EE59D] transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          {retryStatusMessage && (
            <p className="mt-2 font-mono-retro text-xs font-bold text-[#111111]/85">{retryStatusMessage}</p>
          )}
        </div>
      )}

      {/* Quirky Retro Alert Banner with 1-Click TRY AGAIN */}
      {errorMessage && (
        <div role="alert" className="flex flex-col gap-3 border-[3px] border-[#111111] bg-[#FF3B5C] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono-retro text-xs font-bold uppercase text-[#111111]">WHOA! PIXEL JAM!</p>
              <p className="mt-1 text-xs font-bold leading-snug text-[#111111] sm:text-sm">{errorMessage}</p>
            </div>
            <button
              type="button"
              onClick={onDismissError}
              className="min-h-[36px] shrink-0 cursor-pointer border-2 border-[#111111] bg-[#FFF4D6] px-2.5 py-1 font-mono-retro text-xs font-bold text-[#111111]"
            >
              DISMISS
            </button>
          </div>
          {capturedImage && (
            <button
              type="button"
              disabled={isGenerating}
              onClick={onGenerateCard}
              className="retro-btn flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 bg-[#FFD60A] px-4 py-2 font-display text-sm font-extrabold uppercase text-[#111111]"
            >
              <RefreshCw className="h-4 w-4 stroke-[2.75]" />
              <span>TRY AGAIN</span>
            </button>
          )}
        </div>
      )}

      {/* STEP 3: Fitts's Law Large High-Contrast Primary CTA */}
      <div className="pt-1">
        <button
          type="button"
          disabled={!capturedImage || isGenerating || isCompressingUpload || isLoadingSample}
          onClick={onGenerateCard}
          className="retro-btn flex min-h-[58px] w-full cursor-pointer items-center justify-center gap-2.5 bg-[#FFD60A] px-6 py-4 font-display text-base font-extrabold uppercase tracking-wide text-[#111111] sm:text-lg"
        >
          <Zap className="h-5 w-5 shrink-0 stroke-[2.75]" />
          <span>
            {stage === "analyzing"
              ? "READING YOUR VIBE..."
              : stage === "drawing"
                ? "INKING DOODLE..."
                : "GENERATE MY VIBE CARD"}
          </span>
        </button>
      </div>
    </RetroWindow>
  );
}
```

### 13. `src/components/VibeCardPanel.tsx`

_530 lines_

```tsx
import {
  ArrowLeft,
  ArrowUp,
  Download,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Shield,
  Square,
  Volume2,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type GenerationStage,
  RETRO_LOADING_MESSAGES,
  type VibeAnalysisResult,
  type VibeMode,
} from "../types/vibe";
import { exportTradingCardPng } from "../utils/cardExporter";
import { buildRetroCharacterBadgeDataUrl } from "../utils/retroBadgeSvg";
import { DoodlePlaceholderArt } from "./PixelIcons";
import { RetroWindow } from "./RetroWindow";

interface VibeCardPanelProps {
  stage: GenerationStage;
  vibeMode: VibeMode;
  analysisResult: VibeAnalysisResult | null;
  doodleImageUrl: string | null;
  isFallbackBadge?: boolean;
  retryStatusMessage?: string | null;
  onReset: () => void;
  onRetryDoodle?: () => void;
}

interface StatRowProps {
  label: string;
  value: number | null;
  fillClass: string;
}

function StatBarRow({ label, value, fillClass }: StatRowProps) {
  const safeVal = value !== null ? Math.max(0, Math.min(100, value)) : 0;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-mono-retro text-xs font-bold uppercase text-[#111111]">
          {label}
        </span>
        <span className="font-mono-retro text-xs font-bold tabular-nums text-[#111111]">
          {value !== null ? `${safeVal}/100` : "--/100"}
        </span>
      </div>
      <div className="h-4 w-full overflow-hidden border-[2.5px] border-[#111111] bg-[#FFE4C4]">
        <div
          className={`h-full border-r-[2.5px] border-[#111111] transition-all duration-300 ${fillClass}`}
          style={{ width: `${safeVal}%` }}
        />
      </div>
    </div>
  );
}

function pickBestSpeechVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const pool = english.length ? english : voices;
  const preferred = pool.find((v) =>
    /google|natural|aria|jenny|samantha|daniel|alex/i.test(v.name)
  );
  return preferred ?? pool[0] ?? null;
}

export function VibeCardPanel({
  stage,
  vibeMode,
  analysisResult,
  doodleImageUrl,
  isFallbackBadge = false,
  retryStatusMessage = null,
  onReset,
  onRetryDoodle,
}: VibeCardPanelProps) {
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [msgIdx, setMsgIdx] = useState(0);

  const [audioState, setAudioState] = useState<"idle" | "loading" | "playing">("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cachedAudioUrlRef = useRef<string | null>(null);
  const speechActiveRef = useRef(false);
  const audioRequestIdRef = useRef(0);

  const stopAudioPlayback = useCallback(() => {
    audioRequestIdRef.current += 1;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if (speechActiveRef.current && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      speechActiveRef.current = false;
    }
    setAudioState("idle");
  }, []);

  useEffect(() => {
    setImageLoadFailed(false);
    setExportError(null);
    cachedAudioUrlRef.current = null;
    stopAudioPlayback();
  }, [doodleImageUrl, analysisResult?.vibeRoast, stopAudioPlayback]);

  useEffect(() => {
    return () => {
      stopAudioPlayback();
    };
  }, [stopAudioPlayback]);

  const isGenerating = stage === "analyzing" || stage === "drawing";
  const hasAnalysis = Boolean(analysisResult);

  const fallbackBadgeUrl = useMemo(() => {
    if (!analysisResult) return null;
    return buildRetroCharacterBadgeDataUrl(analysisResult, vibeMode);
  }, [analysisResult, vibeMode]);

  const effectiveAvatarUrl =
    imageLoadFailed && fallbackBadgeUrl ? fallbackBadgeUrl : doodleImageUrl;
  const usingBadgeArt = isFallbackBadge || (imageLoadFailed && Boolean(fallbackBadgeUrl));
  const canDownloadCard = Boolean(analysisResult && effectiveAvatarUrl && !isGenerating);

  useEffect(() => {
    if (!isGenerating) {
      setMsgIdx(0);
      return;
    }
    const id = window.setInterval(() => {
      setMsgIdx((prev) => (prev + 1) % RETRO_LOADING_MESSAGES.length);
    }, 1800);
    return () => window.clearInterval(id);
  }, [isGenerating]);

  const playWithBrowserSpeech = useCallback(
    (text: string, requestId: number) => {
      if (
        typeof window === "undefined" ||
        !("speechSynthesis" in window) ||
        audioRequestIdRef.current !== requestId
      ) {
        setAudioState("idle");
        return;
      }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = pickBestSpeechVoice(window.speechSynthesis.getVoices());
      if (voice) utterance.voice = voice;
      utterance.rate = vibeMode === "roast" ? 1.06 : vibeMode === "cyberpunk" ? 0.98 : 1.03;
      utterance.pitch = vibeMode === "cyberpunk" ? 0.9 : 1.08;

      utterance.onend = () => {
        speechActiveRef.current = false;
        if (audioRequestIdRef.current === requestId) {
          setAudioState("idle");
        }
      };
      utterance.onerror = () => {
        speechActiveRef.current = false;
        if (audioRequestIdRef.current === requestId) {
          setAudioState("idle");
        }
      };

      speechActiveRef.current = true;
      setAudioState("playing");
      window.speechSynthesis.speak(utterance);
    },
    [vibeMode]
  );

  const playAudioUrl = useCallback(
    (audioUrl: string, fallbackText: string, requestId: number) => {
      if (audioRequestIdRef.current !== requestId) return;

      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onended = () => {
        if (audioRequestIdRef.current === requestId) {
          audioRef.current = null;
          setAudioState("idle");
        }
      };

      audio.onerror = () => {
        if (audioRequestIdRef.current === requestId) {
          audioRef.current = null;
          playWithBrowserSpeech(fallbackText, requestId);
        }
      };

      setAudioState("playing");
      audio.play().catch(() => {
        if (audioRequestIdRef.current === requestId) {
          audioRef.current = null;
          playWithBrowserSpeech(fallbackText, requestId);
        }
      });
    },
    [playWithBrowserSpeech]
  );

  const handleToggleHearVibe = async () => {
    if (!analysisResult) return;

    if (audioState === "playing" || audioState === "loading") {
      stopAudioPlayback();
      return;
    }

    const requestId = ++audioRequestIdRef.current;
    const fallbackText = `${analysisResult.characterClass}! ${analysisResult.vibeRoast}`;

    if (cachedAudioUrlRef.current) {
      playAudioUrl(cachedAudioUrlRef.current, fallbackText, requestId);
      return;
    }

    setAudioState("loading");
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch("/api/speak-vibe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterClass: analysisResult.characterClass,
          vibeRoast: analysisResult.vibeRoast,
          vibeMode,
        }),
        signal: controller.signal,
      });

      const data = await response.json().catch(() => null);
      if (audioRequestIdRef.current !== requestId) return;

      if (!response.ok || !data?.audioDataUrl) {
        throw new Error("TTS unavailable");
      }

      cachedAudioUrlRef.current = data.audioDataUrl;
      playAudioUrl(data.audioDataUrl, fallbackText, requestId);
    } catch {
      if (audioRequestIdRef.current === requestId) {
        playWithBrowserSpeech(fallbackText, requestId);
      }
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const handleDownloadCard = async () => {
    if (!analysisResult || !effectiveAvatarUrl || isExporting) return;
    setExportError(null);
    setIsExporting(true);
    try {
      await exportTradingCardPng({
        analysis: analysisResult,
        doodleImageUrl: effectiveAvatarUrl,
        vibeMode,
      });
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : "Failed to export trading card PNG."
      );
    } finally {
      setIsExporting(false);
    }
  };

  const headerDuoBadge =
    analysisResult?.isDuo ? (
      <span className="font-mono-retro whitespace-nowrap border-2 border-[#111111] bg-[#2EE59D] px-2.5 py-0.5 text-[11px] font-bold tabular-nums text-[#111111]">
        CO-OP DUO • {analysisResult.synergyScore ?? 88}% SYNERGY
      </span>
    ) : undefined;

  return (
    <RetroWindow
      title="VIBE CARD STUDIO"
      headerBgClass="bg-[#FFD60A]"
      containerBgClass="bg-[#D9F9FF]"
      rightSlot={headerDuoBadge}
      bodyClassName="flex flex-col justify-between gap-5 p-5 sm:p-6"
    >
      {/* Framed Retro Doodle Viewport — consistent height for zero layout shift */}
      <div
        className={`relative overflow-hidden border-[3px] border-[#111111] bg-[#FFE4C4] p-3 ${
          hasAnalysis ? "holo-card-overlay" : ""
        }`}
      >
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="holo-sheen font-mono-retro border-2 border-[#111111] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[#111111]">
              HOLO-VIBE
            </span>
            {usingBadgeArt && effectiveAvatarUrl && (
              <span className="font-mono-retro border-2 border-[#111111] bg-[#FFD60A] px-2 py-0.5 text-[10px] font-bold uppercase text-[#111111]">
                SVG COMIC
              </span>
            )}
          </div>
          <span className="font-mono-retro text-xs font-bold uppercase text-[#111111]/80">
            {vibeMode}
          </span>
        </div>

        <div className="flex aspect-square max-h-[290px] w-full items-center justify-center overflow-hidden border-[3px] border-[#111111] bg-[#FFF8E7] p-3">
          {effectiveAvatarUrl ? (
            <img
              src={effectiveAvatarUrl}
              alt={`${analysisResult?.characterClass ?? "Retro"} 90s cartoon doodle avatar`}
              referrerPolicy="no-referrer"
              onError={() => {
                if (!imageLoadFailed) setImageLoadFailed(true);
              }}
              className="h-full w-full object-contain"
            />
          ) : stage === "drawing" && analysisResult ? (
            <div className="flex flex-col items-center justify-center gap-3.5 p-3 text-center">
              <div className="relative flex h-16 w-16 items-center justify-center border-[3px] border-[#111111] bg-[#FFD60A] shadow-[3px_3px_0px_#111111]">
                <Pencil className="h-7 w-7 animate-bounce stroke-[2.5] text-[#111111]" />
              </div>
              <div>
                <p className="font-display text-base font-extrabold text-[#111111]">
                  Sketching your doodle...
                </p>
                <p className="mt-1 font-mono-retro text-xs font-bold text-[#111111]/75">
                  {retryStatusMessage || "Card stats unlocked! Inking comic portrait..."}
                </p>
              </div>
              <div className="flex items-center gap-1.5" aria-hidden="true">
                <span className="h-2.5 w-6 animate-pulse border-2 border-[#111111] bg-[#00C2FF]" />
                <span className="h-2.5 w-10 animate-pulse border-2 border-[#111111] bg-[#FF3B5C]" />
                <span className="h-2.5 w-6 animate-pulse border-2 border-[#111111] bg-[#2EE59D]" />
              </div>
            </div>
          ) : isGenerating ? (
            <div className="flex flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-14 w-14 items-center justify-center border-[3px] border-[#111111] bg-[#00C2FF]">
                <Zap className="h-7 w-7 animate-bounce text-[#111111]" />
              </div>
              <div>
                <p className="font-display text-base font-extrabold text-[#111111]">
                  {RETRO_LOADING_MESSAGES[msgIdx]}
                </p>
                <p className="mt-1 font-mono-retro text-xs text-[#111111]/75">
                  {retryStatusMessage || "Step 1 of 2 · Reading pose & style"}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 p-2 text-center">
              <div className="animate-retro-float">
                <DoodlePlaceholderArt className="h-24 w-24" />
              </div>
              <span className="border-2 border-[#111111] bg-[#FFD60A] px-3 py-1 font-mono-retro text-xs font-bold uppercase tracking-wider text-[#111111]">
                AWAITING SUBJECT...
              </span>
              <div className="flex items-center justify-center gap-2 text-xs font-bold text-[#111111]/85">
                <ArrowLeft className="hidden h-4 w-4 shrink-0 stroke-[3] text-[#FF3B5C] lg:block" />
                <ArrowUp className="h-4 w-4 shrink-0 stroke-[3] text-[#FF3B5C] lg:hidden" />
                <span>Add your photo in Input Booth to mint your card</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* RPG Class, Commentary, Stats & Superpower */}
      <div className="space-y-4">
        <div className="border-[3px] border-[#111111] bg-[#00C2FF] px-4 py-3">
          <p className="font-mono-retro text-[11px] font-bold uppercase text-[#111111]/85">
            {analysisResult?.isDuo ? "Tag-Team Character Class" : "Character Class"}
          </p>
          <h3 className="font-display mt-0.5 text-lg font-extrabold leading-tight text-[#111111]">
            {analysisResult
              ? analysisResult.characterClass
              : "DevFest Challenger"}
          </h3>
        </div>

        <div className="border-[3px] border-[#111111] bg-[#FFF4D6] px-4 py-3">
          <p className="font-mono-retro mb-1 text-[11px] font-bold uppercase text-[#111111]/75">
            Vibe Readout
          </p>
          <p className="text-sm font-medium leading-relaxed text-[#111111]">
            {analysisResult
              ? analysisResult.vibeRoast
              : "Your personalized 2-sentence vibe readout will appear here once your card is generated."}
          </p>
        </div>

        <div className="space-y-3 border-[3px] border-[#111111] bg-[#FFF4D6] p-4">
          <StatBarRow
            label="Debugging"
            value={analysisResult?.stats.debugging ?? null}
            fillClass="bg-[#00C2FF]"
          />
          <StatBarRow
            label="Caffeine Tolerance"
            value={analysisResult?.stats.caffeineTolerance ?? null}
            fillClass="bg-[#FFD60A]"
          />
          <StatBarRow
            label="Pure Vibes"
            value={analysisResult?.stats.pureVibes ?? null}
            fillClass="bg-[#2EE59D]"
          />
        </div>

        <div className="flex items-start gap-3 border-[3px] border-[#111111] bg-[#FFE4C4] p-3.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center border-2 border-[#111111] bg-[#FF3B5C]">
            <Shield className="h-4 w-4 stroke-[2.5] text-[#111111]" />
          </div>
          <div className="min-w-0">
            <p className="font-mono-retro text-[11px] font-bold uppercase text-[#111111]/80">
              Signature Superpower
            </p>
            <p className="font-display mt-0.5 text-sm font-extrabold leading-snug text-[#111111]">
              {analysisResult
                ? analysisResult.superpower
                : "Awaiting calibration..."}
            </p>
          </div>
        </div>
      </div>

      {usingBadgeArt && stage === "complete" && onRetryDoodle && (
        <button
          type="button"
          onClick={onRetryDoodle}
          className="retro-btn flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 bg-[#00C2FF] px-4 py-2 font-display text-xs font-extrabold uppercase text-[#111111] sm:text-sm"
        >
          <RefreshCw className="h-4 w-4 shrink-0 stroke-[2.75]" />
          <span className="whitespace-nowrap">REDRAW AI DOODLE</span>
        </button>
      )}

      {exportError && (
        <p className="border-2 border-[#111111] bg-[#FF3B5C] px-3 py-1.5 text-xs font-bold text-[#111111]">
          {exportError}
        </p>
      )}

      {/* Cleanly Aligned Card Footer Actions */}
      <div className="relative z-10 space-y-3 pt-1">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={!hasAnalysis}
            onClick={handleToggleHearVibe}
            className={`retro-btn flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 px-4 py-2.5 font-display text-xs font-extrabold uppercase text-[#111111] sm:text-sm ${
              audioState === "playing" ? "bg-[#FF3B5C]" : "bg-[#FFD60A]"
            }`}
          >
            {audioState === "loading" ? (
              <>
                <Loader2 className="h-4 w-4 shrink-0 animate-spin stroke-[2.75]" />
                <span className="whitespace-nowrap">TUNING VOICE...</span>
              </>
            ) : audioState === "playing" ? (
              <>
                <Square className="h-3.5 w-3.5 shrink-0 fill-[#111111] stroke-[2.5]" />
                <span className="whitespace-nowrap">STOP AUDIO</span>
                <span className="flex items-end gap-0.5" aria-hidden="true">
                  <span className="h-2.5 w-0.5 animate-pulse bg-[#111111]" />
                  <span className="h-3.5 w-0.5 animate-pulse bg-[#111111]" />
                  <span className="h-2 w-0.5 animate-pulse bg-[#111111]" />
                </span>
              </>
            ) : (
              <>
                <Volume2 className="h-4 w-4 shrink-0 stroke-[2.75]" />
                <span className="whitespace-nowrap">HEAR MY VIBE</span>
              </>
            )}
          </button>

          <button
            type="button"
            disabled={!canDownloadCard || isExporting}
            onClick={handleDownloadCard}
            className="retro-btn flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 bg-[#2EE59D] px-3 py-2.5 font-display text-xs font-extrabold uppercase text-[#111111] sm:text-sm"
          >
            <Download className="h-4 w-4 shrink-0 stroke-[2.75]" />
            <span className="whitespace-nowrap">
              {isExporting
                ? "EXPORTING..."
                : stage === "drawing"
                  ? "SKETCHING..."
                  : "DOWNLOAD CARD (PNG)"}
            </span>
          </button>
        </div>

        <button
          type="button"
          disabled={stage === "analyzing" || isExporting}
          onClick={() => {
            stopAudioPlayback();
            setImageLoadFailed(false);
            setExportError(null);
            onReset();
          }}
          className="retro-btn flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 bg-[#FFE4C4] px-4 py-2 font-display text-xs font-extrabold uppercase text-[#111111] sm:text-sm"
        >
          <RotateCcw className="h-4 w-4 shrink-0 stroke-[2.75]" />
          <span className="whitespace-nowrap">START OVER</span>
        </button>
      </div>
    </RetroWindow>
  );
}
```

### 14. `src/App.tsx`

_297 lines_

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { CameraBooth } from "./components/CameraBooth";
import { TopOsBar } from "./components/TopOsBar";
import { VibeCardPanel } from "./components/VibeCardPanel";
import {
  createSampleShuffler,
  nextDuoIndex,
  SAMPLE_PRESETS,
} from "./data/samplePresets";
import type {
  CaptureTab,
  GenerationStage,
  VibeAnalysisResult,
  VibeMode,
} from "./types/vibe";
import {
  CLIENT_REQUEST_TIMEOUT_MS,
  isAbortError,
  postNdjsonWithRetry,
  warmUpServer,
} from "./utils/apiClient";
import { urlToBase64 } from "./utils/imageUtils";
import { buildRetroCharacterBadgeDataUrl } from "./utils/retroBadgeSvg";

/** Server budget is 60s per request; client adds 5s grace (see apiClient). */
const ANALYZE_TIMEOUT_MS = CLIENT_REQUEST_TIMEOUT_MS;
const DOODLE_TIMEOUT_MS = CLIENT_REQUEST_TIMEOUT_MS;

export default function App() {
  const [captureTab, setCaptureTab] = useState<CaptureTab>("sample");
  const [sampleIndex, setSampleIndex] = useState<number | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [imageLabel, setImageLabel] = useState<string | null>(null);
  const [vibeMode, setVibeMode] = useState<VibeMode>("wholesome");

  const [stage, setStage] = useState<GenerationStage>("idle");
  const [retryStatusMessage, setRetryStatusMessage] = useState<string | null>(null);
  const [isLoadingSample, setIsLoadingSample] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [analysisResult, setAnalysisResult] = useState<VibeAnalysisResult | null>(null);
  const [doodleImageUrl, setDoodleImageUrl] = useState<string | null>(null);
  const [isFallbackBadge, setIsFallbackBadge] = useState(false);

  const generationIdRef = useRef(0);
  const activeAbortRef = useRef<AbortController | null>(null);
  const sampleRequestIdRef = useRef(0);
  const shuffleRef = useRef(createSampleShuffler());
  const sourceImageRef = useRef<string | null>(null);

  const isAnalyzing = stage === "analyzing";
  const isDrawing = stage === "drawing";
  /** Inputs stay locked while either AI step runs; RESET/START OVER only lock during analysis. */
  const isBusy = isAnalyzing || isDrawing;

  /* ── Samples ─────────────────────────────────────────────────────────── */

  const loadSampleByIndex = useCallback(async (idx: number) => {
    const preset = SAMPLE_PRESETS[idx] ?? SAMPLE_PRESETS[0];
    const requestId = ++sampleRequestIdRef.current;
    setErrorMessage(null);
    setCaptureTab("sample");
    setIsLoadingSample(true);
    try {
      const base64 = await urlToBase64(preset.url);
      if (sampleRequestIdRef.current !== requestId) return;
      setSampleIndex(idx);
      setCapturedImage(base64);
      setImageLabel(preset.label);
    } catch (err) {
      if (sampleRequestIdRef.current !== requestId) return;
      console.error("[Sample Loader] Failed to load portrait:", err);
      setErrorMessage(err instanceof Error ? err.message : "Failed to load sample portrait.");
    } finally {
      if (sampleRequestIdRef.current === requestId) setIsLoadingSample(false);
    }
  }, []);

  // Page load: wake the server (cold start) and pre-load a random sample so the
  // very first interaction can be a single click on GENERATE.
  useEffect(() => {
    warmUpServer();
    void loadSampleByIndex(shuffleRef.current());
  }, [loadSampleByIndex]);

  const handleSelectSampleTab = async () => {
    if (isBusy || isLoadingSample) return;
    if (captureTab === "sample" && capturedImage) return;
    await loadSampleByIndex(sampleIndex ?? shuffleRef.current());
  };

  const handleShuffleSample = async () => {
    if (isBusy || isLoadingSample) return;
    await loadSampleByIndex(shuffleRef.current(sampleIndex ?? undefined));
  };

  const handlePickDuoSample = async () => {
    if (isBusy || isLoadingSample) return;
    await loadSampleByIndex(nextDuoIndex(sampleIndex ?? undefined));
  };

  /* ── Image input ─────────────────────────────────────────────────────── */

  const handleImageCaptured = (base64: string, label: string) => {
    sampleRequestIdRef.current += 1; // cancel any in-flight sample load
    setIsLoadingSample(false);
    setErrorMessage(null);
    setCapturedImage(base64);
    setImageLabel(label);
  };

  const handleClearImage = () => {
    if (isBusy) return;
    setCapturedImage(null);
    setImageLabel(null);
    setErrorMessage(null);
  };

  const handleChangeTab = (tab: CaptureTab) => {
    if (tab === "sample") {
      void handleSelectSampleTab();
      return;
    }
    sampleRequestIdRef.current += 1;
    setIsLoadingSample(false);
    setCaptureTab(tab);
  };

  /* ── Doodle (non-blocking step 2) ────────────────────────────────────── */

  const runDoodle = useCallback(
    async (analysis: VibeAnalysisResult, runId: number, controller: AbortController, mode: VibeMode) => {
      setStage("drawing");
      setRetryStatusMessage(null);
      try {
        const payload = await postNdjsonWithRetry<{ imageDataUrl: string }>(
          "/api/generate-doodle",
          {
            doodlePrompt: analysis.doodlePrompt,
            isDuo: analysis.isDuo,
            // Photo goes along as a likeness reference → far more faithful caricatures.
            imageBase64: sourceImageRef.current ?? undefined,
          },
          {
            totalBudgetMs: DOODLE_TIMEOUT_MS,
            signal: controller.signal,
            onStatus: (msg) => {
              if (generationIdRef.current === runId) setRetryStatusMessage(msg);
            },
          }
        );
        if (generationIdRef.current !== runId) return;
        if (!payload?.imageDataUrl) throw new Error("Doodle endpoint returned an empty image.");

        setDoodleImageUrl(payload.imageDataUrl);
        setIsFallbackBadge(false);
      } catch (err) {
        if (generationIdRef.current !== runId || isAbortError(err)) return;
        console.warn("[VibeCard] Doodle fell back to the SVG comic character:", err);
        setDoodleImageUrl(buildRetroCharacterBadgeDataUrl(analysis, mode));
        setIsFallbackBadge(true);
      } finally {
        if (generationIdRef.current === runId) {
          setRetryStatusMessage(null);
          setStage("complete");
        }
      }
    },
    []
  );

  /* ── Main pipeline ───────────────────────────────────────────────────── */

  const handleGenerateCard = async () => {
    if (!capturedImage || isBusy) {
      if (!capturedImage) setErrorMessage("Please add a photo in Step 1 before generating your card.");
      return;
    }

    activeAbortRef.current?.abort();
    const controller = new AbortController();
    activeAbortRef.current = controller;
    const runId = ++generationIdRef.current;
    const modeAtStart = vibeMode;
    sourceImageRef.current = capturedImage;

    setErrorMessage(null);
    setRetryStatusMessage(null);
    setAnalysisResult(null);
    setDoodleImageUrl(null);
    setIsFallbackBadge(false);
    setStage("analyzing");

    let analysis: VibeAnalysisResult;
    try {
      analysis = await postNdjsonWithRetry<VibeAnalysisResult>(
        "/api/analyze-vibe",
        { imageBase64: capturedImage, vibeMode: modeAtStart },
        {
          totalBudgetMs: ANALYZE_TIMEOUT_MS,
          signal: controller.signal,
          onStatus: (msg) => {
            if (generationIdRef.current === runId) setRetryStatusMessage(msg);
          },
        }
      );
    } catch (err) {
      if (generationIdRef.current !== runId || isAbortError(err)) return;
      console.error("[VibeCard] Analysis step failed:", err);
      setRetryStatusMessage(null);
      setStage("idle");
      setErrorMessage(err instanceof Error ? err.message : "Unknown error during vibe analysis.");
      return;
    }

    if (generationIdRef.current !== runId) return;

    // Instant card reveal: class, roast, stats & superpower render now, while
    // the doodle is drawn in the background.
    setAnalysisResult(analysis);
    void runDoodle(analysis, runId, controller, modeAtStart);
  };

  const handleRetryDoodle = () => {
    if (!analysisResult || isBusy) return;
    activeAbortRef.current?.abort();
    const controller = new AbortController();
    activeAbortRef.current = controller;
    const runId = ++generationIdRef.current;
    setDoodleImageUrl(null);
    setIsFallbackBadge(false);
    void runDoodle(analysisResult, runId, controller, vibeMode);
  };

  const handleReset = () => {
    if (isAnalyzing) return;
    activeAbortRef.current?.abort();
    generationIdRef.current += 1;
    sourceImageRef.current = null;
    setAnalysisResult(null);
    setDoodleImageUrl(null);
    setIsFallbackBadge(false);
    setRetryStatusMessage(null);
    setErrorMessage(null);
    setStage("idle");

    if (captureTab === "sample") {
      void loadSampleByIndex(shuffleRef.current(sampleIndex ?? undefined));
    } else {
      setCapturedImage(null);
      setImageLabel(null);
    }
  };

  const currentPreset = sampleIndex !== null ? SAMPLE_PRESETS[sampleIndex] : null;

  return (
    <div className="min-h-screen w-full overflow-x-hidden px-4 py-5 sm:px-6 sm:py-7">
      <div className="mx-auto flex w-full max-w-[1220px] flex-col gap-6">
        <TopOsBar onResetWorkspace={handleReset} isGenerating={isAnalyzing} />

        <main className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          <CameraBooth
            captureTab={captureTab}
            onChangeTab={handleChangeTab}
            capturedImage={capturedImage}
            imageLabel={imageLabel}
            onImageCaptured={handleImageCaptured}
            onClearImage={handleClearImage}
            isLoadingSample={isLoadingSample}
            isDuoSample={currentPreset?.kind === "duo"}
            onShuffleSample={handleShuffleSample}
            onPickDuoSample={handlePickDuoSample}
            vibeMode={vibeMode}
            onSelectVibeMode={setVibeMode}
            stage={stage}
            retryStatusMessage={retryStatusMessage}
            errorMessage={errorMessage}
            onDismissError={() => setErrorMessage(null)}
            onGenerateCard={handleGenerateCard}
          />

          <VibeCardPanel
            stage={stage}
            vibeMode={vibeMode}
            analysisResult={analysisResult}
            doodleImageUrl={doodleImageUrl}
            isFallbackBadge={isFallbackBadge}
            retryStatusMessage={retryStatusMessage}
            onReset={handleReset}
            onRetryDoodle={handleRetryDoodle}
          />
        </main>
      </div>
    </div>
  );
}
```

---

## Part 3 — Final Pre-Publish Audit Prompt

Paste everything inside the box below into Google AI Studio's chat after you've updated the files.

```text
FINAL PRE-PUBLISH AUDIT — VERIFY ONLY. Do not refactor, restyle, rename, or "improve" anything. Only touch a file if a step below explicitly says so, and tell me exactly what you changed.

STEP 1 — Delete these 6 obsolete files (and the empty folder src/assets/images/ afterwards):
- src/assets/images/demo_dev_photo_1795215098177.jpg
- src/assets/images/sample_big_laugh_1795219209733.jpg
- src/assets/images/sample_crossed_arms_1795219209668.jpg
- src/assets/images/sample_peace_sign_1795219208211.jpg
- src/assets/images/sample_sunglasses_cool_1795219210082.jpg
- src/assets/images/sample_thinking_pose_1795219209386.jpg
Then search the whole project for "assets/images" and "SAMPLE_PORTRAITS". The ONLY allowed match is the comment in vite.config.ts (leave vite.config.ts and its copy-unbundled-src-assets plugin untouched). Any other match must be reported to me, not silently rewritten.

STEP 2 — Confirm these 8 files exist with these exact names (case-sensitive):
src/assets/samples/solo-peace-sign.jpg
src/assets/samples/solo-thinking-pose.jpg
src/assets/samples/solo-big-laugh.jpg
src/assets/samples/solo-cool-sunglasses.jpg
src/assets/samples/solo-crossed-arms.jpg
src/assets/samples/solo-hackathon-windbreaker.jpg
src/assets/samples/duo-peace-and-shades.jpg
src/assets/samples/duo-smirk-and-laugh.jpg

STEP 3 — Verify every import resolves:
- src/App.tsx imports ./data/samplePresets, ./utils/apiClient, ./utils/imageUtils, ./utils/retroBadgeSvg, ./components/*, ./types/vibe
- src/components/CameraBooth.tsx imports ../hooks/useCameraStream
- src/data/samplePresets.ts imports all 8 .jpg files above
- server.ts imports from ./services/geminiService.ts: analyzeVibe, GeminiCallError, generateDoodleAvatar, getModelHealth, isGeminiConfigured, REQUEST_BUDGET_MS, speakVibeRoast, warmUpGemini, VibeMode
- No file other than server.ts imports services/geminiService.ts.
- lucide-react icons used in CameraBooth.tsx exist: Camera, Check, ExternalLink, ImageUp, Play, RefreshCw, Shuffle, Sparkles, Upload, Users, VideoOff, Zap.

STEP 4 — DO NOT CHANGE these intentional values (they are verified against ai.google.dev/models and tested):
- ANALYZE_MODEL_CHAIN = gemini-3.8-flash, gemini-3.5-flash-lite, gemini-3.6-flash, gemini-3-flash-preview
- DOODLE_MODEL_CHAIN = gemini-nano-banana-2.1, gemini-3.1-flash-image, gemini-3.1-flash-lite-image
- TTS_MODEL_CHAIN = gemini-3.8-flash-lite-tts, gemini-3.8-flash-tts
- REQUEST_BUDGET_MS = 60000 (server), CLIENT_REQUEST_TIMEOUT_MS = 65000, CLIENT_IDLE_TIMEOUT_MS = 20000, HEARTBEAT_INTERVAL_MS = 5000
- retryOptions: { attempts: 1 } on the GoogleGenAI client
- metadata.json "requestFramePermissions": ["camera"]
- package.json devDependency "esbuild": "^0.28.0"

STEP 5 — Install & compile:
1. npm install (must finish with no ERESOLVE error)
2. npm run lint  (tsc --noEmit) → must report 0 errors
3. npm run build (vite build) → must succeed; the output should list the 8 sample .jpg files under dist/assets/

STEP 6 — Runtime smoke test in the preview:
1. Open /api/health → JSON with "ok": true, "geminiConfigured": true, and models.chains listing the chains above. Report any model in models.results with "ok": false.
2. Reload the app → a random sample photo is pre-loaded on the Sample tab and GENERATE MY VIBE CARD is enabled.
3. Click GENERATE MY VIBE CARD → Character Class / Vibe Readout / Stats appear first, then the doodle replaces "Sketching your doodle...".
4. Click DUO, then GENERATE → the header shows "CO-OP DUO • XX% SYNERGY".
5. Click the Camera tab → either the live preview + Snap Photo appears, OR the message "Camera blocked in preview sandbox — works automatically on live site! Use Upload or Sample here." with Use Upload / Use Sample / Open in New Tab buttons. Either outcome is a PASS in the preview iframe.

STEP 7 — Report back as a checklist: each step PASS/FAIL, the exact tsc and vite build output summary, any file you modified (with the diff), and any model that failed the health probe. Do not deploy until I confirm.
```
