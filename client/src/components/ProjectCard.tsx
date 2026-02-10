/*
 * ProjectCard — Expandable project card with priority-coded left border
 * Design: Nordic Industrial Precision — deep navy, gold accents, teal highlights
 */
import { useState } from "react";
import { ChevronDown, ExternalLink, MapPin, DollarSign, Building2, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { Project } from "@/lib/data";

const priorityConfig = {
  hot: { border: "border-l-hot", bg: "bg-hot/5", badge: "bg-hot text-white", label: "HOT" },
  warm: { border: "border-l-warm", bg: "bg-warm/5", badge: "bg-warm text-navy", label: "WARM" },
  cold: { border: "border-l-cold", bg: "bg-cold/5", badge: "bg-cold text-white", label: "COLD" },
};

const capexBadge: Record<string, string> = {
  A: "bg-navy text-gold-light",
  B: "bg-navy-light text-slate-200",
  Unknown: "bg-slate-300 text-slate-700",
};

const routeBadge: Record<string, string> = {
  "Direct CAPEX": "bg-teal/15 text-teal border border-teal/30",
  "Fleet CAPEX": "bg-gold/15 text-gold-dark border border-gold/30",
  "OPEX/Monitor": "bg-slate-200 text-slate-600 border border-slate-300",
};

export default function ProjectCard({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const cfg = priorityConfig[project.priority];

  return (
    <div
      className={`bg-card rounded-lg border-l-4 ${cfg.border} shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden ${project.isNew ? "ring-1 ring-teal/40" : ""}`}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left p-4 sm:p-5 flex items-start justify-between gap-3"
      >
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <h3 className="text-sm sm:text-base font-semibold text-navy leading-tight">{project.name}</h3>
            {project.isNew && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-teal text-white uppercase tracking-wider">
                <Sparkles className="w-3 h-3" /> New
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{project.location}</span>
            <span className="inline-flex items-center gap-1"><DollarSign className="w-3 h-3" />{project.value}</span>
            <span className="inline-flex items-center gap-1"><Building2 className="w-3 h-3" />{project.owner}</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${cfg.badge}`}>{cfg.label}</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${capexBadge[project.capexGrade]}`}>CAPEX {project.capexGrade}</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${routeBadge[project.opportunityRoute]}`}>{project.opportunityRoute}</span>
          </div>
        </div>
        <ChevronDown className={`w-5 h-5 text-muted-foreground shrink-0 transition-transform duration-200 mt-1 ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 sm:px-5 pb-5 border-t border-border">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-4">
                {/* Overview */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gold-dark mb-2">Project Overview</h4>
                  <p className="text-sm text-foreground/80 leading-relaxed">{project.overview}</p>
                  {project.opportunityNote && (
                    <div className="mt-3 p-3 bg-gold/8 rounded border border-gold/20">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-gold-dark mb-1">Opportunity Route</h4>
                      <p className="text-sm text-foreground/80">{project.opportunityNote}</p>
                    </div>
                  )}
                </div>

                {/* Contractors */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gold-dark mb-2">Contractors</h4>
                  <ul className="space-y-1.5">
                    {project.contractors.map((c, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <span className={`shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                          c.status === "confirmed" ? "bg-teal/15 text-teal" :
                          c.status === "predicted" ? "bg-gold/15 text-gold-dark" :
                          "bg-slate-200 text-slate-500"
                        }`}>
                          {c.status === "confirmed" ? "Confirmed" : c.status === "predicted" ? `Predicted ${c.confidence || ""}` : "TBD"}
                        </span>
                        <span className="text-foreground/80">{c.name}{c.detail ? ` — ${c.detail}` : ""}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Equipment Signals */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gold-dark mb-2">Equipment Signals</h4>
                  <ul className="space-y-1">
                    {project.equipmentSignals.map((s, i) => (
                      <li key={i} className="text-sm text-foreground/80 flex items-start gap-2">
                        <span className="w-1 h-1 rounded-full bg-teal shrink-0 mt-2" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Timeline & Sources */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gold-dark mb-2">Timeline & Sources</h4>
                  <div className="text-sm text-foreground/80 space-y-1">
                    <p><span className="font-medium text-foreground">Stage:</span> {project.stage}</p>
                    {project.timeline && <p><span className="font-medium text-foreground">Duration:</span> {project.timeline}</p>}
                    {project.completion && <p><span className="font-medium text-foreground">Completion:</span> {project.completion}</p>}
                  </div>
                  <div className="mt-3 space-y-1">
                    {project.sources.map((src, i) => (
                      <a
                        key={i}
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs text-teal hover:text-teal-light transition-colors"
                      >
                        <ExternalLink className="w-3 h-3 shrink-0" />
                        {src.label}{src.date ? ` (${src.date})` : ""}
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
