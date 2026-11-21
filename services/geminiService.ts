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
