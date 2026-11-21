import {
  Camera,
  Check,
  ExternalLink,
  ImageUp,
  Play,
  RefreshCw,
  Shuffle,
  Sparkles,
  Upload,
  Users,
  VideoOff,
  Zap,
} from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { useCameraStream } from "../hooks/useCameraStream";
import {
  type CaptureTab,
  type GenerationStage,
  RETRO_LOADING_MESSAGES,
  VIBE_MODE_OPTIONS,
  type VibeMode,
} from "../types/vibe";
import { captureVideoFrame, fileToBase64 } from "../utils/imageUtils";
import { RetroWindow } from "./RetroWindow";

interface CameraBoothProps {
  captureTab: CaptureTab;
  onChangeTab: (tab: CaptureTab) => void;
  capturedImage: string | null;
  imageLabel: string | null;
  onImageCaptured: (base64: string, label: string) => void;
  onClearImage: () => void;
  isLoadingSample: boolean;
  isDuoSample: boolean;
  onShuffleSample: () => void;
  onPickDuoSample: () => void;
  vibeMode: VibeMode;
  onSelectVibeMode: (mode: VibeMode) => void;
  stage: GenerationStage;
  retryStatusMessage?: string | null;
  errorMessage: string | null;
  onDismissError: () => void;
  onGenerateCard: () => void;
}

const TAB_BASE =
  "flex min-h-[44px] cursor-pointer items-center justify-center gap-1.5 px-2 py-2 font-display text-xs font-extrabold uppercase transition-colors sm:text-sm";
const TAB_ACTIVE = "border-2 border-[#111111] bg-[#FFD60A] text-[#111111]";
const TAB_IDLE = "border-2 border-transparent text-[#111111]/75 hover:text-[#111111]";

export function CameraBooth({
  captureTab,
  onChangeTab,
  capturedImage,
  imageLabel,
  onImageCaptured,
  onClearImage,
  isLoadingSample,
  isDuoSample,
  onShuffleSample,
  onPickDuoSample,
  vibeMode,
  onSelectVibeMode,
  stage,
  retryStatusMessage,
  errorMessage,
  onDismissError,
  onGenerateCard,
}: CameraBoothProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [snapError, setSnapError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isCompressingUpload, setIsCompressingUpload] = useState(false);
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);

  const isGenerating = stage === "analyzing" || stage === "drawing";
  const cameraActive = captureTab === "camera" && !capturedImage;
  const camera = useCameraStream(videoRef, cameraActive);

  useEffect(() => {
    if (!isGenerating) {
      setLoadingMsgIdx(0);
      return;
    }
    const timer = window.setInterval(() => {
      setLoadingMsgIdx((prev) => (prev + 1) % RETRO_LOADING_MESSAGES.length);
    }, 1800);
    return () => window.clearInterval(timer);
  }, [isGenerating]);

  const switchTab = (tab: CaptureTab) => {
    setUploadError(null);
    setSnapError(null);
    if (tab === captureTab) return;
    if (tab !== "sample") onClearImage();
    onChangeTab(tab);
  };

  const handleSnapPhoto = () => {
    if (!videoRef.current || camera.status !== "ready" || isGenerating) return;
    try {
      setSnapError(null);
      const frameDataUrl = captureVideoFrame(videoRef.current);
      camera.stop(); // webcam light off immediately
      onImageCaptured(frameDataUrl, "Camera Snapshot");
    } catch (err) {
      setSnapError(err instanceof Error ? err.message : "Could not capture camera photo.");
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || isGenerating) return;

    try {
      setUploadError(null);
      setIsCompressingUpload(true);
      const base64 = await fileToBase64(file);
      onImageCaptured(base64, file.name);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Could not load selected image.");
    } finally {
      setIsCompressingUpload(false);
    }
  };

  const progressPercent =
    stage === "analyzing" ? 45 : stage === "drawing" ? 85 : stage === "complete" ? 100 : 0;

  const cameraBlockedOrError = camera.status === "blocked" || camera.status === "error";

  return (
    <RetroWindow
      title="INPUT BOOTH"
      headerBgClass="bg-[#FF3B5C]"
      containerBgClass="bg-[#FFE4C4]"
      bodyClassName="flex flex-col gap-6 p-5 sm:p-6"
    >
      {/* STEP 1: Segmented Toggle + Single Framed Preview */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-display text-sm font-extrabold uppercase tracking-wide text-[#111111]">
            1. Add Your Photo
          </h3>
          {capturedImage && (
            <span className="font-mono-retro text-xs font-bold text-[#111111]/80">Ready</span>
          )}
        </div>

        {/* Segmented Control: Camera | Upload | Sample */}
        <div
          role="tablist"
          aria-label="Photo input source"
          className="relative z-10 grid grid-cols-3 border-[3px] border-[#111111] bg-[#FFF4D6] p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={captureTab === "camera"}
            disabled={isGenerating}
            onClick={() => switchTab("camera")}
            className={`${TAB_BASE} ${captureTab === "camera" ? TAB_ACTIVE : TAB_IDLE}`}
          >
            <Camera className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap">Camera</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={captureTab === "upload"}
            disabled={isGenerating}
            onClick={() => switchTab("upload")}
            className={`${TAB_BASE} ${captureTab === "upload" ? TAB_ACTIVE : TAB_IDLE}`}
          >
            <Upload className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap">Upload</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={captureTab === "sample"}
            disabled={isGenerating || isLoadingSample}
            onClick={() => switchTab("sample")}
            className={`${TAB_BASE} ${captureTab === "sample" ? TAB_ACTIVE : TAB_IDLE}`}
          >
            <Sparkles className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap">Sample</span>
          </button>
        </div>

        {/* Single Framed Preview Viewport */}
        <div className="relative overflow-hidden border-[3px] border-[#111111] bg-[#FFF4D6]">
          {capturedImage ? (
            <div className="relative aspect-[4/3] w-full bg-[#FFF4D6]">
              <img
                src={capturedImage}
                alt={imageLabel || "Selected photo preview"}
                className={`h-full w-full object-cover transition-opacity ${isLoadingSample ? "opacity-60" : "opacity-100"}`}
              />
              {captureTab === "sample" && isDuoSample && (
                <span className="font-mono-retro absolute top-3 left-3 z-20 border-2 border-[#111111] bg-[#2EE59D] px-2 py-0.5 text-[11px] font-bold text-[#111111]">
                  CO-OP DUO TEST
                </span>
              )}
              <div className="absolute right-3 bottom-3 left-3 z-20 flex flex-wrap items-center justify-between gap-2 border-[2.5px] border-[#111111] bg-[#FFE4C4]/95 px-3 py-2">
                <span className="font-mono-retro min-w-0 flex-1 basis-full truncate text-xs font-bold text-[#111111] sm:basis-0">
                  {imageLabel || "Photo Ready"}
                </span>
                {captureTab === "sample" ? (
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      disabled={isGenerating || isLoadingSample}
                      onClick={onPickDuoSample}
                      title="Load a two-person photo to test Co-Op Duo Mode"
                      className="retro-btn flex min-h-[40px] cursor-pointer items-center gap-1.5 bg-[#2EE59D] px-3 py-1.5 font-mono-retro text-xs font-bold text-[#111111]"
                    >
                      <Users className="h-3.5 w-3.5" />
                      <span className="whitespace-nowrap">DUO</span>
                    </button>
                    <button
                      type="button"
                      disabled={isGenerating || isLoadingSample}
                      onClick={onShuffleSample}
                      className="retro-btn flex min-h-[40px] cursor-pointer items-center gap-1.5 bg-[#00C2FF] px-3.5 py-1.5 font-mono-retro text-xs font-bold text-[#111111]"
                    >
                      <Shuffle className="h-3.5 w-3.5" />
                      <span className="whitespace-nowrap">
                        {isLoadingSample ? "SHUFFLING..." : "SHUFFLE SAMPLE"}
                      </span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={isGenerating}
                    onClick={onClearImage}
                    className="retro-btn flex min-h-[40px] shrink-0 cursor-pointer items-center gap-1.5 bg-[#FFF4D6] px-3.5 py-1.5 font-mono-retro text-xs font-bold text-[#111111]"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span className="whitespace-nowrap">
                      {captureTab === "camera" ? "Retake" : "Change"}
                    </span>
                  </button>
                )}
              </div>
            </div>
          ) : captureTab === "camera" ? (
            <div className="relative aspect-[4/3] w-full bg-[#1a1a1a]">
              {/* Mirrored preview feels natural for selfies; the snapshot is saved un-mirrored. */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`pointer-events-none h-full w-full -scale-x-100 object-cover ${
                  camera.status === "ready" ? "opacity-100" : "opacity-0"
                }`}
              />

              {(camera.status === "starting" || camera.status === "idle") && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-[#FFF4D6] p-6 text-center">
                  <p className="font-display text-base font-extrabold text-[#111111]">Starting camera...</p>
                  <p className="text-xs text-[#111111]/75">
                    Allow access when prompted, or switch to Upload or Sample above.
                  </p>
                </div>
              )}

              {camera.status === "needs-tap" && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#FFF4D6]/95 p-6 text-center">
                  <button
                    type="button"
                    onClick={camera.tapToPlay}
                    className="retro-btn flex min-h-[46px] cursor-pointer items-center gap-2 bg-[#FFD60A] px-5 py-2.5 font-display text-sm font-extrabold uppercase text-[#111111]"
                  >
                    <Play className="h-4 w-4 stroke-[2.75]" />
                    <span>Tap to start preview</span>
                  </button>
                </div>
              )}

              {camera.status === "ready" && (
                <div className="absolute right-3 bottom-3 left-3 z-20 flex flex-col items-center gap-2">
                  {snapError && (
                    <p className="border-2 border-[#111111] bg-[#FF3B5C] px-3 py-1 text-xs font-bold text-[#111111]">
                      {snapError}
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={isGenerating}
                    onClick={handleSnapPhoto}
                    className="retro-btn flex min-h-[46px] cursor-pointer items-center justify-center gap-2 bg-[#FF3B5C] px-6 py-2.5 font-display text-sm font-extrabold uppercase tracking-wide text-[#111111]"
                  >
                    <Camera className="h-4 w-4 stroke-[2.75]" />
                    <span>Snap Photo</span>
                  </button>
                </div>
              )}

              {cameraBlockedOrError && (
                <div
                  role="alert"
                  className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 overflow-y-auto bg-[#FFF4D6] p-5 text-center"
                >
                  <div
                    className={`flex h-12 w-12 shrink-0 items-center justify-center border-[3px] border-[#111111] ${
                      camera.status === "blocked" ? "bg-[#FFD60A]" : "bg-[#FF3B5C]"
                    }`}
                  >
                    <VideoOff className="h-6 w-6 text-[#111111]" />
                  </div>
                  {camera.status === "blocked" && (
                    <p className="font-mono-retro text-[11px] font-bold uppercase tracking-wider text-[#111111]/80">
                      Signal blocked
                    </p>
                  )}
                  <p className="max-w-sm text-sm font-bold leading-snug text-[#111111]">{camera.message}</p>
                  <div className="flex flex-wrap justify-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => switchTab("upload")}
                      className="retro-btn flex min-h-[44px] cursor-pointer items-center gap-1.5 bg-[#FFD60A] px-4 py-2 font-display text-xs font-extrabold uppercase text-[#111111]"
                    >
                      <ImageUp className="h-4 w-4" />
                      Use Upload
                    </button>
                    <button
                      type="button"
                      onClick={() => switchTab("sample")}
                      className="retro-btn flex min-h-[44px] cursor-pointer items-center gap-1.5 bg-[#00C2FF] px-4 py-2 font-display text-xs font-extrabold uppercase text-[#111111]"
                    >
                      <Sparkles className="h-4 w-4" />
                      Use Sample
                    </button>
                    {camera.inIframe ? (
                      <a
                        href={window.location.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="retro-btn flex min-h-[44px] cursor-pointer items-center gap-1.5 bg-[#2EE59D] px-4 py-2 font-display text-xs font-extrabold uppercase text-[#111111]"
                      >
                        <ExternalLink className="h-4 w-4" />
                        Open in New Tab
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={camera.retry}
                        className="retro-btn flex min-h-[44px] cursor-pointer items-center gap-1.5 bg-[#2EE59D] px-4 py-2 font-display text-xs font-extrabold uppercase text-[#111111]"
                      >
                        <RefreshCw className="h-4 w-4" />
                        Retry
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : captureTab === "upload" ? (
            <div className="relative z-10 flex aspect-[4/3] w-full flex-col items-center justify-center gap-4 bg-[#FFF4D6] p-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center border-[3px] border-[#111111] bg-[#00C2FF]">
                <Upload className="h-7 w-7 text-[#111111]" />
              </div>
              <div>
                <p className="font-display text-base font-extrabold text-[#111111]">
                  Upload a photo from your device
                </p>
                <p className="mt-1 text-xs text-[#111111]/75">
                  Auto-resized for fast analysis (PNG, JPG, WebP)
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="sr-only"
                id="booth-file-upload"
              />
              <button
                type="button"
                disabled={isGenerating || isCompressingUpload}
                onClick={() => fileInputRef.current?.click()}
                className="retro-btn min-h-[46px] cursor-pointer bg-[#FFD60A] px-6 py-2.5 font-display text-sm font-extrabold uppercase text-[#111111]"
              >
                {isCompressingUpload ? "Optimizing..." : "Choose Photo"}
              </button>
              {uploadError && (
                <p className="border-2 border-[#111111] bg-[#FF3B5C] px-3 py-1.5 text-xs font-bold text-[#111111]">
                  {uploadError}
                </p>
              )}
            </div>
          ) : (
            <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 bg-[#FFF4D6] p-6 text-center">
              <Sparkles className="h-7 w-7 animate-pulse text-[#111111]" />
              <p className="font-display text-base font-extrabold text-[#111111]">
                {isLoadingSample ? "Loading fresh sample portrait..." : "Sample portrait ready"}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* STEP 2: Three Spacious Mode Pills with Concise 2-Word Labels */}
      <div className="space-y-3">
        <h3 className="font-display text-sm font-extrabold uppercase tracking-wide text-[#111111]">
          2. Pick Vibe Mode
        </h3>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {VIBE_MODE_OPTIONS.map((option) => {
            const isSelected = vibeMode === option.id;
            return (
              <button
                key={option.id}
                type="button"
                disabled={isGenerating}
                onClick={() => onSelectVibeMode(option.id)}
                aria-pressed={isSelected}
                className={`retro-btn flex min-h-[64px] cursor-pointer flex-col items-start justify-center gap-0.5 px-4 py-3 text-left ${
                  isSelected ? option.activeBgClass : "bg-[#FFF4D6] hover:bg-[#FFEBB3]"
                }`}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="font-display text-sm font-extrabold uppercase text-[#111111]">
                    {option.label}
                  </span>
                  {isSelected && <Check className="h-4 w-4 shrink-0 stroke-[3] text-[#111111]" />}
                </div>
                <span className="font-mono-retro text-xs font-medium text-[#111111]/80">
                  {option.shortTag}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Inline Progress Feedback */}
      {isGenerating && (
        <div role="status" aria-live="polite" className="border-[3px] border-[#111111] bg-[#FFF4D6] p-4">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="font-display text-sm font-extrabold text-[#111111]">
              {stage === "drawing"
                ? "Card unlocked! Sketching your doodle..."
                : RETRO_LOADING_MESSAGES[loadingMsgIdx]}
            </span>
            <span className="font-mono-retro text-xs font-bold tabular-nums text-[#111111]">
              {progressPercent}%
            </span>
          </div>
          <div className="h-4 w-full overflow-hidden border-2 border-[#111111] bg-[#D9F9FF]">
            <div
              className="h-full border-r-2 border-[#111111] bg-[#2EE59D] transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          {retryStatusMessage && (
            <p className="mt-2 font-mono-retro text-xs font-bold text-[#111111]/85">{retryStatusMessage}</p>
          )}
        </div>
      )}

      {/* Quirky Retro Alert Banner with 1-Click TRY AGAIN */}
      {errorMessage && (
        <div role="alert" className="flex flex-col gap-3 border-[3px] border-[#111111] bg-[#FF3B5C] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono-retro text-xs font-bold uppercase text-[#111111]">WHOA! PIXEL JAM!</p>
              <p className="mt-1 text-xs font-bold leading-snug text-[#111111] sm:text-sm">{errorMessage}</p>
            </div>
            <button
              type="button"
              onClick={onDismissError}
              className="min-h-[36px] shrink-0 cursor-pointer border-2 border-[#111111] bg-[#FFF4D6] px-2.5 py-1 font-mono-retro text-xs font-bold text-[#111111]"
            >
              DISMISS
            </button>
          </div>
          {capturedImage && (
            <button
              type="button"
              disabled={isGenerating}
              onClick={onGenerateCard}
              className="retro-btn flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 bg-[#FFD60A] px-4 py-2 font-display text-sm font-extrabold uppercase text-[#111111]"
            >
              <RefreshCw className="h-4 w-4 stroke-[2.75]" />
              <span>TRY AGAIN</span>
            </button>
          )}
        </div>
      )}

      {/* STEP 3: Fitts's Law Large High-Contrast Primary CTA */}
      <div className="pt-1">
        <button
          type="button"
          disabled={!capturedImage || isGenerating || isCompressingUpload || isLoadingSample}
          onClick={onGenerateCard}
          className="retro-btn flex min-h-[58px] w-full cursor-pointer items-center justify-center gap-2.5 bg-[#FFD60A] px-6 py-4 font-display text-base font-extrabold uppercase tracking-wide text-[#111111] sm:text-lg"
        >
          <Zap className="h-5 w-5 shrink-0 stroke-[2.75]" />
          <span>
            {stage === "analyzing"
              ? "READING YOUR VIBE..."
              : stage === "drawing"
                ? "INKING DOODLE..."
                : "GENERATE MY VIBE CARD"}
          </span>
        </button>
      </div>
    </RetroWindow>
  );
}
