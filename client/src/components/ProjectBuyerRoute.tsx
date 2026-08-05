import {
  AlertTriangle,
  Building2,
  ExternalLink,
  Network,
  Search,
  Target,
  Users,
} from "lucide-react";
import {
  buyerFunctionLabel,
  evidenceStateLabel,
  normaliseContractorStatus,
  safeExternalUrl,
} from "@/lib/projectBuyerRouteView";

export interface BuyerRouteDossierContact {
  contactId: number;
  name: string;
  title: string;
  organisation: {
    recordedName: string;
    evidenceState: "not_recorded";
  };
  lane: {
    value: "principal" | "contractor" | "commercial" | "technical" | "referral" | "unknown";
    basis: "inferred";
  };
  storedTrustTier: string | null;
  effectiveTrustTier: "send_ready" | "named_unverified" | "llm_inferred";
  effectivelySendReady: boolean;
  eligibilityReasons: string[];
  email: {
    value: string | null;
    state: "verified" | "unverified" | "not_available";
  };
  linkedin: {
    profileUrl: string | null;
    searchUrl: string | null;
  };
  source: {
    type: string | null;
    url: string | null;
    evidenceMeaning: "identity_discovery_not_employment_proof";
  };
  lastChecked: {
    at: Date | null;
    basis: "contact_verified_at" | "contact_enriched_at" | "record_created_at" | "not_recorded";
  };
  projectLink: {
    exactPersistedLink: true;
    relevance: "primary" | "secondary" | null;
    linkedAt: Date | null;
    externalEvidenceState: "not_recorded";
  };
  whyRelevant: {
    text: string;
    evidenceState: "inferred";
  };
}

export interface BuyerRouteDossier {
  projectId: number;
  principal: {
    organisation: string | null;
    role: "principal";
    evidenceState: "recorded_unverified" | "not_recorded";
    buyerMeaning: "referral_and_package_confirmation_not_assumed_purchaser";
  };
  projectLevelSources: Array<{
    label: string;
    url: string;
    date: string | null;
    claimBound: false;
  }>;
  packageHolders: Array<{
    organisation: string;
    organisationType: "organisation" | "joint_venture_recorded" | "unknown";
    recordedRole: string | null;
    recordedStatus: string;
    packageScope: string | null;
    evidenceState: "recorded_unverified" | "inferred" | "not_recorded";
    ingestionSources: string[];
  }>;
  likelyEquipmentBuyer: {
    organisation: null;
    functions: Array<
      "project_package_lead" | "plant_equipment_fleet" | "procurement_commercial" | "technical_site_operations"
    >;
    statement: string;
    evidenceState: "inferred";
  };
  principalValue: {
    statement: string;
    evidenceState: "inferred" | "not_recorded";
  };
  unmappedScopes: Array<{
    scope: string;
    evidenceState: "recorded_unverified" | "inferred" | "not_recorded";
    reason: string;
  }>;
  contacts: BuyerRouteDossierContact[];
  gaps: string[];
}

const evidenceClasses: Record<string, string> = {
  recorded_unverified: "bg-blue-50 text-blue-700 border-blue-200",
  inferred: "bg-amber-50 text-amber-700 border-amber-200",
  not_recorded: "bg-slate-100 text-slate-600 border-slate-200",
};

function EvidencePill({ state }: { state: string }) {
  return (
    <span className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${evidenceClasses[state] ?? evidenceClasses.not_recorded}`}>
      {evidenceStateLabel(state)}
    </span>
  );
}

export default function ProjectBuyerRoute({ dossier }: { dossier: BuyerRouteDossier }) {
  return (
    <section aria-labelledby={`buyer-route-${dossier.projectId}`} className="rounded-xl border border-navy/10 bg-navy/[0.025] p-3 sm:p-4">
      <div className="mb-3 flex items-start gap-2">
        <Network aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-gold-dark" />
        <div>
          <h4 id={`buyer-route-${dossier.projectId}`} className="text-xs font-bold uppercase tracking-wider text-gold-dark">
            Route to buyer
          </h4>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            Recorded project relationships are separated from working sales hypotheses.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Building2 aria-hidden="true" className="h-3.5 w-3.5 text-navy" />
            <h5 className="text-[10px] font-bold uppercase tracking-wider text-navy">Principal</h5>
            <EvidencePill state={dossier.principal.evidenceState} />
          </div>
          <p className="mt-1.5 text-sm font-semibold text-foreground">
            {dossier.principal.organisation ?? "Principal not recorded"}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Route for referral and package ownership confirmation; not assumed to be the equipment purchaser.
          </p>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Target aria-hidden="true" className="h-3.5 w-3.5 text-amber-700" />
            <h5 className="text-[10px] font-bold uppercase tracking-wider text-amber-800">Likely buyer functions</h5>
            <EvidencePill state={dossier.likelyEquipmentBuyer.evidenceState} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {dossier.likelyEquipmentBuyer.functions.map(value => (
              <span key={value} className="rounded bg-white px-2 py-1 text-[10px] font-medium text-amber-800 ring-1 ring-amber-200">
                {buyerFunctionLabel(value)}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-amber-900/75">
            {dossier.likelyEquipmentBuyer.statement}
          </p>
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-2 flex items-center gap-2">
          <Users aria-hidden="true" className="h-3.5 w-3.5 text-navy" />
          <h5 className="text-[10px] font-bold uppercase tracking-wider text-navy">Contractor / package records</h5>
          <span className="rounded-full bg-navy/10 px-1.5 py-0.5 text-[10px] font-bold text-navy">
            {dossier.packageHolders.length}
          </span>
        </div>
        {dossier.packageHolders.length > 0 ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {dossier.packageHolders.map((holder, index) => {
              const status = normaliseContractorStatus(holder.recordedStatus);
              return (
                <div key={`${holder.organisation}-${index}`} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-foreground">{holder.organisation}</span>
                    <EvidencePill state={holder.evidenceState} />
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Stored status: {status.label}{holder.organisationType === "joint_venture_recorded" ? " · JV recorded" : ""}
                  </p>
                  {holder.recordedRole && (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Stored relationship: {holder.recordedRole.replaceAll("_", " ")}
                    </p>
                  )}
                  {holder.packageScope && <p className="mt-1 text-[11px] leading-relaxed text-foreground/75">{holder.packageScope}</p>}
                  {holder.ingestionSources.length > 0 && (
                    <p className="mt-1.5 text-[10px] text-muted-foreground">
                      Ingestion source{holder.ingestionSources.length === 1 ? "" : "s"}: {holder.ingestionSources.join(", ")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-xs text-muted-foreground">
            No contractor or package relationship is recorded for this project.
          </p>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h5 className="text-[10px] font-bold uppercase tracking-wider text-navy">Principal value</h5>
            <EvidencePill state={dossier.principalValue.evidenceState} />
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-foreground/75">{dossier.principalValue.statement}</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Search aria-hidden="true" className="h-3.5 w-3.5 text-navy" />
            <h5 className="text-[10px] font-bold uppercase tracking-wider text-navy">Unmapped scope</h5>
          </div>
          {dossier.unmappedScopes.length > 0 ? (
            <ul className="mt-1.5 space-y-2">
              {dossier.unmappedScopes.map((item, index) => (
                <li key={`${item.scope}-${index}`} className="text-[11px] leading-relaxed text-foreground/75">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-foreground">{item.scope}</span>
                    <EvidencePill state={item.evidenceState} />
                  </div>
                  <span className="mt-0.5 block text-muted-foreground">{item.reason}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-[11px] text-muted-foreground">No unmapped package scope recorded.</p>
          )}
        </div>
      </div>

      {(dossier.gaps.length > 0 || dossier.projectLevelSources.length > 0) && (
        <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
          {dossier.gaps.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
              <h5 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-800">
                <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" /> Evidence gaps
              </h5>
              <ul className="mt-1.5 space-y-1">
                {dossier.gaps.map((gap, index) => (
                  <li key={`${gap}-${index}`} className="text-[11px] leading-relaxed text-amber-900/80">• {gap}</li>
                ))}
              </ul>
            </div>
          )}

          {dossier.projectLevelSources.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <h5 className="text-[10px] font-bold uppercase tracking-wider text-navy">Project-level sources</h5>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Context only; these links are not bound to individual claims.</p>
              <ul className="mt-1.5 space-y-1">
                {dossier.projectLevelSources.map((source, index) => {
                  const sourceUrl = safeExternalUrl(source.url);
                  return (
                    <li key={`${source.url}-${index}`}>
                      {sourceUrl ? (
                        <a
                          href={sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open project source ${source.label}`}
                          className="inline-flex items-start gap-1 text-[11px] leading-relaxed text-teal hover:text-teal-light"
                        >
                          <ExternalLink aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>{source.label}{source.date ? ` (${source.date})` : ""}</span>
                        </a>
                      ) : (
                        <span className="text-[11px] leading-relaxed text-muted-foreground">
                          {source.label} (link unavailable)
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
