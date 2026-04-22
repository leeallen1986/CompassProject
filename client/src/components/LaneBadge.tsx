/**
 * LaneBadge — single consistent PT lane badge
 * Used on project cards, This Week page, and project detail.
 * One badge per card/header only. No secondary lane pills.
 */

type Lane =
  | "portable_air"
  | "pumps"
  | "pal"
  | "bess"
  | "multi_lane_pt"
  | string
  | null
  | undefined;

const LANE_CONFIG: Record<
  string,
  { label: string; bg: string; text: string }
> = {
  portable_air: {
    label: "Portable Air",
    bg: "bg-[oklch(0.45_0.15_255)]",
    text: "text-white",
  },
  pumps: {
    label: "Pumps",
    bg: "bg-[oklch(0.45_0.13_175)]",
    text: "text-white",
  },
  pal: {
    label: "PAL",
    bg: "bg-[oklch(0.45_0.18_295)]",
    text: "text-white",
  },
  bess: {
    label: "BESS",
    bg: "bg-[oklch(0.58_0.15_70)]",
    text: "text-white",
  },
  multi_lane_pt: {
    label: "Multi-Lane PT",
    bg: "bg-[oklch(0.40_0.03_255)]",
    text: "text-white",
  },
};

interface LaneBadgeProps {
  lane: Lane;
  className?: string;
}

export function LaneBadge({ lane, className = "" }: LaneBadgeProps) {
  if (!lane) return null;

  const config = LANE_CONFIG[lane];
  if (!config) return null;

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${config.bg} ${config.text} ${className}`}
    >
      {config.label}
    </span>
  );
}

/** Returns the display label for a lane key */
export function getLaneLabel(lane: Lane): string {
  if (!lane) return "";
  return LANE_CONFIG[lane]?.label ?? lane;
}

/** Returns all lane options for filter chips */
export const LANE_OPTIONS = [
  { key: "all", label: "All Lanes" },
  { key: "portable_air", label: "Portable Air" },
  { key: "pumps", label: "Pumps" },
  { key: "pal", label: "PAL" },
  { key: "bess", label: "BESS" },
  { key: "multi_lane_pt", label: "Multi-Lane PT" },
];
