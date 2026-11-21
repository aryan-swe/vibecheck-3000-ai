import { useCallback, useEffect, useRef, useState } from "react";
import { CameraBooth } from "./components/CameraBooth";
import { TopOsBar } from "./components/TopOsBar";
import { VibeCardPanel } from "./components/VibeCardPanel";
import {
  createSampleShuffler,
  getSampleApiUrl,
  nextDuoIndex,
  SAMPLE_PRESETS,
} from "./data/samplePresets";
import type {
  CaptureTab,
  GenerationStage,
  VibeAnalysisResult,
  VibeMode,
} from "./types/vibe";
import {
  CLIENT_REQUEST_TIMEOUT_MS,
  isAbortError,
  postNdjsonWithRetry,
  warmUpServer,
} from "./utils/apiClient";
import { urlToBase64 } from "./utils/imageUtils";
import { buildRetroCharacterBadgeDataUrl } from "./utils/retroBadgeSvg";

/** Server budget is 60s per request; client adds 5s grace (see apiClient). */
const ANALYZE_TIMEOUT_MS = CLIENT_REQUEST_TIMEOUT_MS;
const DOODLE_TIMEOUT_MS = CLIENT_REQUEST_TIMEOUT_MS;

export default function App() {
  const [captureTab, setCaptureTab] = useState<CaptureTab>("sample");
  const [sampleIndex, setSampleIndex] = useState<number | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [imageLabel, setImageLabel] = useState<string | null>(null);
  const [vibeMode, setVibeMode] = useState<VibeMode>("wholesome");

  const [stage, setStage] = useState<GenerationStage>("idle");
  const [retryStatusMessage, setRetryStatusMessage] = useState<string | null>(null);
  const [isLoadingSample, setIsLoadingSample] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [analysisResult, setAnalysisResult] = useState<VibeAnalysisResult | null>(null);
  const [doodleImageUrl, setDoodleImageUrl] = useState<string | null>(null);
  const [isFallbackBadge, setIsFallbackBadge] = useState(false);

  const generationIdRef = useRef(0);
  const activeAbortRef = useRef<AbortController | null>(null);
  const sampleRequestIdRef = useRef(0);
  const shuffleRef = useRef(createSampleShuffler());
  const sourceImageRef = useRef<string | null>(null);

  const isAnalyzing = stage === "analyzing";
  const isDrawing = stage === "drawing";
  /** Inputs stay locked while either AI step runs; RESET/START OVER only lock during analysis. */
  const isBusy = isAnalyzing || isDrawing;

  /* ── Samples ─────────────────────────────────────────────────────────── */

  const loadSampleByIndex = useCallback(async (idx: number) => {
    const preset = SAMPLE_PRESETS[idx] ?? SAMPLE_PRESETS[0];
    const requestId = ++sampleRequestIdRef.current;
    setErrorMessage(null);
    setCaptureTab("sample");
    setIsLoadingSample(true);
    try {
      let base64: string;
      try {
        const res = await fetch(getSampleApiUrl(preset.id), { cache: "force-cache" });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const payload = (await res.json()) as { dataUrl?: unknown };
        if (typeof payload?.dataUrl !== "string" || !payload.dataUrl.startsWith("data:image/")) {
          throw new Error("Invalid sample payload from server.");
        }
        base64 = payload.dataUrl.startsWith("data:image/svg+xml")
          ? await urlToBase64(payload.dataUrl)
          : payload.dataUrl;
      } catch (apiErr) {
        console.warn("[Sample Loader] /api/sample failed, falling back to Vite asset:", apiErr);
        base64 = await urlToBase64(preset.url);
      }

      if (sampleRequestIdRef.current !== requestId) return;
      setSampleIndex(idx);
      setCapturedImage(base64);
      setImageLabel(preset.label);
    } catch (err) {
      if (sampleRequestIdRef.current !== requestId) return;
      console.error("[Sample Loader] Failed to load portrait:", err);
      setErrorMessage(err instanceof Error ? err.message : "Failed to load sample portrait.");
    } finally {
      if (sampleRequestIdRef.current === requestId) setIsLoadingSample(false);
    }
  }, []);

  // Page load: wake the server (cold start) and pre-load a random sample so the
  // very first interaction can be a single click on GENERATE.
  useEffect(() => {
    warmUpServer();
    void loadSampleByIndex(shuffleRef.current());
  }, [loadSampleByIndex]);

  const handleSelectSampleTab = async () => {
    if (isBusy || isLoadingSample) return;
    if (captureTab === "sample" && capturedImage) return;
    await loadSampleByIndex(sampleIndex ?? shuffleRef.current());
  };

  const handleShuffleSample = async () => {
    if (isBusy || isLoadingSample) return;
    await loadSampleByIndex(shuffleRef.current(sampleIndex ?? undefined));
  };

  const handlePickDuoSample = async () => {
    if (isBusy || isLoadingSample) return;
    await loadSampleByIndex(nextDuoIndex(sampleIndex ?? undefined));
  };

  /* ── Image input ─────────────────────────────────────────────────────── */

  const handleImageCaptured = (base64: string, label: string) => {
    sampleRequestIdRef.current += 1; // cancel any in-flight sample load
    setIsLoadingSample(false);
    setErrorMessage(null);
    setCapturedImage(base64);
    setImageLabel(label);
  };

  const handleClearImage = () => {
    if (isBusy) return;
    setCapturedImage(null);
    setImageLabel(null);
    setErrorMessage(null);
  };

  const handleChangeTab = (tab: CaptureTab) => {
    if (tab === "sample") {
      void handleSelectSampleTab();
      return;
    }
    sampleRequestIdRef.current += 1;
    setIsLoadingSample(false);
    setCaptureTab(tab);
  };

  /* ── Doodle (non-blocking step 2) ────────────────────────────────────── */

  const runDoodle = useCallback(
    async (analysis: VibeAnalysisResult, runId: number, controller: AbortController, mode: VibeMode) => {
      setStage("drawing");
      setRetryStatusMessage(null);
      try {
        const payload = await postNdjsonWithRetry<{ imageDataUrl: string }>(
          "/api/generate-doodle",
          {
            doodlePrompt: analysis.doodlePrompt,
            isDuo: analysis.isDuo,
            // Photo goes along as a likeness reference → far more faithful caricatures.
            imageBase64: sourceImageRef.current ?? undefined,
          },
          {
            totalBudgetMs: DOODLE_TIMEOUT_MS,
            signal: controller.signal,
            onStatus: (msg) => {
              if (generationIdRef.current === runId) setRetryStatusMessage(msg);
            },
          }
        );
        if (generationIdRef.current !== runId) return;
        if (!payload?.imageDataUrl) throw new Error("Doodle endpoint returned an empty image.");

        setDoodleImageUrl(payload.imageDataUrl);
        setIsFallbackBadge(false);
      } catch (err) {
        if (generationIdRef.current !== runId || isAbortError(err)) return;
        console.warn("[VibeCard] Doodle fell back to the SVG comic character:", err);
        setDoodleImageUrl(buildRetroCharacterBadgeDataUrl(analysis, mode));
        setIsFallbackBadge(true);
      } finally {
        if (generationIdRef.current === runId) {
          setRetryStatusMessage(null);
          setStage("complete");
        }
      }
    },
    []
  );

  /* ── Main pipeline ───────────────────────────────────────────────────── */

  const handleGenerateCard = async () => {
    if (!capturedImage || isBusy) {
      if (!capturedImage) setErrorMessage("Please add a photo in Step 1 before generating your card.");
      return;
    }

    activeAbortRef.current?.abort();
    const controller = new AbortController();
    activeAbortRef.current = controller;
    const runId = ++generationIdRef.current;
    const modeAtStart = vibeMode;
    sourceImageRef.current = capturedImage;

    setErrorMessage(null);
    setRetryStatusMessage(null);
    setAnalysisResult(null);
    setDoodleImageUrl(null);
    setIsFallbackBadge(false);
    setStage("analyzing");

    let analysis: VibeAnalysisResult;
    try {
      analysis = await postNdjsonWithRetry<VibeAnalysisResult>(
        "/api/analyze-vibe",
        { imageBase64: capturedImage, vibeMode: modeAtStart },
        {
          totalBudgetMs: ANALYZE_TIMEOUT_MS,
          signal: controller.signal,
          onStatus: (msg) => {
            if (generationIdRef.current === runId) setRetryStatusMessage(msg);
          },
        }
      );
    } catch (err) {
      if (generationIdRef.current !== runId || isAbortError(err)) return;
      console.error("[VibeCard] Analysis step failed:", err);
      setRetryStatusMessage(null);
      setStage("idle");
      setErrorMessage(err instanceof Error ? err.message : "Unknown error during vibe analysis.");
      return;
    }

    if (generationIdRef.current !== runId) return;

    // Instant card reveal: class, roast, stats & superpower render now, while
    // the doodle is drawn in the background.
    setAnalysisResult(analysis);
    void runDoodle(analysis, runId, controller, modeAtStart);
  };

  const handleRetryDoodle = () => {
    if (!analysisResult || isBusy) return;
    activeAbortRef.current?.abort();
    const controller = new AbortController();
    activeAbortRef.current = controller;
    const runId = ++generationIdRef.current;
    setDoodleImageUrl(null);
    setIsFallbackBadge(false);
    void runDoodle(analysisResult, runId, controller, vibeMode);
  };

  const handleReset = () => {
    if (isAnalyzing) return;
    activeAbortRef.current?.abort();
    generationIdRef.current += 1;
    sourceImageRef.current = null;
    setAnalysisResult(null);
    setDoodleImageUrl(null);
    setIsFallbackBadge(false);
    setRetryStatusMessage(null);
    setErrorMessage(null);
    setStage("idle");

    if (captureTab === "sample") {
      void loadSampleByIndex(shuffleRef.current(sampleIndex ?? undefined));
    } else {
      setCapturedImage(null);
      setImageLabel(null);
    }
  };

  const currentPreset = sampleIndex !== null ? SAMPLE_PRESETS[sampleIndex] : null;

  return (
    <div className="min-h-screen w-full overflow-x-hidden px-4 py-5 sm:px-6 sm:py-7">
      <div className="mx-auto flex w-full max-w-[1220px] flex-col gap-6">
        <TopOsBar onResetWorkspace={handleReset} isGenerating={isAnalyzing} />

        <main className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          <CameraBooth
            captureTab={captureTab}
            onChangeTab={handleChangeTab}
            capturedImage={capturedImage}
            imageLabel={imageLabel}
            onImageCaptured={handleImageCaptured}
            onClearImage={handleClearImage}
            isLoadingSample={isLoadingSample}
            isDuoSample={currentPreset?.kind === "duo"}
            onShuffleSample={handleShuffleSample}
            onPickDuoSample={handlePickDuoSample}
            vibeMode={vibeMode}
            onSelectVibeMode={setVibeMode}
            stage={stage}
            retryStatusMessage={retryStatusMessage}
            errorMessage={errorMessage}
            onDismissError={() => setErrorMessage(null)}
            onGenerateCard={handleGenerateCard}
          />

          <VibeCardPanel
            stage={stage}
            vibeMode={vibeMode}
            analysisResult={analysisResult}
            doodleImageUrl={doodleImageUrl}
            isFallbackBadge={isFallbackBadge}
            retryStatusMessage={retryStatusMessage}
            onReset={handleReset}
            onRetryDoodle={handleRetryDoodle}
          />
        </main>
      </div>
    </div>
  );
}
