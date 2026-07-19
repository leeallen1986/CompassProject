import { useState, type ReactNode } from "react";
import {
  BarChart3,
  Crosshair,
  Database,
  LogOut,
  Menu,
  MoreHorizontal,
  Settings,
  Sparkles,
  Target,
  UserCircle,
  X,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  PRIMARY_PLATFORM_NAV,
  platformSectionForPath,
  secondaryPlatformNav,
  type PlatformNavItem,
  type PlatformSection,
} from "@/lib/platformNavigation";

const NAV_ICONS: Record<PlatformSection, ReactNode> = {
  "this-week": <Sparkles className="h-4 w-4" />,
  "explore-projects": <BarChart3 className="h-4 w-4" />,
  "full-potential": <Database className="h-4 w-4" />,
  "account-intelligence": <Crosshair className="h-4 w-4" />,
  pursuits: <Target className="h-4 w-4" />,
  "pump-targets": <Target className="h-4 w-4" />,
  "my-style": <UserCircle className="h-4 w-4" />,
  settings: <Settings className="h-4 w-4" />,
  admin: <Database className="h-4 w-4" />,
};

function DesktopNavItem({ item, active }: { item: PlatformNavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
        active
          ? "bg-white/10 font-semibold text-white"
          : "font-medium text-slate-300 hover:bg-white/5 hover:text-white"
      }`}
    >
      {item.label}
    </Link>
  );
}

function MenuLink({ item, active, onSelect }: {
  item: PlatformNavItem;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onSelect}
      className={`flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
        active ? "bg-white/10 font-semibold text-white" : "text-slate-300 hover:bg-white/10 hover:text-white"
      }`}
    >
      {NAV_ICONS[item.key]}
      {item.label}
    </Link>
  );
}

export default function PlatformNavigation() {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const { data: profile } = trpc.profile.get.useQuery(undefined, {
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  if (!user) return null;

  const active = platformSectionForPath(location);
  const assignedBusinessLines = (profile?.assignedBusinessLines as string[] | null | undefined) ?? [];
  const secondary = secondaryPlatformNav(user.role, assignedBusinessLines);
  const territory = ((profile?.territories as string[] | null | undefined) ?? [])[0];

  return (
    <header className="sticky top-0 z-40 h-16 border-b border-white/10 bg-navy text-white shadow-sm">
      <div className="flex h-full items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded bg-gold/20 text-sm font-bold text-gold">A</span>
          <span className="hidden text-base font-bold tracking-tight sm:block">ATLAS</span>
        </Link>

        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-1 lg:flex">
          {PRIMARY_PLATFORM_NAV.map(item => (
            <DesktopNavItem key={item.key} item={item} active={active === item.key} />
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-2 lg:flex">
          {territory && (
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-slate-300">
              {territory}
            </span>
          )}
          <div className="relative">
            <button
              type="button"
              onClick={() => setUserOpen(value => !value)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
              aria-expanded={userOpen}
            >
              <span className="max-w-36 truncate">{user.name || user.email}</span>
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {userOpen && (
              <div className="absolute right-0 top-full mt-2 w-52 overflow-hidden rounded-lg border border-white/10 bg-navy shadow-xl">
                {secondary.map(item => (
                  <MenuLink key={item.key} item={item} active={active === item.key} onSelect={() => setUserOpen(false)} />
                ))}
                <div className="border-t border-white/10" />
                <button
                  type="button"
                  onClick={() => logout()}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setMobileOpen(value => !value)}
          className="ml-auto rounded p-2 text-slate-300 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
          aria-label="Open navigation"
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="absolute left-0 right-0 top-16 max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-white/10 bg-navy shadow-xl lg:hidden">
          <div className="py-1">
            {PRIMARY_PLATFORM_NAV.map(item => (
              <MenuLink key={item.key} item={item} active={active === item.key} onSelect={() => setMobileOpen(false)} />
            ))}
            <div className="my-1 border-t border-white/10" />
            {secondary.map(item => (
              <MenuLink key={item.key} item={item} active={active === item.key} onSelect={() => setMobileOpen(false)} />
            ))}
            <button
              type="button"
              onClick={() => logout()}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
