/**
 * Unified type exports
 * Import shared types from this single entry point.
 */

export type * from "../drizzle/schema";
export * from "./_core/errors";

// ── Atlas Copco Market Intelligence shared types ──

export interface ProjectData {
  id: number;
  reportId: number;
  projectKey: string;
  name: string;
  location: string;
  value: string;
  owner: string;
  priority: "hot" | "warm" | "cold";
  capexGrade: "A" | "B" | "Unknown";
  opportunityRoute: "Direct CAPEX" | "Fleet CAPEX" | "OPEX/Monitor";
  sector: "mining" | "oil_gas" | "infrastructure" | "energy" | "defence";
  isNew: boolean;
  stage: string | null;
  overview: string | null;
  equipmentSignals: string[] | null;
  contractors: { name: string; status: string; confidence?: number; detail?: string }[] | null;
  opportunityNote: string | null;
  sources: { label: string; url: string; date?: string }[] | null;
  timeline: string | null;
  completion: string | null;
}

export interface ContactData {
  id: number;
  reportId: number;
  name: string;
  title: string;
  company: string;
  project: string;
  priority: "hot" | "warm" | "cold";
  roleBucket: string;
  email: string | null;
  linkedin: string | null;
  phone: string | null;
}

export interface DrillingCampaignData {
  id: number;
  reportId: number;
  campaign: string;
  operator: string;
  location: string;
  drillType: string;
  timing: string;
  airRequirement: string;
  sourceLabel: string | null;
  sourceUrl: string | null;
}

export interface AwardedProjectData {
  id: number;
  reportId: number;
  project: string;
  value: string;
  winningContractor: string;
  location: string;
  stage: string;
  opportunity: "Direct" | "Fleet" | "Monitor";
  sourceLabel: string | null;
  sourceUrl: string | null;
}

export interface ReportData {
  id: number;
  weekEnding: string;
  generatedTime: string;
  totalProjects: number;
  hotProjects: number;
  warmProjects: number;
  coldProjects: number;
  confirmedContractors: number;
  predictedContractors: number;
  capexOpportunities: number;
  totalContacts: number;
  sourcesSearched: string;
  newProjectsCount: number;
  executiveSummaryMain: string | null;
  executiveSummaryChanges: string | null;
  actionItems: string[] | null;
  researchPasses: { pass: string; focus: string; rawProjects: number; keySources: string }[] | null;
  sourceCategories: { name: string; type: string }[] | null;
}

export interface FullReportResponse {
  report: ReportData;
  projects: ProjectData[];
  contacts: ContactData[];
  drillingCampaigns: DrillingCampaignData[];
  awardedProjects: AwardedProjectData[];
}
