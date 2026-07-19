export type PlatformSection =
  | "this-week"
  | "explore-projects"
  | "full-potential"
  | "account-intelligence"
  | "pursuits"
  | "pump-targets"
  | "my-style"
  | "settings"
  | "admin";

export interface PlatformNavItem {
  key: PlatformSection;
  label: string;
  href: string;
}

export const PRIMARY_PLATFORM_NAV: PlatformNavItem[] = [
  { key: "this-week", label: "This Week", href: "/" },
  { key: "explore-projects", label: "Explore Projects", href: "/dashboard" },
  { key: "full-potential", label: "Full Potential", href: "/full-potential" },
  { key: "account-intelligence", label: "Account Intelligence", href: "/account-attack" },
  { key: "pursuits", label: "Pursuits", href: "/pipeline" },
];

const PUMP_TERMS = ["pump", "dewater", "flow"];

export function hasPumpTargetAccess(
  role: string | null | undefined,
  assignedBusinessLines: string[] | null | undefined,
): boolean {
  if (role === "admin") return true;
  return (assignedBusinessLines ?? []).some(line => {
    const normalized = line.trim().toLowerCase();
    return PUMP_TERMS.some(term => normalized.includes(term));
  });
}

export function secondaryPlatformNav(
  role: string | null | undefined,
  assignedBusinessLines: string[] | null | undefined,
): PlatformNavItem[] {
  const items: PlatformNavItem[] = [];
  if (hasPumpTargetAccess(role, assignedBusinessLines)) {
    items.push({ key: "pump-targets", label: "Pump Targets", href: "/account-priors" });
  }
  items.push(
    { key: "my-style", label: "My Working Style", href: "/my-profile" },
    { key: "settings", label: "Settings", href: "/settings" },
  );
  if (role === "admin") {
    items.push({ key: "admin", label: "Admin", href: "/admin" });
  }
  return items;
}

export function platformSectionForPath(pathname: string): PlatformSection | null {
  if (pathname === "/" || pathname === "/this-week") return "this-week";
  if (pathname.startsWith("/dashboard")) return "explore-projects";
  if (pathname.startsWith("/full-potential")) return "full-potential";
  if (pathname.startsWith("/account-attack")) return "account-intelligence";
  if (pathname.startsWith("/pipeline")) return "pursuits";
  if (pathname.startsWith("/account-priors")) return "pump-targets";
  if (pathname.startsWith("/my-profile")) return "my-style";
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/admin")) return "admin";
  return null;
}
