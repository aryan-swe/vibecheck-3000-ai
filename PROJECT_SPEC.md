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
