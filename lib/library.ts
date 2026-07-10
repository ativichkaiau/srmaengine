// Screening library — persists include/exclude/maybe decisions across the
// Scanner and Research tabs, and derives PRISMA-style counts. Per-browser
// localStorage; no backend.

export type Decision = 'include' | 'exclude' | 'maybe' | 'unscreened';

export type LibraryRecord = {
  id: string; // stable key (doi/pmid/normalized-title)
  title: string;
  authors?: string;
  year?: number | string;
  doi?: string;
  pmid?: string;
  url?: string;
  source?: string; // e.g. "Europe PMC", "OpenAlex", "Scanner"
  decision: Decision;
  reason?: string;
  addedAt: number;
};

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

// Add or update a record with a decision. Counts every attempt toward
// `identified` (so re-adding the same paper registers as a duplicate).
export function addRecord(
  rec: Omit<LibraryRecord, 'addedAt'>,
  now: number = Date.now()
): Library {
  const lib = loadLibrary();
  const key = recordKey(rec);
  lib.identified += 1;
  const existing = lib.records.findIndex((r) => recordKey(r) === key);
  if (existing >= 0) {
    lib.records[existing] = {
      ...lib.records[existing],
      ...rec,
      addedAt: lib.records[existing].addedAt,
    };
  } else {
    lib.records.push({ ...rec, addedAt: now });
  }
  saveLibrary(lib);
  return lib;
}

export function updateRecord(
  id: string,
  patch: Partial<Pick<LibraryRecord, 'decision' | 'reason'>>
): Library {
  const lib = loadLibrary();
  const i = lib.records.findIndex((r) => r.id === id);
  if (i >= 0) {
    lib.records[i] = { ...lib.records[i], ...patch };
    saveLibrary(lib);
  }
  return lib;
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
