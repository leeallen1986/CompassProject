import { useAuth } from "@/_core/hooks/useAuth";
import { SearchCheck } from "lucide-react";
import { useLocation } from "wouter";

export default function FullPotentialDataQualityLink() {
  const { user } = useAuth();
  const [location] = useLocation();

  if (!user || location !== "/full-potential") return null;

  return (
    <a
      href="/full-potential/data-quality"
      className="fixed right-4 top-20 z-40 hidden items-center gap-2 rounded-full border border-gold/40 bg-card px-3 py-2 text-xs font-bold text-navy shadow-md transition-all hover:border-gold hover:bg-gold/10 hover:shadow-lg lg:inline-flex"
      title="Open Full Potential data-quality and coverage dashboard"
    >
      <SearchCheck className="h-4 w-4 text-gold-dark" />
      Data Quality
    </a>
  );
}
