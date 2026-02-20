/**
 * ApolloContactSearch — Search Apollo.io for contacts, reveal with 1 credit
 * Design: Nordic Industrial Precision — navy, gold, teal accents
 * 
 * Flow:
 * 1. User enters company name + optional title keywords → FREE search (obfuscated results)
 * 2. User clicks "Reveal" on a result → 1 Apollo credit → full name, email, LinkedIn
 * 3. Revealed contacts are auto-saved to the project database
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Search, Loader2, UserPlus, Mail, Linkedin, ExternalLink,
  ChevronDown, ChevronUp, Building2, Briefcase, MapPin,
  Sparkles, Eye, EyeOff, AlertCircle, CheckCircle2, Globe,
} from "lucide-react";
import { toast } from "sonner";

interface ApolloSearchPerson {
  apolloId: string;
  firstName: string;
  lastNameObfuscated: string;
  title: string;
  company: string;
  hasEmail: boolean;
  hasCity: boolean;
  hasState: boolean;
  hasCountry: boolean;
}

interface RevealedContact {
  apolloId: string;
  name: string;
  title: string;
  company: string;
  email: string | null;
  emailStatus: string | null;
  linkedinUrl: string | null;
  photoUrl: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  seniority: string | null;
  status: string;
  creditsUsed: number;
}

// Common title suggestions for Atlas Copco's target buyers
const TITLE_SUGGESTIONS = [
  "Procurement Manager",
  "Project Manager",
  "Fleet Manager",
  "Operations Manager",
  "Site Manager",
  "Maintenance Manager",
  "General Manager",
  "Engineering Manager",
  "Commercial Manager",
  "Mining Manager",
  "Plant Manager",
  "Supply Chain Manager",
];

export default function ApolloContactSearch({
  projectId,
  projectName,
  companyName,
}: {
  projectId?: number;
  projectName?: string;
  companyName?: string;
}) {
  const [isExpanded, setIsExpanded] = useState(!!companyName);
  const [company, setCompany] = useState(companyName || "");
  const [titleKeywords, setTitleKeywords] = useState("");
  const [selectedTitles, setSelectedTitles] = useState<string[]>([]);
  const [searchResults, setSearchResults] = useState<ApolloSearchPerson[]>([]);
  const [totalFound, setTotalFound] = useState(0);
  const [revealedContacts, setRevealedContacts] = useState<Map<string, RevealedContact>>(new Map());
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const utils = trpc.useUtils();

  // Apollo Search mutation (FREE — no credits)
  const searchMutation = trpc.dataPipeline.apolloSearch.useMutation({
    onSuccess: (data) => {
      setSearchResults(data.people);
      setTotalFound(data.totalFound);
      setHasSearched(true);
      if (data.people.length === 0) {
        toast.info("No contacts found", {
          description: "Try broadening your search — use fewer title filters or check the company name spelling.",
        });
      } else {
        toast.success(`Found ${data.totalFound} contacts at ${company}`, {
          description: `Showing ${data.people.length} results. Click "Reveal" to get full details (1 credit each).`,
        });
      }
    },
    onError: (err) => {
      toast.error("Apollo search failed", { description: err.message });
    },
  });

  // Apollo Reveal mutation (1 credit per contact)
  const revealMutation = trpc.dataPipeline.apolloReveal.useMutation({
    onSuccess: (data) => {
      setRevealingId(null);
      if (data.status === "enriched") {
        setRevealedContacts(prev => {
          const next = new Map(prev);
          next.set(data.apolloId!, data as RevealedContact);
          return next;
        });
        toast.success(`Revealed: ${data.name}`, {
          description: `${data.email || "No email"} • ${data.linkedinUrl ? "LinkedIn found" : "No LinkedIn"}`,
        });
        // Refresh the main contacts list
        utils.report.full.invalidate();
      } else {
        toast.warning("Could not enrich this contact", {
          description: "Apollo returned limited data. The contact may have privacy settings enabled.",
        });
      }
    },
    onError: (err) => {
      setRevealingId(null);
      toast.error("Reveal failed", { description: err.message });
    },
  });

  const handleSearch = () => {
    if (!company.trim()) {
      toast.warning("Enter a company name to search");
      return;
    }
    const titles = selectedTitles.length > 0
      ? selectedTitles
      : titleKeywords.trim()
        ? [titleKeywords.trim()]
        : undefined;

    searchMutation.mutate({
      companyName: company.trim(),
      personTitles: titles,
      organizationLocations: ["australia"],
    });
  };

  const handleReveal = (person: ApolloSearchPerson) => {
    setRevealingId(person.apolloId);
    revealMutation.mutate({
      apolloId: person.apolloId,
      firstName: person.firstName,
      lastNameObfuscated: person.lastNameObfuscated,
      title: person.title,
      company: person.company,
      projectId,
    });
  };

  const toggleTitle = (title: string) => {
    setSelectedTitles(prev =>
      prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title]
    );
  };

  const isRevealed = (apolloId: string) => revealedContacts.has(apolloId);

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#6C3CE9] to-[#4B1FD1] flex items-center justify-center">
            <Sparkles className="w-4.5 h-4.5 text-white" />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-bold text-navy">Apollo Contact Search</h3>
            <p className="text-[11px] text-muted-foreground">
              Search 275M+ contacts • Free search, 1 credit per reveal
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasSearched && (
            <span className="px-2 py-0.5 rounded-full bg-[#6C3CE9]/10 text-[#6C3CE9] text-[10px] font-bold">
              {totalFound} found • {revealedContacts.size} revealed
            </span>
          )}
          {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {/* Expanded search panel */}
      {isExpanded && (
        <div className="px-5 pb-5 border-t border-border">
          {/* Search inputs */}
          <div className="mt-4 space-y-3">
            <div className="flex gap-3 flex-wrap">
              {/* Company input */}
              <div className="relative flex-1 min-w-[220px]">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Company name (e.g. BHP, Rio Tinto, Thiess)"
                  value={company}
                  onChange={e => setCompany(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSearch()}
                  className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[#6C3CE9]/40 focus:border-[#6C3CE9]"
                />
              </div>
              {/* Title keywords input */}
              <div className="relative flex-1 min-w-[220px]">
                <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Title filter (optional, e.g. Procurement Manager)"
                  value={titleKeywords}
                  onChange={e => setTitleKeywords(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSearch()}
                  className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[#6C3CE9]/40 focus:border-[#6C3CE9]"
                />
              </div>
              {/* Search button */}
              <Button
                onClick={handleSearch}
                disabled={searchMutation.isPending || !company.trim()}
                className="bg-[#6C3CE9] hover:bg-[#5A2ED1] text-white px-5"
              >
                {searchMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Searching...</>
                ) : (
                  <><Search className="w-4 h-4 mr-2" /> Search Apollo</>
                )}
              </Button>
            </div>

            {/* Quick title filters */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mr-1">Quick titles:</span>
              {TITLE_SUGGESTIONS.map(title => (
                <button
                  key={title}
                  onClick={() => toggleTitle(title)}
                  className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                    selectedTitles.includes(title)
                      ? "bg-[#6C3CE9] text-white shadow-sm"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {title}
                </button>
              ))}
            </div>
          </div>

          {/* Results */}
          {hasSearched && (
            <div className="mt-4">
              {searchResults.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No contacts found matching your criteria</p>
                  <p className="text-xs mt-1">Try a different company name or remove title filters</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-muted-foreground">
                      Showing {searchResults.length} of {totalFound} contacts at <strong>{company}</strong>
                    </p>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <EyeOff className="w-3 h-3" />
                      Last names hidden until revealed
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-[#6C3CE9] text-white">
                          <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wider">Name</th>
                          <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wider">Title</th>
                          <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wider">Company</th>
                          <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wider">Signals</th>
                          <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wider">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {searchResults.map((person, i) => {
                          const revealed = revealedContacts.get(person.apolloId);
                          return (
                            <tr
                              key={person.apolloId}
                              className={`border-t border-border transition-colors ${
                                revealed
                                  ? "bg-emerald-50/50"
                                  : i % 2 === 0
                                    ? "bg-card"
                                    : "bg-slate-50"
                              } hover:bg-[#6C3CE9]/5`}
                            >
                              {/* Name */}
                              <td className="px-3 py-3">
                                {revealed ? (
                                  <div className="flex items-center gap-2">
                                    {revealed.photoUrl ? (
                                      <img src={revealed.photoUrl} alt="" className="w-7 h-7 rounded-full object-cover border border-border" />
                                    ) : (
                                      <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center text-[10px] font-bold text-emerald-600">
                                        {revealed.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                                      </div>
                                    )}
                                    <div>
                                      <div className="font-medium text-navy flex items-center gap-1.5">
                                        {revealed.name}
                                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                      </div>
                                      {revealed.city && (
                                        <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                                          <MapPin className="w-2.5 h-2.5" />
                                          {[revealed.city, revealed.state, revealed.country].filter(Boolean).join(", ")}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-400">
                                      {person.firstName[0]?.toUpperCase() || "?"}
                                    </div>
                                    <div>
                                      <div className="font-medium text-navy">
                                        {person.firstName}{" "}
                                        <span className="text-slate-400 italic">{person.lastNameObfuscated}</span>
                                      </div>
                                      <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                                        <EyeOff className="w-2.5 h-2.5" /> Last name hidden
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </td>

                              {/* Title */}
                              <td className="px-3 py-3 text-xs text-muted-foreground">
                                {revealed?.title || person.title || "—"}
                                {revealed?.seniority && (
                                  <span className="ml-1.5 px-1.5 py-0.5 rounded bg-navy/10 text-navy text-[9px] font-bold uppercase">
                                    {revealed.seniority}
                                  </span>
                                )}
                              </td>

                              {/* Company */}
                              <td className="px-3 py-3 text-xs">
                                {revealed?.company || person.company}
                              </td>

                              {/* Signals */}
                              <td className="px-3 py-3">
                                <div className="flex items-center gap-1.5">
                                  {revealed ? (
                                    <>
                                      {revealed.email && (
                                        <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                          revealed.emailStatus === "verified"
                                            ? "bg-emerald-100 text-emerald-700"
                                            : "bg-amber-100 text-amber-700"
                                        }`}>
                                          <Mail className="w-2.5 h-2.5" />
                                          {revealed.emailStatus === "verified" ? "Verified" : "Email"}
                                        </span>
                                      )}
                                      {revealed.linkedinUrl && (
                                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#0077B5]/10 text-[#0077B5]">
                                          <Linkedin className="w-2.5 h-2.5" /> LI
                                        </span>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      {person.hasEmail && (
                                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-slate-100 text-slate-500">
                                          <Mail className="w-2.5 h-2.5" /> Has Email
                                        </span>
                                      )}
                                      {person.hasCity && (
                                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-slate-100 text-slate-500">
                                          <MapPin className="w-2.5 h-2.5" /> Location
                                        </span>
                                      )}
                                    </>
                                  )}
                                </div>
                              </td>

                              {/* Actions */}
                              <td className="px-3 py-3">
                                {revealed ? (
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {revealed.email && (
                                      <a
                                        href={`mailto:${revealed.email}`}
                                        className="px-2 py-1 rounded text-[10px] font-semibold bg-gold/15 text-gold-dark hover:bg-gold/25 transition-colors flex items-center gap-1"
                                      >
                                        <Mail className="w-3 h-3" /> {revealed.email}
                                      </a>
                                    )}
                                    {revealed.linkedinUrl && (
                                      <a
                                        href={revealed.linkedinUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="px-2 py-1 rounded text-[10px] font-semibold bg-[#0077B5]/10 text-[#0077B5] hover:bg-[#0077B5]/20 transition-colors flex items-center gap-1"
                                      >
                                        <Linkedin className="w-3 h-3" /> Profile
                                      </a>
                                    )}
                                  </div>
                                ) : (
                                  <Button
                                    size="sm"
                                    onClick={() => handleReveal(person)}
                                    disabled={revealingId === person.apolloId}
                                    className="bg-[#6C3CE9] hover:bg-[#5A2ED1] text-white text-[10px] h-7 px-3"
                                  >
                                    {revealingId === person.apolloId ? (
                                      <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Revealing...</>
                                    ) : (
                                      <><Eye className="w-3 h-3 mr-1" /> Reveal (1 credit)</>
                                    )}
                                  </Button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Footer info */}
                  <div className="mt-3 flex items-center justify-between">
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      Search is free. Each "Reveal" uses 1 Apollo credit. Revealed contacts are saved to your database.
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-emerald-600">
                        {revealedContacts.size} revealed this session
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
