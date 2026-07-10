// Screening library — persists include/exclude/maybe decisions across the
// Scanner and Research tabs, and derives PRISMA-style counts. Per-browser
// localStorage; no backend.

export type Decision = 'include' | 'exclude' | 'maybe' | 'unscreened';

export type Reviewer = 1 | 2;

export type LibraryRecord = {
  id: string; // stable key (doi/pmid/normalized-title)
  title: string;
  authors?: string;
  year?: number | string;
  doi?: string;
  pmid?: string;
  url?: string;
  source?: string; // e.g. "Europe PMC", "OpenAlex", "Scanner"
  decision: Decision; // reviewer 1 (primary)
  decision2?: Decision; // reviewer 2 (dual screening)
  reason?: string;
  addedAt: number;
};

export type RecordBase = Omit<
  LibraryRecord,
  'decision' | 'decision2' | 'reason' | 'addedAt'
>;

const REVIEWER_KEY = 'srma-reviewer';

export function loadReviewer(): Reviewer {
  if (typeof window === 'undefined') return 1;
  return window.localStorage.getItem(REVIEWER_KEY) === '2' ? 2 : 1;
}

export function saveReviewer(r: Reviewer): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(REVIEWER_KEY, String(r));
  window.dispatchEvent(new Event('srma-library-changed'));
}

export type Library = {
  records: LibraryRecord[];
  // Running total of records fed in from searches (incl. duplicates), so
  // PRISMA can report "duplicates removed" honestly.
  identified: number;
};

const STORE_KEY = 'srma-library-v1';

const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

export function recordKey(r: {
  doi?: string;
  pmid?: string;
  title?: string;
  id?: string;
}): string {
  if (r.doi) return `doi:${r.doi.toLowerCase()}`;
  if (r.pmid) return `pmid:${r.pmid}`;
  if (r.title) return `t:${norm(r.title)}`;
  return r.id || '';
}

export function loadLibrary(): Library {
  const empty: Library = { records: [], identified: 0 };
  if (typeof window === 'undefined') return empty;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    return {
      records: Array.isArray(parsed.records) ? parsed.records : [],
      identified:
        typeof parsed.identified === 'number' ? parsed.identified : 0,
    };
  } catch {
    return empty;
  }
}

export function saveLibrary(lib: Library): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(lib));
    // Let same-tab listeners (the /library page) know it changed.
    window.dispatchEvent(new Event('srma-library-changed'));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

// Record a decision from a given reviewer, creating the record if new.
// `identified` only increments for genuinely new records (per-record, not
// per-click) so PRISMA "duplicates removed" reflects import overlap, not edits.
export function upsertDecision(
  base: RecordBase,
  reviewer: Reviewer,
  decision: Decision,
  now: number = Date.now()
): Library {
  const lib = loadLibrary();
  const key = recordKey(base);
  const i = lib.records.findIndex((r) => recordKey(r) === key);
  if (i >= 0) {
    const rec = { ...lib.records[i], ...base };
    if (reviewer === 2) rec.decision2 = decision;
    else rec.decision = decision;
    lib.records[i] = rec;
  } else {
    lib.identified += 1;
    lib.records.push({
      ...base,
      id: key,
      decision: reviewer === 2 ? 'unscreened' : decision,
      decision2: reviewer === 2 ? decision : undefined,
      addedAt: now,
    });
  }
  saveLibrary(lib);
  return lib;
}

// Bulk import (RIS / PubMed): every parsed reference counts toward `identified`;
// unique ones are added as unscreened. Returns { lib, added, duplicates }.
export function importRecords(
  bases: RecordBase[],
  now: number = Date.now()
): { lib: Library; added: number; duplicates: number } {
  const lib = loadLibrary();
  let added = 0;
  let duplicates = 0;
  for (const base of bases) {
    const key = recordKey(base);
    if (!key) continue;
    lib.identified += 1;
    if (lib.records.some((r) => recordKey(r) === key)) {
      duplicates += 1;
      continue;
    }
    lib.records.push({ ...base, id: key, decision: 'unscreened', addedAt: now });
    added += 1;
  }
  saveLibrary(lib);
  return { lib, added, duplicates };
}

export function updateRecord(
  id: string,
  patch: Partial<Pick<LibraryRecord, 'decision' | 'decision2' | 'reason'>>
): Library {
  const lib = loadLibrary();
  const i = lib.records.findIndex((r) => r.id === id);
  if (i >= 0) {
    lib.records[i] = { ...lib.records[i], ...patch };
    saveLibrary(lib);
  }
  return lib;
}

// Set the decision for a specific reviewer on an existing record.
export function setDecisionFor(
  id: string,
  reviewer: Reviewer,
  decision: Decision
): Library {
  return updateRecord(
    id,
    reviewer === 2 ? { decision2: decision } : { decision }
  );
}

// Cohen's κ between the two reviewers over records both have screened
// (decisions other than "unscreened").
export type KappaResult = {
  n: number;
  agreement: number | null;
  kappa: number | null;
  conflicts: number;
};

export function cohensKappa(lib: Library): KappaResult {
  const cats: Decision[] = ['include', 'maybe', 'exclude'];
  const both = lib.records.filter(
    (r) =>
      r.decision &&
      r.decision !== 'unscreened' &&
      r.decision2 &&
      r.decision2 !== 'unscreened'
  );
  const n = both.length;
  if (n === 0) return { n: 0, agreement: null, kappa: null, conflicts: 0 };
  let agree = 0;
  const c1: Record<string, number> = { include: 0, maybe: 0, exclude: 0 };
  const c2: Record<string, number> = { include: 0, maybe: 0, exclude: 0 };
  for (const r of both) {
    if (r.decision === r.decision2) agree += 1;
    c1[r.decision] += 1;
    c2[r.decision2 as Decision] += 1;
  }
  const po = agree / n;
  let pe = 0;
  for (const c of cats) pe += (c1[c] / n) * (c2[c] / n);
  const kappa = pe === 1 ? 1 : (po - pe) / (1 - pe);
  return { n, agreement: po, kappa, conflicts: n - agree };
}

export function removeRecord(id: string): Library {
  const lib = loadLibrary();
  lib.records = lib.records.filter((r) => r.id !== id);
  saveLibrary(lib);
  return lib;
}

export function clearLibrary(): Library {
  const empty: Library = { records: [], identified: 0 };
  saveLibrary(empty);
  return empty;
}

export type PrismaCounts = {
  identified: number;
  duplicatesRemoved: number;
  screened: number;
  included: number;
  excluded: number;
  maybe: number;
  unscreened: number;
};

export function prismaCounts(lib: Library): PrismaCounts {
  const screened = lib.records.length;
  const by = (d: Decision) => lib.records.filter((r) => r.decision === d).length;
  return {
    identified: Math.max(lib.identified, screened),
    duplicatesRemoved: Math.max(0, lib.identified - screened),
    screened,
    included: by('include'),
    excluded: by('exclude'),
    maybe: by('maybe'),
    unscreened: by('unscreened'),
  };
}

// CSV of the library for hand-off to reference managers / Covidence / Rayyan.
export function toCSV(lib: Library): string {
  const cols: (keyof LibraryRecord)[] = [
    'decision',
    'decision2',
    'reason',
    'title',
    'authors',
    'year',
    'source',
    'doi',
    'pmid',
    'url',
  ];
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.join(',');
  const rows = lib.records.map((r) => cols.map((c) => esc(r[c])).join(','));
  return [head, ...rows].join('\n');
}
