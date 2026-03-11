/**
 * My Working Style — Self-awareness profile page
 *
 * Shows the rep their own engagement patterns, sector focus,
 * BL comfort zones, blind spots, and actionable insights.
 *
 * Framed as self-improvement, not surveillance.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import {
  Sparkles, BarChart3, Target, Eye, TrendingUp,
  Loader2, ArrowLeft, Lightbulb, Shield, Layers,
  Building, Pickaxe, Fuel, Calendar, Clock,
  AlertTriangle, CheckCircle2, Zap
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const sectorLabels: Record<string, string> = {
  mining: "Mining",
  oil_gas: "Oil & Gas",
  infrastructure: "Infrastructure",
  energy: "Energy",
  defence: "Defence",
};

const insightTypeColors: Record<string, { bg: string; border: string; text: string }> = {
  strength: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700" },
  opportunity: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700" },
  pattern: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700" },
  suggestion: { bg: "bg-purple-50", border: "border-purple-200", text: "text-purple-700" },
};

export default function MyProfile() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [period, setPeriod] = useState(30);

  const periodInput = useMemo(() => ({ days: period }), [period]);
  const { data: profile, isLoading, error } = trpc.behaviour.myProfile.useQuery(periodInput, {
    staleTime: 1000 * 60 * 30,
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container py-8">
          <div className="flex items-center gap-3 mb-8">
            <Loader2 className="w-6 h-6 animate-spin text-gold" />
            <span className="text-lg text-muted-foreground">Analysing your working style...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container py-8">
          <Button variant="ghost" onClick={() => navigate("/")} className="mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
          <p className="text-muted-foreground">Unable to generate your working style profile. Start engaging with projects to build your profile.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container py-6 sm:py-8 max-w-5xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="mb-2 -ml-2">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back to This Week
            </Button>
            <h1 className="text-2xl font-bold text-navy flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-gold" />
              My Working Style
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Your engagement patterns and focus areas over the last {period} days
            </p>
          </div>
          <div className="flex gap-2">
            {[7, 14, 30, 60].map(d => (
              <Button
                key={d}
                variant={period === d ? "default" : "outline"}
                size="sm"
                onClick={() => setPeriod(d)}
                className={period === d ? "bg-navy text-white" : ""}
              >
                {d}d
              </Button>
            ))}
          </div>
        </div>

        {/* Insights */}
        {profile.insights.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
            {profile.insights.map((insight, i) => {
              const colors = insightTypeColors[insight.type] || insightTypeColors.pattern;
              return (
                <Card key={i} className={`${colors.bg} ${colors.border} border`}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-2">
                      <span className="text-xl shrink-0">{insight.icon}</span>
                      <div>
                        <div className={`text-sm font-bold ${colors.text}`}>{insight.title}</div>
                        <p className="text-xs text-foreground/70 mt-1 leading-relaxed">{insight.description}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Engagement Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          <StatCard value={profile.engagementPattern.totalActions} label="Total Actions" />
          <StatCard value={profile.engagementPattern.activeDayCount} label="Active Days" />
          <StatCard value={profile.engagementPattern.avgActionsPerDay} label="Avg/Day" />
          <StatCard value={`${profile.engagementPattern.consistencyScore}%`} label="Consistency" />
          <StatCard value={profile.sectorEngagement.length} label="Sectors Covered" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Sector Engagement */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold text-navy flex items-center gap-2">
                <Building className="w-4 h-4 text-gold" />
                Sector Engagement
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {profile.sectorEngagement.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sector engagement data yet.</p>
              ) : (
                profile.sectorEngagement.map(s => (
                  <div key={s.sector}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-navy">{sectorLabels[s.sector] || s.sector}</span>
                      <span className="text-xs text-muted-foreground">{s.shareOfActivity}% of activity</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div
                        className="bg-navy rounded-full h-2 transition-all"
                        style={{ width: `${Math.min(100, s.shareOfActivity)}%` }}
                      />
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-[10px] text-muted-foreground">
                      <span>{s.projectsViewed} projects</span>
                      <span>{s.contactsOpened} contacts</span>
                      <span>{s.outreachSent} outreach</span>
                    </div>
                  </div>
                ))
              )}
              {profile.underworkedSectors.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="flex items-center gap-1.5 mb-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                    <span className="text-xs font-semibold text-amber-700">Underworked Sectors</span>
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {profile.underworkedSectors.map(s => (
                      <span key={s} className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Business Line Comfort Zones */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold text-navy flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-teal" />
                Business Line Coverage
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {profile.blEngagement.length === 0 ? (
                <p className="text-sm text-muted-foreground">No business line engagement data yet.</p>
              ) : (
                profile.blEngagement.map(bl => (
                  <div key={bl.businessLine} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {bl.isBlindSpot ? (
                        <Eye className="w-3.5 h-3.5 text-amber-500" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      )}
                      <span className={`text-sm ${bl.isBlindSpot ? "text-amber-700" : "text-navy"} font-medium`}>
                        {bl.businessLine}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{bl.projectsEngaged} engaged</span>
                      {bl.untouchedHighScore > 0 && (
                        <span className="text-amber-600">{bl.untouchedHighScore} untouched</span>
                      )}
                      {bl.isBlindSpot && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-700">BLIND SPOT</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Stage Preferences */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold text-navy flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-600" />
                Stage Preferences
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {profile.stagePreferences.length === 0 ? (
                <p className="text-sm text-muted-foreground">No stage preference data yet.</p>
              ) : (
                profile.stagePreferences.map(s => (
                  <div key={s.stage} className="flex items-center justify-between">
                    <span className="text-sm text-navy font-medium">{s.stage}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-24 bg-slate-100 rounded-full h-1.5">
                        <div
                          className="bg-blue-500 rounded-full h-1.5 transition-all"
                          style={{ width: `${Math.min(100, s.shareOfActivity)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-12 text-right">{s.projectCount} proj</span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Activity Pattern */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold text-navy flex items-center gap-2">
                <Calendar className="w-4 h-4 text-purple-600" />
                Activity Pattern
              </CardTitle>
            </CardHeader>
            <CardContent>
              {profile.engagementPattern.activeDays.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity pattern data yet.</p>
              ) : (
                <div className="space-y-2">
                  {profile.engagementPattern.activeDays.map(d => (
                    <div key={d.day} className="flex items-center gap-3">
                      <span className="text-xs font-medium text-navy w-8">{d.dayName}</span>
                      <div className="flex-1 bg-slate-100 rounded-full h-2">
                        <div
                          className="bg-purple-500 rounded-full h-2 transition-all"
                          style={{
                            width: `${Math.min(100, Math.round(
                              (d.count / Math.max(1, ...profile.engagementPattern.activeDays.map(x => x.count))) * 100
                            ))}%`
                          }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-12 text-right">{d.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatCard({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="text-center px-3 py-3 rounded-lg bg-card border border-border">
      <div className="text-2xl font-bold text-navy">{value}</div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  );
}
