import { RotateCcw } from "lucide-react";
import { VibeCheckLogo } from "./PixelIcons";

interface TopOsBarProps {
  onResetWorkspace: () => void;
  isGenerating: boolean;
}

export function TopOsBar({ onResetWorkspace, isGenerating }: TopOsBarProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-[3px] border-[#111111] bg-[#00C2FF] px-4 py-3 retro-shadow sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <VibeCheckLogo className="h-11 w-11 shrink-0" />
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="font-display truncate text-xl font-extrabold tracking-tight text-[#111111] sm:text-2xl">
            VIBECHECK 3000
          </h1>
          <span className="font-mono-retro whitespace-nowrap border-2 border-[#111111] bg-[#FFD60A] px-2.5 py-0.5 text-[11px] font-bold text-[#111111]">
            AUCKLAND EDITION
          </span>
        </div>
      </div>

      <button
        type="button"
        disabled={isGenerating}
        onClick={onResetWorkspace}
        className="retro-btn flex min-h-[44px] shrink-0 cursor-pointer items-center gap-2 bg-[#FFE4C4] px-4 py-2 font-mono-retro text-xs font-bold text-[#111111] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#111111]"
      >
        <RotateCcw className="h-3.5 w-3.5 stroke-[2.5]" />
        <span className="whitespace-nowrap">RESET</span>
      </button>
    </header>
  );
}
