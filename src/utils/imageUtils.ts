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
