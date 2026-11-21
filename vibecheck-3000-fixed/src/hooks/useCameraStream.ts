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
