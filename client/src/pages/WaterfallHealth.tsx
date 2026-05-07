/**
 * WaterfallHealth.tsx — Contact Discovery Waterfall Health Dashboard
 *
 * Admin-only view showing:
 *   1. Source-by-source conversion funnel (saved → linked → email → send_ready)
 *   2. Project discoveryStatus distribution
 *   3. Per-project contact coverage with trust-tier breakdown
 *   4. Orphan audit (contacts with no contactProjects row)
 *
 * This page is the single source of truth for diagnosing why contacts
 * are not appearing in digests.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Database,
  Link2,
  Mail,
  Shield,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";

// ── Helpers ──────────────────────────────────────────────────────────────────

function pct(n: number, d: number): string {
  if (!d) return "—";
  return `${Math.round((n / d) * 100)}%`;
}

function num(v: unknown): number {
  return Number(v ?? 0);
}

function TrustBadge({ tier }: { tier: string }) {
  if (tier === "send_ready")
    return (
      <Badge className="bg-emerald-600 text-white text-[10px] px-1.5 py-0.5">
        send_ready
      </Badge>
    );
  if (tier === "named_unverified")
    return (
      <Badge className="bg-amber-500 text-white text-[10px] px-1.5 py-0.5">
        named_unverified
      </Badge>
    );
  return (
    <Badge className="bg-slate-400 text-white text-[10px] px-1.5 py-0.5">
      llm_inferred
    </Badge>
  );
}

function DiscoveryStatusBadge({ status }: { status: string | null }) {
  const s = status || "no_contacts";
  const map: Record<string, { color: string; label: string }> = {
    send_ready_contact: { color: "bg-emerald-600 text-white", label: "send_ready" },
    named_contact_no_email: { color: "bg-amber-500 text-white", label: "named_no_email" },
    role_only: { color: "bg-orange-400 text-white", label: "role_only" },
    discovery_queued: { color: "bg-blue-500 text-white", label: "queued" },
    discovery_running: { color: "bg-blue-700 text-white", label: "running" },
    no_contacts: { color: "bg-slate-400 text-white", label: "no_contacts" },
    blocked_government_owner: { color: "bg-red-500 text-white", label: "blocked_gov" },
    blocked_dirty_owner: { color: "bg-red-500 text-white", label: "blocked_dirty" },
    blocked_no_usable_domain: { color: "bg-red-500 text-white", label: "blocked_domain" },
  };
  const { color, label } = map[s] || { color: "bg-slate-400 text-white", label: s };
  return <Badge className={`${color} text-[10px] px-1.5 py-0.5`}>{label}</Badge>;
}

function DigestReadinessBadge({ status }: { status: string }) {
  const map: Record<string, { icon: React.ReactNode; color: string }> = {
    digest_safe: { icon: <CheckCircle2 className="w-3 h-3" />, color: "text-emerald-600" },
    needs_verification: { icon: <Clock className="w-3 h-3" />, color: "text-amber-500" },
    llm_only: { icon: <AlertCircle className="w-3 h-3" />, color: "text-orange-500" },
    no_contacts: { icon: <XCircle className="w-3 h-3" />, color: "text-slate-400" },
  };
  const { icon, color } = map[status] || { icon: null, color: "text-slate-400" };
  return (
    <span className={`flex items-center gap-1 text-xs font-medium ${color}`}>
      {icon}
      {status.replace(/_/g, " ")}
    </span>
  );
}

function SourceLabel({ source }: { source: string }) {
  const colors: Record<string, string> = {
    apollo: "bg-indigo-100 text-indigo-700",
    web_search: "bg-cyan-100 text-cyan-700",
    linkedin: "bg-blue-100 text-blue-700",
    llm: "bg-purple-100 text-purple-700",
    manual: "bg-slate-100 text-slate-600",
    hunter: "bg-orange-100 text-orange-700",
    projectory: "bg-teal-100 text-teal-700",
    scraper: "bg-green-100 text-green-700",
  };
  const cls = colors[source] || "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}>
      {source}
    </span>
  );
}

// ── Sub-views ─────────────────────────────────────────────────────────────────

function SourceFunnelTab() {
  const [days, setDays] = useState(30);
  const { data = [], isLoading } = trpc.waterfall.sourceFunnel.useQuery({ days });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Tracks every contact from save → linked → email → send_ready. A drop at any stage
          indicates a pipeline gap.
        </p>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-32 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="14">Last 14 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="60">Last 60 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <th className="text-left px-4 py-3">Source</th>
                <th className="text-right px-4 py-3">Saved</th>
                <th className="text-right px-4 py-3">
                  <span className="flex items-center justify-end gap-1">
                    <Link2 className="w-3 h-3" /> Linked
                  </span>
                </th>
                <th className="text-right px-4 py-3">Link %</th>
                <th className="text-right px-4 py-3">
                  <span className="flex items-center justify-end gap-1">
                    <Mail className="w-3 h-3" /> Has Email
                  </span>
                </th>
                <th className="text-right px-4 py-3">Email Verified</th>
                <th className="text-right px-4 py-3">
                  <span className="flex items-center justify-end gap-1">
                    <Shield className="w-3 h-3" /> send_ready
                  </span>
                </th>
                <th className="text-right px-4 py-3">send_ready %</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row: any, i: number) => {
                const saved = num(row.contacts_saved);
                const linked = num(row.contacts_linked);
                const sendReady = num(row.promoted_send_ready);
                const isGood = sendReady > 0;
                return (
                  <tr
                    key={i}
                    className={`border-t border-border ${i % 2 === 0 ? "" : "bg-muted/20"} ${
                      !isGood && saved > 0 ? "bg-red-50/40" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <SourceLabel source={row.source || "unknown"} />
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{saved}</td>
                    <td className="px-4 py-3 text-right font-mono">{linked}</td>
                    <td
                      className={`px-4 py-3 text-right font-mono text-xs ${
                        num(row.link_rate_pct) < 80 ? "text-red-500 font-bold" : "text-emerald-600"
                      }`}
                    >
                      {row.link_rate_pct ?? "—"}%
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{num(row.has_email)}</td>
                    <td className="px-4 py-3 text-right font-mono">{num(row.email_verified)}</td>
                    <td
                      className={`px-4 py-3 text-right font-mono font-bold ${
                        sendReady > 0 ? "text-emerald-600" : "text-red-400"
                      }`}
                    >
                      {sendReady}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono text-xs ${
                        num(row.send_ready_rate_pct) === 0 ? "text-red-400" : "text-emerald-600"
                      }`}
                    >
                      {row.send_ready_rate_pct ?? "0"}%
                    </td>
                  </tr>
                );
              })}
              {data.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground text-sm">
                    No contacts created in the last {days} days.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
        <strong>Reading this table:</strong> A source with high "Saved" but low "send_ready %" has
        a pipeline gap. Red link % (&lt;80%) means contacts are being saved without a
        contactProjects row — they are invisible to all project queries. Zero send_ready means no
        contact from this source will ever appear in a digest.
      </div>
    </div>
  );
}

function ProjectStatusTab() {
  const { data = [], isLoading } = trpc.waterfall.projectStatusDistribution.useQuery();

  // Group by priority
  const grouped: Record<string, any[]> = {};
  for (const row of data as any[]) {
    const p = row.priority || "unknown";
    if (!grouped[p]) grouped[p] = [];
    grouped[p].push(row);
  }

  const priorityOrder = ["hot", "warm", "cold", "unknown"];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Distribution of active projects across discoveryStatus stages, grouped by priority.
        Projects must reach <strong>send_ready_contact</strong> before they can appear in a digest.
      </p>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {priorityOrder.map((priority) => {
            const rows = grouped[priority] || [];
            if (rows.length === 0) return null;
            const total = rows.reduce((s: number, r: any) => s + num(r.cnt), 0);
            const sendReady = rows.find((r: any) => r.discoveryStatus === "send_ready_contact");
            const sendReadyCount = sendReady ? num(sendReady.cnt) : 0;

            return (
              <Card key={priority} className="border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold capitalize flex items-center justify-between">
                    <span>{priority}</span>
                    <span className="text-muted-foreground font-normal">{total} projects</span>
                  </CardTitle>
                  <div className="text-xs text-emerald-600 font-medium">
                    {sendReadyCount} digest-safe ({pct(sendReadyCount, total)})
                  </div>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {rows
                    .sort((a: any, b: any) => num(b.cnt) - num(a.cnt))
                    .map((row: any, i: number) => (
                      <div key={i} className="flex items-center justify-between">
                        <DiscoveryStatusBadge status={row.discoveryStatus} />
                        <span className="text-xs font-mono text-muted-foreground">{num(row.cnt)}</span>
                      </div>
                    ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ContactCoverageTab() {
  const [priority, setPriority] = useState<"hot" | "warm" | "all">("hot");
  const { data = [], isLoading } = trpc.waterfall.contactCoverage.useQuery({
    priority,
    limit: 100,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Per-project contact breakdown by trust tier and source. Shows exactly which projects
          have digest-safe contacts and which are blocked.
        </p>
        <Select value={priority} onValueChange={(v) => setPriority(v as any)}>
          <SelectTrigger className="w-28 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="hot">Hot only</SelectItem>
            <SelectItem value="warm">Warm only</SelectItem>
            <SelectItem value="all">Hot + Warm</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50 text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left px-3 py-3">Project</th>
                <th className="text-left px-3 py-3">Location</th>
                <th className="text-center px-3 py-3">Status</th>
                <th className="text-right px-3 py-3">Total</th>
                <th className="text-right px-3 py-3 text-emerald-600">send_ready</th>
                <th className="text-right px-3 py-3 text-amber-500">named_unver.</th>
                <th className="text-right px-3 py-3 text-slate-400">llm</th>
                <th className="text-right px-3 py-3">Apollo</th>
                <th className="text-right px-3 py-3">Web</th>
                <th className="text-left px-3 py-3">Digest</th>
              </tr>
            </thead>
            <tbody>
              {(data as any[]).map((row: any, i: number) => (
                <tr
                  key={i}
                  className={`border-t border-border ${i % 2 === 0 ? "" : "bg-muted/20"} ${
                    row.digest_readiness === "digest_safe" ? "bg-emerald-50/30" : ""
                  } ${row.digest_readiness === "no_contacts" ? "bg-red-50/30" : ""}`}
                >
                  <td className="px-3 py-2.5 font-medium max-w-[200px] truncate">
                    {row.projectName}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{row.location || "—"}</td>
                  <td className="px-3 py-2.5 text-center">
                    <DiscoveryStatusBadge status={row.discoveryStatus} />
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">{num(row.total_contacts)}</td>
                  <td className="px-3 py-2.5 text-right font-mono font-bold text-emerald-600">
                    {num(row.send_ready)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-amber-500">
                    {num(row.named_unverified)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-slate-400">
                    {num(row.llm_inferred)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">{num(row.from_apollo)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{num(row.from_web)}</td>
                  <td className="px-3 py-2.5">
                    <DigestReadinessBadge status={row.digest_readiness} />
                  </td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                    No projects found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OrphanAuditTab() {
  const { data, isLoading } = trpc.waterfall.orphanAudit.useQuery();
  const sources: any[] = (data as any)?.sources || [];

  const totalOrphaned = sources.reduce((s: number, r: any) => s + num(r.orphaned), 0);
  const totalContacts = sources.reduce((s: number, r: any) => s + num(r.total), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex-1">
          <div className="text-2xl font-bold text-red-600">{totalOrphaned.toLocaleString()}</div>
          <div className="text-xs text-red-700 mt-0.5">
            orphaned contacts (no contactProjects row) — invisible to all project queries
          </div>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex-1">
          <div className="text-2xl font-bold text-emerald-600">
            {(totalContacts - totalOrphaned).toLocaleString()}
          </div>
          <div className="text-xs text-emerald-700 mt-0.5">
            linked contacts — visible to project queries
          </div>
        </div>
        <div className="bg-slate-50 border border-border rounded-lg p-4 flex-1">
          <div className="text-2xl font-bold text-slate-700">{totalContacts.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground mt-0.5">total contacts in database</div>
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <th className="text-left px-4 py-3">Source</th>
                <th className="text-right px-4 py-3">Total</th>
                <th className="text-right px-4 py-3">Linked</th>
                <th className="text-right px-4 py-3">Link %</th>
                <th className="text-right px-4 py-3 text-red-500">Orphaned</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((row: any, i: number) => (
                <tr
                  key={i}
                  className={`border-t border-border ${i % 2 === 0 ? "" : "bg-muted/20"} ${
                    num(row.orphaned) > 0 ? "bg-red-50/30" : ""
                  }`}
                >
                  <td className="px-4 py-3">
                    <SourceLabel source={row.source || "unknown"} />
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{num(row.total)}</td>
                  <td className="px-4 py-3 text-right font-mono text-emerald-600">
                    {num(row.linked)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono text-xs ${
                      num(row.link_pct) < 80 ? "text-red-500 font-bold" : "text-emerald-600"
                    }`}
                  >
                    {row.link_pct ?? "—"}%
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono font-bold ${
                      num(row.orphaned) > 0 ? "text-red-500" : "text-slate-400"
                    }`}
                  >
                    {num(row.orphaned)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
        <strong>Fix:</strong> Orphaned contacts were backfilled by the repair script run on
        2026-05-07. Going forward, the web_search and linkedin save paths now write the
        contactProjects row atomically at insert time. Apollo's secondary verify path now also
        promotes contactTrustTier to send_ready when email_status = "verified".
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function WaterfallHealth() {
  return (
    <div className="container py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Database className="w-6 h-6 text-indigo-500" />
            Contact Discovery Waterfall Health
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Admin view — source-by-source pipeline audit, project status distribution, and
            contact coverage. Use this to diagnose why contacts are not appearing in digests.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded px-3 py-2">
          <TrendingUp className="w-3.5 h-3.5" />
          Live data
        </div>
      </div>

      {/* Quick legend */}
      <div className="grid grid-cols-3 gap-3 text-xs">
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <div>
            <div className="font-semibold text-emerald-700">send_ready</div>
            <div className="text-emerald-600">Verified email + project linked. Digest-safe.</div>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <Clock className="w-4 h-4 text-amber-500 shrink-0" />
          <div>
            <div className="font-semibold text-amber-700">named_unverified</div>
            <div className="text-amber-600">Named person, email missing or unverified.</div>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-slate-50 border border-border rounded-lg px-3 py-2">
          <Users className="w-4 h-4 text-slate-400 shrink-0" />
          <div>
            <div className="font-semibold text-slate-600">llm_inferred</div>
            <div className="text-slate-500">AI-suggested role only. Never digest-safe.</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="funnel">
        <TabsList className="bg-muted/50 border border-border">
          <TabsTrigger value="funnel" className="text-xs">
            Source Funnel
          </TabsTrigger>
          <TabsTrigger value="status" className="text-xs">
            Project Status
          </TabsTrigger>
          <TabsTrigger value="coverage" className="text-xs">
            Contact Coverage
          </TabsTrigger>
          <TabsTrigger value="orphans" className="text-xs">
            Orphan Audit
          </TabsTrigger>
        </TabsList>

        <TabsContent value="funnel" className="mt-4">
          <SourceFunnelTab />
        </TabsContent>
        <TabsContent value="status" className="mt-4">
          <ProjectStatusTab />
        </TabsContent>
        <TabsContent value="coverage" className="mt-4">
          <ContactCoverageTab />
        </TabsContent>
        <TabsContent value="orphans" className="mt-4">
          <OrphanAuditTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
