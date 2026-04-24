/**
 * ScopeBar — Part B of rep experience tightening
 * Shows current territory, lane, and view mode with three modes:
 * Strict | Balanced | Open
 * Default rep mode = Strict
 */
import { MapPin, Layers, Eye, ChevronDown } from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ScopeMode = "strict" | "balanced" | "open";

interface ScopeBarProps {
  territories: string[];
  businessLines: string[];
  mode: ScopeMode;
  onModeChange: (mode: ScopeMode) => void;
  inScopeCount: number;
  totalCount: number;
}

const modeConfig: Record<ScopeMode, { label: string; desc: string; color: string; dot: string }> = {
  strict: {
    label: "Strict",
    desc: "Only your territory + lane",
    color: "text-teal",
    dot: "bg-teal",
  },
  balanced: {
    label: "Balanced",
    desc: "Your territory + adjacent lanes",
    color: "text-gold-dark",
    dot: "bg-gold",
  },
  open: {
    label: "Open",
    desc: "All active projects",
    color: "text-slate-500",
    dot: "bg-slate-400",
  },
};

export default function ScopeBar({
  territories,
  businessLines,
  mode,
  onModeChange,
  inScopeCount,
  totalCount,
}: ScopeBarProps) {
  const cfg = modeConfig[mode];
  const territoryLabel = territories.length > 0 ? territories.join(", ") : "All territories";
  const laneLabel = businessLines.length > 0 ? businessLines.join(", ") : "All lanes";

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-navy/5 border-b border-border flex-wrap text-xs">
      {/* Territory */}
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <MapPin className="w-3.5 h-3.5 text-navy/60 shrink-0" />
        <span className="font-semibold text-navy">{territoryLabel}</span>
      </div>

      <span className="text-border">·</span>

      {/* Lane */}
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Layers className="w-3.5 h-3.5 text-navy/60 shrink-0" />
        <span className="font-semibold text-navy">{laneLabel}</span>
      </div>

      <span className="text-border">·</span>

      {/* Scope count */}
      <div className="flex items-center gap-1 text-muted-foreground">
        <Eye className="w-3.5 h-3.5 shrink-0" />
        <span>
          <span className="font-semibold text-navy">{inScopeCount}</span>
          {" "}in scope
          {mode !== "strict" && totalCount > inScopeCount && (
            <span className="text-muted-foreground"> of {totalCount}</span>
          )}
        </span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Mode switcher */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-card hover:bg-slate-50 transition-colors">
            <span className={`w-2 h-2 rounded-full ${cfg.dot} shrink-0`} />
            <span className={`font-semibold ${cfg.color}`}>{cfg.label}</span>
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {(Object.entries(modeConfig) as [ScopeMode, typeof modeConfig[ScopeMode]][]).map(([key, val]) => (
            <DropdownMenuItem
              key={key}
              onClick={() => onModeChange(key)}
              className={`flex items-start gap-2 cursor-pointer ${mode === key ? "bg-navy/5" : ""}`}
            >
              <span className={`w-2 h-2 rounded-full ${val.dot} mt-1 shrink-0`} />
              <div>
                <div className={`font-semibold ${val.color}`}>{val.label}</div>
                <div className="text-[10px] text-muted-foreground">{val.desc}</div>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
