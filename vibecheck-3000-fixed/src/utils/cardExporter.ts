import type { VibeAnalysisResult, VibeMode } from "../types/vibe";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith("data:")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error("Could not render doodle into trading card PNG."));
    img.src = src;
  });
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (ctx.measureText(word).width > maxWidth) {
      if (current) {
        lines.push(current);
        current = "";
      }
      lines.push(word);
      continue;
    }
    const testLine = current ? `${current} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = testLine;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawHardBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  shadowOffset = 6
) {
  if (shadowOffset > 0) {
    ctx.fillStyle = "#111111";
    ctx.fillRect(x + shadowOffset, y + shadowOffset, w, h);
  }
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#111111";
  ctx.strokeRect(x, y, w, h);
}

function triggerDownloadFromCanvas(
  canvas: HTMLCanvasElement,
  filename: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob === "function") {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Could not encode PNG image."));
            return;
          }
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.setTimeout(() => URL.revokeObjectURL(url), 5000);
          resolve();
        },
        "image/png",
        1.0
      );
      return;
    }

    const pngUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = pngUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    resolve();
  });
}

export async function exportTradingCardPng(params: {
  analysis: VibeAnalysisResult;
  doodleImageUrl: string;
  vibeMode: VibeMode;
}): Promise<void> {
  const { analysis, doodleImageUrl, vibeMode } = params;

  if (document.fonts?.ready) {
    await document.fonts.ready.catch(() => undefined);
  }

  const doodleImg = await loadImage(doodleImageUrl);

  const pixelRatio = 2;
  const width = 960;
  const cardX = 48;
  const cardY = 48;
  const cardW = width - 96;
  const innerX = cardX + 32;
  const innerW = cardW - 64;

  const measureCanvas = document.createElement("canvas");
  const mCtx = measureCanvas.getContext("2d");
  if (!mCtx) {
    throw new Error("Canvas export is unavailable in this browser.");
  }

  mCtx.font = '800 28px "Archivo", "Arial Black", sans-serif';
  const classLines = wrapTextLines(mCtx, analysis.characterClass, innerW - 44);
  const classBoxH = 52 + Math.max(1, classLines.length) * 36;

  mCtx.font = '500 21px "DM Sans", sans-serif';
  const roastLines = wrapTextLines(mCtx, analysis.vibeRoast, innerW - 44);
  const roastBoxH = 52 + Math.max(1, roastLines.length) * 29;

  mCtx.font = '800 22px "Archivo", "Arial Black", sans-serif';
  const powerLines = wrapTextLines(mCtx, analysis.superpower, innerW - 44);
  const powerBoxH = 52 + Math.max(1, powerLines.length) * 28;

  const headerH = 74;
  const frameH = 490;
  const statsBoxH = 198;
  const cardH =
    headerH +
    26 +
    frameH +
    24 +
    classBoxH +
    20 +
    roastBoxH +
    20 +
    statsBoxH +
    20 +
    powerBoxH +
    32;
  const height = cardY + cardH + 56;

  const canvas = document.createElement("canvas");
  canvas.width = width * pixelRatio;
  canvas.height = height * pixelRatio;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas export is unavailable in this browser.");
  }
  ctx.scale(pixelRatio, pixelRatio);

  // Butter-yellow halftone backdrop
  ctx.fillStyle = "#FFF099";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#E0B200";
  for (let gx = 20; gx < width; gx += 26) {
    for (let gy = 20; gy < height; gy += 26) {
      ctx.fillRect(gx, gy, 3, 3);
    }
  }

  // Outer Sky-Mint Card Frame
  drawHardBox(ctx, cardX, cardY, cardW, cardH, "#D9F9FF", 10);

  // Header bar
  ctx.fillStyle = "#FFD60A";
  ctx.fillRect(cardX, cardY, cardW, headerH);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#111111";
  ctx.strokeRect(cardX, cardY, cardW, headerH);

  ctx.fillStyle = "#111111";
  ctx.font = '800 28px "Archivo", "Arial Black", sans-serif';
  ctx.fillText("VIBECHECK 3000", cardX + 28, cardY + 47);

  // Header badge: Co-Op Duo Synergy if duo, else Auckland Edition
  const badgeText = analysis.isDuo
    ? `CO-OP DUO • ${analysis.synergyScore ?? 88}% SYNERGY`
    : "AUCKLAND EDITION";
  const badgeFill = analysis.isDuo ? "#2EE59D" : "#00C2FF";
  ctx.font = '700 17px "IBM Plex Mono", monospace';
  const edW = ctx.measureText(badgeText).width + 28;
  drawHardBox(ctx, cardX + cardW - edW - 22, cardY + 17, edW, 40, badgeFill, 0);
  ctx.fillStyle = "#111111";
  ctx.fillText(badgeText, cardX + cardW - edW - 8, cardY + 43);

  // Doodle frame area (Warm cream-peach)
  const frameY = cardY + headerH + 26;
  drawHardBox(ctx, innerX, frameY, innerW, frameH, "#FFE4C4", 0);

  // HOLO-VIBE badge
  const holoGrad = ctx.createLinearGradient(
    innerX + 18,
    frameY + 16,
    innerX + 170,
    frameY + 52
  );
  holoGrad.addColorStop(0, "#FFD60A");
  holoGrad.addColorStop(0.5, "#FF3B5C");
  holoGrad.addColorStop(1, "#00C2FF");
  ctx.fillStyle = holoGrad;
  ctx.fillRect(innerX + 18, frameY + 16, 152, 34);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#111111";
  ctx.strokeRect(innerX + 18, frameY + 16, 152, 34);
  ctx.fillStyle = "#111111";
  ctx.font = '700 17px "IBM Plex Mono", monospace';
  ctx.fillText("HOLO-VIBE", innerX + 36, frameY + 39);

  // Mode badge on right
  const modeLabel = vibeMode.toUpperCase();
  ctx.font = '700 16px "IBM Plex Mono", monospace';
  const modeW = ctx.measureText(modeLabel).width + 26;
  drawHardBox(ctx, innerX + innerW - modeW - 18, frameY + 16, modeW, 34, "#2EE59D", 0);
  ctx.fillStyle = "#111111";
  ctx.fillText(modeLabel, innerX + innerW - modeW - 5, frameY + 39);

  // Doodle Image Box
  const imgBoxSize = 404;
  const imgBoxX = innerX + (innerW - imgBoxSize) / 2;
  const imgBoxY = frameY + 66;
  drawHardBox(ctx, imgBoxX, imgBoxY, imgBoxSize, imgBoxSize, "#FFF8E7", 0);

  const padding = 14;
  const drawAvail = imgBoxSize - padding * 2;
  const imgScale = Math.min(drawAvail / doodleImg.width, drawAvail / doodleImg.height);
  const drawW = doodleImg.width * imgScale;
  const drawH = doodleImg.height * imgScale;
  ctx.drawImage(
    doodleImg,
    imgBoxX + (imgBoxSize - drawW) / 2,
    imgBoxY + (imgBoxSize - drawH) / 2,
    drawW,
    drawH
  );

  // Character Class Banner
  let cursorY = frameY + frameH + 24;
  drawHardBox(ctx, innerX, cursorY, innerW, classBoxH, "#00C2FF", 5);
  ctx.fillStyle = "#111111";
  ctx.font = '700 15px "IBM Plex Mono", monospace';
  ctx.fillText(
    analysis.isDuo ? "TAG-TEAM CHARACTER CLASS" : "CHARACTER CLASS",
    innerX + 22,
    cursorY + 29
  );
  ctx.font = '800 28px "Archivo", "Arial Black", sans-serif';
  classLines.forEach((line, idx) => {
    ctx.fillText(line, innerX + 22, cursorY + 65 + idx * 36);
  });

  // Vibe Readout Box
  cursorY += classBoxH + 20;
  drawHardBox(ctx, innerX, cursorY, innerW, roastBoxH, "#FFF4D6", 0);
  ctx.fillStyle = "#111111";
  ctx.font = '700 14px "IBM Plex Mono", monospace';
  ctx.fillText("VIBE READOUT", innerX + 22, cursorY + 28);
  ctx.font = '500 21px "DM Sans", sans-serif';
  roastLines.forEach((line, idx) => {
    ctx.fillText(line, innerX + 22, cursorY + 59 + idx * 29);
  });

  // 3 Stats Box
  cursorY += roastBoxH + 20;
  drawHardBox(ctx, innerX, cursorY, innerW, statsBoxH, "#FFF4D6", 0);
  const stats = [
    { label: "DEBUGGING", value: analysis.stats.debugging, color: "#00C2FF" },
    { label: "CAFFEINE TOLERANCE", value: analysis.stats.caffeineTolerance, color: "#FFD60A" },
    { label: "PURE VIBES", value: analysis.stats.pureVibes, color: "#2EE59D" },
  ];

  stats.forEach((stat, idx) => {
    const rowY = cursorY + 22 + idx * 57;
    ctx.fillStyle = "#111111";
    ctx.font = '700 16px "IBM Plex Mono", monospace';
    ctx.fillText(stat.label, innerX + 22, rowY + 14);
    const valStr = `${stat.value}/100`;
    const valW = ctx.measureText(valStr).width;
    ctx.fillText(valStr, innerX + innerW - valW - 22, rowY + 14);

    const barX = innerX + 22;
    const barY = rowY + 22;
    const barW = innerW - 44;
    const barH = 22;
    ctx.fillStyle = "#FFE4C4";
    ctx.fillRect(barX, barY, barW, barH);
    const fillW = Math.max(0, Math.min(1, stat.value / 100)) * barW;
    ctx.fillStyle = stat.color;
    ctx.fillRect(barX, barY, fillW, barH);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#111111";
    ctx.strokeRect(barX, barY, barW, barH);
  });

  // Superpower Box
  cursorY += statsBoxH + 20;
  drawHardBox(ctx, innerX, cursorY, innerW, powerBoxH, "#FFE4C4", 5);
  ctx.fillStyle = "#111111";
  ctx.font = '700 14px "IBM Plex Mono", monospace';
  ctx.fillText("SIGNATURE SUPERPOWER", innerX + 22, cursorY + 28);
  ctx.font = '800 22px "Archivo", "Arial Black", sans-serif';
  powerLines.forEach((line, idx) => {
    ctx.fillText(line, innerX + 22, cursorY + 59 + idx * 28);
  });

  await triggerDownloadFromCanvas(canvas, `vibecheck-3000-${vibeMode}.png`);
}
