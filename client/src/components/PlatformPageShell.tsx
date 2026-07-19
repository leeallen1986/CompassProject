import type { ReactNode } from "react";
import PlatformNavigation from "@/components/PlatformNavigation";
import "@/platform-shell.css";

export default function PlatformPageShell({
  children,
  title,
  description,
  legacyHeader = "keep",
}: {
  children: ReactNode;
  title?: string;
  description?: string;
  legacyHeader?: "keep" | "hide" | "pursuits-toolbar";
}) {
  const legacyClass =
    legacyHeader === "hide"
      ? "platform-hide-legacy-header"
      : legacyHeader === "pursuits-toolbar"
        ? "platform-pursuits-toolbar"
        : "";

  return (
    <div className="min-h-screen bg-background">
      <PlatformNavigation />
      {(title || description) && (
        <div className="border-b border-border bg-card">
          <div className="container py-4">
            {title && <h1 className="text-xl font-bold text-navy">{title}</h1>}
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
        </div>
      )}
      <div className={`platform-page-content ${legacyClass}`}>{children}</div>
    </div>
  );
}
