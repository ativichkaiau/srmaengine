// Study-level critical appraisal for the SR workflow steps the course teaches:
//  - Risk of Bias (RoB 2, Sterne 2019) — step 6 "Assess the risk of bias"
//  - GRADE certainty of evidence — step 8 "Summarize & grade the certainty"
// Both persist to localStorage and fire `srma-appraisal-changed` so views sync.

// ---------- Risk of Bias 2 (RoB 2) ----------

export type RobJudgement = 'low' | 'some' | 'high';

// The five official RoB 2 domains (Sterne JAC et al. BMJ 2019;366:l4898),
// in order, with the signalling focus of each.
export const ROB_DOMAINS = [
  {
    key: 'randomization',
    short: 'D1',
    label: 'Randomization process',
    hint: 'Allocation sequence random and concealed until assignment; baseline groups comparable.',
  },
  {
    key: 'deviations',
    short: 'D2',
    label: 'Deviations from intended interventions',
    hint: 'Participants/carers blind to assignment; no bias-inducing deviations; analysed as randomized (ITT).',
  },
  {
    key: 'missing',
    short: 'D3',
    label: 'Missing outcome data',
    hint: 'Outcome data for (nearly) all participants; missingness not related to the true outcome value.',
  },
  {
    key: 'measurement',
    short: 'D4',
    label: 'Measurement of the outcome',
    hint: 'Appropriate method; outcome assessors blinded; ascertainment comparable across arms.',
  },
  {
    key: 'selection',
    short: 'D5',
    label: 'Selection of the reported result',
    hint: 'Result not cherry-picked from multiple outcomes/analyses; pre-specified analysis plan followed.',
  },
] as const;

export type RobDomainKey = (typeof ROB_DOMAINS)[number]['key'];

export type RobStudy = {
  id: string;
  label: string;
  domains: Record<RobDomainKey, RobJudgement>;
};

// Overall judgement per the RoB 2 algorithm: High if any domain is High;
// otherwise Some concerns if any domain raises Some concerns; otherwise Low.
// (The tool also flags where several domains are "some", which the RoB 2
// guidance says *may* warrant escalating the overall to High by judgement.)
export function robOverall(study: RobStudy): RobJudgement {
  const vals = ROB_DOMAINS.map((d) => study.domains[d.key]);
  if (vals.some((v) => v === 'high')) return 'high';
  if (vals.some((v) => v === 'some')) return 'some';
  return 'low';
}

export const ROB_LABELS: Record<RobJudgement, string> = {
  low: 'Low',
  some: 'Some concerns',
  high: 'High',
};

export function emptyRobDomains(): Record<RobDomainKey, RobJudgement> {
  return ROB_DOMAINS.reduce(
    (acc, d) => ({ ...acc, [d.key]: 'low' as RobJudgement }),
    {} as Record<RobDomainKey, RobJudgement>
  );
}

// ---------- GRADE certainty of evidence ----------

export type GradeLevel = 'high' | 'moderate' | 'low' | 'verylow';
export type GradeStep = 0 | 1 | 2; // 0 = not serious, 1 = serious, 2 = very serious
export type GradeDesign = 'rct' | 'observational';

export const GRADE_DOWNGRADE = [
  { key: 'rob', label: 'Risk of bias' },
  { key: 'inconsistency', label: 'Inconsistency' },
  { key: 'indirectness', label: 'Indirectness' },
  { key: 'imprecision', label: 'Imprecision' },
  { key: 'pubbias', label: 'Publication bias' },
] as const;

export const GRADE_UPGRADE = [
  { key: 'largeeffect', label: 'Large effect' },
  { key: 'doseresponse', label: 'Dose–response gradient' },
  { key: 'confounding', label: 'Plausible confounding would reduce the effect' },
] as const;

export type GradeDownKey = (typeof GRADE_DOWNGRADE)[number]['key'];
export type GradeUpKey = (typeof GRADE_UPGRADE)[number]['key'];

export type GradeRow = {
  id: string;
  outcome: string;
  design: GradeDesign;
  downgrades: Record<GradeDownKey, GradeStep>;
  upgrades: Record<GradeUpKey, GradeStep>;
};

export const GRADE_LABELS: Record<GradeLevel, string> = {
  high: 'High',
  moderate: 'Moderate',
  low: 'Low',
  verylow: 'Very low',
};

// GRADE starts High for randomized trials and Low for observational studies,
// is downgraded by the five domains, and (observational only) upgraded by three.
export function gradeCompute(row: GradeRow): GradeLevel {
  let score = row.design === 'rct' ? 4 : 2;
  for (const d of GRADE_DOWNGRADE) score -= row.downgrades[d.key] ?? 0;
  if (row.design !== 'rct') {
    for (const u of GRADE_UPGRADE) score += row.upgrades[u.key] ?? 0;
  }
  score = Math.max(1, Math.min(4, score));
  return score === 4 ? 'high' : score === 3 ? 'moderate' : score === 2 ? 'low' : 'verylow';
}

// ⊕ pip string, e.g. High = ⊕⊕⊕⊕, Very low = ⊕◯◯◯.
export function gradePips(level: GradeLevel): string {
  const filled = { high: 4, moderate: 3, low: 2, verylow: 1 }[level];
  return '⊕'.repeat(filled) + '◯'.repeat(4 - filled);
}

export function emptyGradeRow(id: string, outcome = ''): GradeRow {
  return {
    id,
    outcome,
    design: 'rct',
    downgrades: GRADE_DOWNGRADE.reduce(
      (a, d) => ({ ...a, [d.key]: 0 as GradeStep }),
      {} as Record<GradeDownKey, GradeStep>
    ),
    upgrades: GRADE_UPGRADE.reduce(
      (a, u) => ({ ...a, [u.key]: 0 as GradeStep }),
      {} as Record<GradeUpKey, GradeStep>
    ),
  };
}

// ---------- Persistence ----------

const ROB_KEY = 'srma-rob-v1';
const GRADE_KEY = 'srma-grade-v1';
const CHANGED = 'srma-appraisal-changed';

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new Event(CHANGED));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export function loadRob(): RobStudy[] {
  return readJSON<RobStudy[]>(ROB_KEY, []);
}
export function saveRob(rows: RobStudy[]): void {
  writeJSON(ROB_KEY, rows);
}
export function loadGrade(): GradeRow[] {
  return readJSON<GradeRow[]>(GRADE_KEY, []);
}
export function saveGrade(rows: GradeRow[]): void {
  writeJSON(GRADE_KEY, rows);
}

export const APPRAISAL_CHANGED_EVENT = CHANGED;
