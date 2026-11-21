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
