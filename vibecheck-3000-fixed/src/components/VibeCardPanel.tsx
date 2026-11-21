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
