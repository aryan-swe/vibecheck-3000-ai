import type { ReactNode } from "react";

interface RetroWindowProps {
  title: string;
  headerBgClass?: string;
  containerBgClass?: string;
  rightSlot?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function RetroWindow({
  title,
  headerBgClass = "bg-[#FFD60A]",
  containerBgClass = "bg-[#FFE4C4]",
  rightSlot,
  children,
  className = "",
  bodyClassName = "p-4",
}: RetroWindowProps) {
  return (
    <section
      className={`flex flex-col border-[3px] border-[#111111] retro-shadow ${containerBgClass} ${className}`}
    >
      <div
        className={`flex items-center justify-between gap-3 border-b-[3px] border-[#111111] px-5 py-3 ${headerBgClass}`}
      >
        <h2 className="font-display min-w-0 truncate text-sm font-extrabold uppercase tracking-wide text-[#111111] sm:text-base">
          {title}
        </h2>
        {rightSlot && <div className="shrink-0">{rightSlot}</div>}
      </div>
      <div className={`flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
