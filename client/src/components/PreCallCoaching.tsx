/**
 * Pre-Call Coaching Panel
 *
 * Shows before a rep makes a call to a stakeholder:
 * - Opening line suggestion
 * - Talk track steps
 * - Discovery questions
 * - Objection risks with responses
 * - Relevant pain points for the segment
 * - Persona insights for the contact's role
 *
 * Triggered from project detail or contact cards.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  Phone, MessageSquare, HelpCircle, Shield, Target,
  Loader2, ChevronDown, ChevronUp, Copy, Check,
  AlertTriangle, Lightbulb, User, Zap
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface PreCallCoachingProps {
  projectId: number;
  contactId?: number;
  projectName?: string;
  contactName?: string;
  onClose?: () => void;
}

export default function PreCallCoachingPanel({
  projectId,
  contactId,
  projectName,
  contactName,
  onClose,
}: PreCallCoachingProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>("talk-track");
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const queryInput = useMemo(
    () => ({ projectId, contactId }),
    [projectId, contactId]
  );

  const { data: coaching, isLoading, error } = trpc.persona.preCallCoaching.useQuery(queryInput, {
    staleTime: 1000 * 60 * 30,
    retry: 1,
  });

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedField(null), 2000);
  };

  const toggleSection = (section: string) => {
    setExpandedSection(prev => (prev === section ? null : section));
  };

  if (isLoading) {
    return (
      <Card className="border-gold/30 bg-gold/3">
        <CardContent className="p-6 flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-gold" />
          <span className="text-sm text-muted-foreground">
            Preparing your pre-call coaching for {contactName || projectName || "this project"}...
          </span>
        </CardContent>
      </Card>
    );
  }

  if (error || !coaching) {
    return (
      <Card className="border-amber-200 bg-amber-50/50">
        <CardContent className="p-4">
          <p className="text-sm text-amber-700">Unable to generate coaching. Try again later.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-gold/30 bg-gradient-to-br from-white to-gold/3">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base font-bold text-navy flex items-center gap-2">
              <Phone className="w-4 h-4 text-gold" />
              Pre-Call Coaching
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {coaching.contactName
                ? `Calling ${coaching.contactName} (${coaching.contactTitle}) about ${coaching.projectName}`
                : `Preparing for ${coaching.projectName}`
              }
            </p>
          </div>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose} className="text-xs">
              Close
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {/* Opening Line */}
        <div className="bg-navy/5 rounded-lg p-3 border border-navy/10">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold text-navy uppercase tracking-wider flex items-center gap-1.5">
              <MessageSquare className="w-3 h-3" /> Opening Line
            </span>
            <button
              onClick={() => copyToClipboard(coaching.openingLine, "opening")}
              className="text-[10px] text-muted-foreground hover:text-navy flex items-center gap-1"
            >
              {copiedField === "opening" ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
              Copy
            </button>
          </div>
          <p className="text-sm text-foreground/80 italic leading-relaxed">{coaching.openingLine}</p>
        </div>

        {/* Talk Track */}
        <CollapsibleSection
          title="Talk Track"
          icon={<Target className="w-3.5 h-3.5 text-gold" />}
          isExpanded={expandedSection === "talk-track"}
          onToggle={() => toggleSection("talk-track")}
        >
          <ol className="space-y-2">
            {coaching.talkTrack.map((step, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="shrink-0 w-5 h-5 rounded-full bg-gold/20 text-gold-dark text-[10px] font-bold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <span className="text-foreground/80 leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
        </CollapsibleSection>

        {/* Discovery Questions */}
        <CollapsibleSection
          title="Discovery Questions"
          icon={<HelpCircle className="w-3.5 h-3.5 text-teal" />}
          isExpanded={expandedSection === "discovery"}
          onToggle={() => toggleSection("discovery")}
        >
          <div className="space-y-2">
            {coaching.discoveryQuestions.map((q, i) => (
              <div key={i} className="flex items-start gap-2 group">
                <Lightbulb className="w-3.5 h-3.5 text-teal shrink-0 mt-0.5" />
                <span className="text-sm text-foreground/80 leading-relaxed flex-1">{q}</span>
                <button
                  onClick={() => copyToClipboard(q, `q-${i}`)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  {copiedField === `q-${i}` ? (
                    <Check className="w-3 h-3 text-emerald-500" />
                  ) : (
                    <Copy className="w-3 h-3 text-muted-foreground" />
                  )}
                </button>
              </div>
            ))}
          </div>
        </CollapsibleSection>

        {/* Objection Risks */}
        <CollapsibleSection
          title="Objection Risks"
          icon={<Shield className="w-3.5 h-3.5 text-amber-500" />}
          isExpanded={expandedSection === "objections"}
          onToggle={() => toggleSection("objections")}
        >
          <div className="space-y-2">
            {coaching.objectionRisks.map((obj, i) => (
              <div key={i} className="bg-amber-50/50 rounded p-2.5 border border-amber-100">
                <p className="text-sm text-foreground/80 leading-relaxed">{obj}</p>
              </div>
            ))}
          </div>
        </CollapsibleSection>

        {/* Persona Insight */}
        {coaching.persona && (
          <CollapsibleSection
            title={`${coaching.persona.roleLabel} Persona`}
            icon={<User className="w-3.5 h-3.5 text-blue-500" />}
            isExpanded={expandedSection === "persona"}
            onToggle={() => toggleSection("persona")}
          >
            <div className="space-y-3">
              <div>
                <span className="text-[10px] font-bold text-navy uppercase tracking-wider">They Care About</span>
                <ul className="mt-1 space-y-1">
                  {coaching.persona.cares_about.slice(0, 3).map((item, i) => (
                    <li key={i} className="text-xs text-foreground/70 flex items-start gap-1.5">
                      <Zap className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <span className="text-[10px] font-bold text-navy uppercase tracking-wider">They Don't Care About</span>
                <ul className="mt-1 space-y-1">
                  {coaching.persona.doesnt_care_about.slice(0, 2).map((item, i) => (
                    <li key={i} className="text-xs text-foreground/70 flex items-start gap-1.5">
                      <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <span className="text-[10px] font-bold text-navy uppercase tracking-wider">Decision Influence</span>
                <p className="text-xs text-foreground/70 mt-1">{coaching.persona.decision_influence}</p>
              </div>
            </div>
          </CollapsibleSection>
        )}

        {/* Pain Points */}
        {coaching.relevantPainPoints.length > 0 && (
          <CollapsibleSection
            title="Segment Pain Points"
            icon={<AlertTriangle className="w-3.5 h-3.5 text-hot" />}
            isExpanded={expandedSection === "pain-points"}
            onToggle={() => toggleSection("pain-points")}
          >
            <div className="space-y-3">
              {coaching.relevantPainPoints.map((pp, i) => (
                <div key={i} className="border-l-2 border-gold/40 pl-3">
                  <p className="text-sm font-medium text-navy">{pp.pain}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{pp.context}</p>
                  <p className="text-xs text-teal mt-1 font-medium">
                    Atlas Copco bridge: {pp.atlasCopcoBridge}
                  </p>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Closing Ask */}
        <div className="bg-emerald-50/50 rounded-lg p-3 border border-emerald-200/50">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1.5">
              <Zap className="w-3 h-3" /> Closing Ask
            </span>
            <button
              onClick={() => copyToClipboard(coaching.closingAsk, "closing")}
              className="text-[10px] text-muted-foreground hover:text-emerald-700 flex items-center gap-1"
            >
              {copiedField === "closing" ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
              Copy
            </button>
          </div>
          <p className="text-sm text-foreground/80 italic leading-relaxed">{coaching.closingAsk}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Collapsible Section ──

function CollapsibleSection({
  title,
  icon,
  isExpanded,
  onToggle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 transition-colors"
      >
        <span className="text-xs font-bold text-navy uppercase tracking-wider flex items-center gap-1.5">
          {icon} {title}
        </span>
        {isExpanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        )}
      </button>
      {isExpanded && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}
