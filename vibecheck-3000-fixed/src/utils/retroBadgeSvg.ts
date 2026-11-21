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
