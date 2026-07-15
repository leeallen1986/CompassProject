import { useAuth } from "@/_core/hooks/useAuth";
import { Calculator } from "lucide-react";
import { useLocation } from "wouter";

export default function FullPotentialCommercialModelLink() {
  const { user } = useAuth();
  const [location] = useLocation();

  if (!user || user.role === "distributor" || location !== "/full-potential") return null;

  return (
    <a
      href="/full-potential/commercial-model"
      className="fixed right-4 top-44 z-40 hidden items-center gap-2 rounded-full border border-gold/40 bg-card px-3 py-2 text-xs font-bold text-navy shadow-md transition-all hover:border-gold hover:bg-gold/10 hover:shadow-lg lg:inline-flex"
      title="Open the evidence-backed Full Potential commercial-model workspace"
    >
      <Calculator className="h-4 w-4 text-gold-dark" />
      Commercial Model
    </a>
  );
}
