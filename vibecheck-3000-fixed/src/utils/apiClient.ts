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
