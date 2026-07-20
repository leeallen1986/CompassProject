import { ALL_AU_STATES, type AUState } from "./canonicalMappings";

export interface TerritoryScopedProject {
  projectState?: string | null;
  location?: string | null;
}

const NATIONAL_TOKENS = new Set([
  "national",
  "nationwide",
  "australia",
  "australia wide",
  "across australia",
  "all states",
  "multi state",
]);

const TERRITORY_PATTERNS: Array<[AUState, RegExp[]]> = [
  ["WA", [/\bwa\b/i, /\bwestern australia\b/i, /\bperth\b/i, /\bpilbara\b/i, /\bkalgoorlie\b/i, /\bkarratha\b/i, /\bport hedland\b/i, /\bnewman\b/i, /\bgeraldton\b/i, /\bbunbury\b/i, /\bbroome\b/i]],
  ["QLD", [/\bqld\b/i, /\bqueensland\b/i, /\bbrisbane\b/i, /\btownsville\b/i, /\bmackay\b/i, /\bgladstone\b/i, /\bbowen basin\b/i, /\bmoranbah\b/i]],
  ["NSW", [/\bnsw\b/i, /\bnew south wales\b/i, /\bsydney\b/i, /\bnewcastle\b/i, /\bhunter valley\b/i, /\bwollongong\b/i, /\bbroken hill\b/i]],
  ["VIC", [/\bvic\b/i, /\bvictoria\b/i, /\bmelbourne\b/i, /\bgeelong\b/i, /\blatrobe valley\b/i]],
  ["SA", [/\bsa\b/i, /\bsouth australia\b/i, /\badelaide\b/i, /\bolympic dam\b/i, /\bwhyalla\b/i, /\bport augusta\b/i]],
  ["NT", [/\bnt\b/i, /\bnorthern territory\b/i, /\bdarwin\b/i, /\balice springs\b/i, /\btennant creek\b/i]],
  ["TAS", [/\btas\b/i, /\btasmania\b/i, /\bhobart\b/i, /\blaunceston\b/i]],
  ["ACT", [/\bact\b/i, /\baustralian capital territory\b/i, /\bcanberra\b/i]],
  ["OFFSHORE_AU", [/\boffshore(?: australia| au)?\b/i, /\bfpso\b/i, /\bnorth west shelf\b/i, /\bnwshelf\b/i, /\btimor sea\b/i, /\bbass strait\b/i]],
];

function normaliseTerritoryInput(value: unknown): string {
  return String(value ?? "")
    .replace(/[_/|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function hasConfiguredTerritoryInput(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(item => String(item ?? "").trim().length > 0);
  const text = String(value ?? "").trim();
  if (!text) return false;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.some(item => String(item ?? "").trim().length > 0);
  } catch {
    // Plain comma-separated strings are valid profile input.
  }
  return true;
}

export function territoryCodesFromValue(value: unknown): AUState[] {
  const text = normaliseTerritoryInput(value);
  if (!text) return [];
  if (NATIONAL_TOKENS.has(text)) return [...ALL_AU_STATES];

  const found = new Set<AUState>();
  for (const [state, patterns] of TERRITORY_PATTERNS) {
    if (patterns.some(pattern => pattern.test(text))) found.add(state);
  }
  return [...found];
}

export function isNationalTerritoryScope(territories: readonly string[]): boolean {
  const configured = new Set(territories.map(value => value.toUpperCase()));
  const onshore = ALL_AU_STATES.filter(state => state !== "OFFSHORE_AU");
  return onshore.every(state => configured.has(state));
}

/**
 * Project state is authoritative. Free-text location is used only when projectState
 * is absent or unparseable. An unresolved territory fails closed.
 */
export function projectMatchesResolvedTerritories(
  project: TerritoryScopedProject,
  territories: readonly string[],
): boolean {
  if (territories.length === 0) return false;
  if (isNationalTerritoryScope(territories)) return true;

  const allowed = new Set(territories.map(value => value.toUpperCase()));
  const primaryStates = territoryCodesFromValue(project.projectState);
  if (primaryStates.length > 0) return primaryStates.some(state => allowed.has(state));

  const fallbackStates = territoryCodesFromValue(project.location);
  if (fallbackStates.length === 0) return false;
  return fallbackStates.some(state => allowed.has(state));
}

export function scopeProjectsToResolvedTerritories<T extends TerritoryScopedProject>(
  projects: readonly T[],
  territories: readonly string[],
  scopeResolved = true,
): T[] {
  if (!scopeResolved) return [];
  return projects.filter(project => projectMatchesResolvedTerritories(project, territories));
}
