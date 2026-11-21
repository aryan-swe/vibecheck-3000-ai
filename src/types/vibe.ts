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
