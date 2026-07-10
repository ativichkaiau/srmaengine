// Multi-source literature search. Both endpoints are open (no API key)
// and serve permissive CORS headers, so the browser can fetch directly.

export type Source = 'europepmc' | 'openalex';

export type SearchResult = {
  id: string;
  source: Source;
  sources: Source[]; // every source this record was found in (corroboration)
  title: string;
  abstract: string;
  authors?: string;
  year?: number | string;
  doi?: string;
  pmid?: string;
  url?: string;
  journal?: string;
  type?: string; // work type (journal-article, review, preprint, …)
  isOA?: boolean; // open access
  citedBy?: number; // citation count (OpenAlex)
  relevance?: number; // 0–100 relevance to the query (computed client-side)
};

// A source fetch returns the page of results plus the total available upstream,
// so the UI can be honest about how much was retrieved vs. how much exists.
export type SourcePage = {
  results: SearchResult[];
  total: number;
};

export type MatchMode = 'all' | 'any';

export type FetchOptions = {
  page?: number; // 1-based
  pageSize?: number;
  synonym?: boolean; // Europe PMC MeSH/term expansion (recall)
  fromYear?: number; // only include works published on/after this year
  excludeReviews?: boolean; // drop review / editorial article types
  openAccessOnly?: boolean; // only open-access works
  signal?: AbortSignal;
};

const DEFAULT_TIMEOUT_MS = 15000;

// Fetch with a timeout and a single retry on transient network/5xx failure.
async function robustFetch(
  url: string,
  external?: AbortSignal
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
    const onAbort = () => ctrl.abort();
    external?.addEventListener('abort', onAbort);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (res.status >= 500 && attempt === 0) {
        lastErr = new Error(`${res.status} ${res.statusText}`);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (external?.aborted) throw err; // user cancelled — don't retry
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Network error');
}

const safeJson = async (res: Response): Promise<unknown> => {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
};

// --- Narrow types for the parts of each API response we actually read ---

type EuropePMCEntry = {
  id?: string;
  source?: string;
  pmid?: string;
  doi?: string;
  title?: string;
  abstractText?: string;
  authorString?: string;
  pubYear?: string | number;
  journalTitle?: string;
  pubType?: string;
  isOpenAccess?: string; // "Y" | "N"
  citedByCount?: number;
  bookOrReportDetails?: { publisher?: string };
};

type EuropePMCResponse = {
  hitCount?: number;
  resultList?: { result?: EuropePMCEntry[] };
};

type OpenAlexAuthorship = { author?: { display_name?: string } };

type OpenAlexEntry = {
  id?: string;
  doi?: string;
  title?: string;
  display_name?: string;
  abstract_inverted_index?: Record<string, number[]> | null;
  authorships?: OpenAlexAuthorship[];
  publication_year?: number;
  ids?: { doi?: string; pmid?: string };
  primary_location?: { source?: { display_name?: string } };
  open_access?: { is_oa?: boolean };
  cited_by_count?: number;
  type?: string;
};

type OpenAlexResponse = {
  results?: OpenAlexEntry[];
  meta?: { count?: number };
};

// Europe PMC indexes PubMed, PMC, and others. resultType=core returns abstracts;
// synonym=true expands query terms with MeSH synonyms for higher recall.
export async function searchEuropePMC(
  query: string,
  opts: FetchOptions = {}
): Promise<SourcePage> {
  const {
    page = 1,
    pageSize = 25,
    synonym = false,
    fromYear,
    excludeReviews,
    openAccessOnly,
    signal,
  } = opts;
  // Fold source-side filters into the query string (Europe PMC field syntax).
  let q = query;
  if (fromYear && fromYear > 1500)
    q += ` AND (PUB_YEAR:[${fromYear} TO 3000])`;
  if (openAccessOnly) q += ' AND (OPEN_ACCESS:y)';
  if (excludeReviews)
    q += ' NOT (PUB_TYPE:"Review" OR PUB_TYPE:"review-article" OR PUB_TYPE:"Editorial")';
  const url = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
  url.searchParams.set('query', q);
  url.searchParams.set('format', 'json');
  url.searchParams.set('resultType', 'core');
  url.searchParams.set('pageSize', String(pageSize));
  url.searchParams.set('page', String(page));
  url.searchParams.set('synonym', synonym ? 'true' : 'false');
  const data = (await safeJson(await robustFetch(url.toString(), signal))) as EuropePMCResponse;
  const list = data?.resultList?.result ?? [];
  const results = list.map((r) => ({
    id: `epmc:${r.source ?? ''}/${r.id ?? r.pmid ?? r.doi ?? r.title ?? ''}`,
    source: 'europepmc' as Source,
    sources: ['europepmc'] as Source[],
    title: r.title || '',
    abstract: r.abstractText || '',
    authors: r.authorString,
    year: r.pubYear,
    doi: r.doi,
    pmid: r.pmid,
    journal: r.journalTitle || r.bookOrReportDetails?.publisher,
    type: r.pubType,
    isOA: r.isOpenAccess === 'Y',
    citedBy: typeof r.citedByCount === 'number' ? r.citedByCount : undefined,
    url: r.doi
      ? `https://doi.org/${r.doi}`
      : r.pmid
      ? `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`
      : undefined,
  })) as SearchResult[];
  return { results, total: data?.hitCount ?? results.length };
}

// OpenAlex returns inverted-index abstracts; reconstruct to plain text.
function reconstructAbstract(inv: Record<string, number[]> | null | undefined) {
  if (!inv) return '';
  const positions: Array<[number, string]> = [];
  for (const word of Object.keys(inv)) {
    for (const p of inv[word]) positions.push([p, word]);
  }
  positions.sort((a, b) => a[0] - b[0]);
  return positions.map(([, w]) => w).join(' ');
}

// Only request the fields we actually read — smaller, faster payloads.
const OPENALEX_SELECT = [
  'id',
  'doi',
  'title',
  'display_name',
  'publication_year',
  'authorships',
  'primary_location',
  'ids',
  'abstract_inverted_index',
  'open_access',
  'cited_by_count',
  'type',
].join(',');

export async function searchOpenAlex(
  query: string,
  opts: FetchOptions = {}
): Promise<SourcePage> {
  const {
    page = 1,
    pageSize = 25,
    fromYear,
    excludeReviews,
    openAccessOnly,
    signal,
  } = opts;
  const url = new URL('https://api.openalex.org/works');
  url.searchParams.set('search', query);
  url.searchParams.set('per-page', String(Math.min(pageSize, 50)));
  url.searchParams.set('page', String(page));
  url.searchParams.set('select', OPENALEX_SELECT);
  // Source-side filters via OpenAlex's structured `filter` param.
  const filters: string[] = [];
  if (fromYear && fromYear > 1500)
    filters.push(`from_publication_date:${fromYear}-01-01`);
  if (openAccessOnly) filters.push('is_oa:true');
  if (excludeReviews) filters.push('type:!review');
  if (filters.length) url.searchParams.set('filter', filters.join(','));
  // Be a good citizen — OpenAlex asks for a mailto for the polite pool.
  url.searchParams.set('mailto', 'vestrippn@research.local');
  const data = (await safeJson(await robustFetch(url.toString(), signal))) as OpenAlexResponse;
  const list = data?.results ?? [];
  const results = list.map((w) => {
    const doiRaw: string | undefined = w.doi || w.ids?.doi;
    const doi = doiRaw ? doiRaw.replace(/^https?:\/\/doi\.org\//, '') : undefined;
    const pmid = w.ids?.pmid
      ? String(w.ids.pmid).replace(/^.*\//, '')
      : undefined;
    return {
      id: `oax:${w.id || ''}`,
      source: 'openalex' as Source,
      sources: ['openalex'] as Source[],
      title: w.title || w.display_name || '',
      abstract: reconstructAbstract(w.abstract_inverted_index),
      authors: (w.authorships ?? [])
        .map((a) => a.author?.display_name)
        .filter((s): s is string => !!s)
        .slice(0, 6)
        .join(', '),
      year: w.publication_year,
      doi,
      pmid,
      journal: w.primary_location?.source?.display_name,
      type: w.type,
      isOA: w.open_access?.is_oa,
      citedBy: typeof w.cited_by_count === 'number' ? w.cited_by_count : undefined,
      url: doiRaw
        ? doiRaw.startsWith('http')
          ? doiRaw
          : `https://doi.org/${doi}`
        : w.id,
    };
  }) as SearchResult[];
  return { results, total: data?.meta?.count ?? results.length };
}

const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

// Stable dedupe key: DOI > PMID > normalized title.
function dedupeKey(r: SearchResult): string {
  if (r.doi) return `doi:${r.doi.toLowerCase()}`;
  if (r.pmid) return `pmid:${r.pmid}`;
  if (r.title) return `t:${norm(r.title)}`;
  return r.id;
}

// Merge two records for the same work found in different sources: union the
// sources, keep the richer abstract, and coalesce metadata / max citation count.
function mergeRecords(a: SearchResult, b: SearchResult): SearchResult {
  const richer = (b.abstract?.length || 0) > (a.abstract?.length || 0) ? b : a;
  const other = richer === a ? b : a;
  const sources = Array.from(new Set([...a.sources, ...b.sources]));
  return {
    ...richer,
    id: a.id, // keep first-seen id stable for React keys
    sources,
    doi: richer.doi || other.doi,
    pmid: richer.pmid || other.pmid,
    year: richer.year ?? other.year,
    journal: richer.journal || other.journal,
    type: richer.type || other.type,
    authors: richer.authors || other.authors,
    url: richer.url || other.url,
    isOA: richer.isOA || other.isOA,
    citedBy: Math.max(a.citedBy ?? 0, b.citedBy ?? 0) || undefined,
  };
}

// Merge results from multiple sources; records found in more than one source
// are combined (and carry all their source tags).
export function dedupe(lists: SearchResult[][]): SearchResult[] {
  const seen = new Map<string, SearchResult>();
  const order: string[] = [];
  for (const list of lists) {
    for (const r of list) {
      const key = dedupeKey(r);
      if (!key) continue;
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, r);
        order.push(key);
      } else {
        seen.set(key, mergeRecords(existing, r));
      }
    }
  }
  // Preserve first-appearance order.
  return order.map((k) => seen.get(k)!).filter(Boolean);
}

// Build a query string from inclusion keywords.
//   'all'  → concepts joined with AND  (precise / higher specificity)
//   'any'  → concepts joined with OR   (broad / higher recall)
// `negative` terms, when supplied, are appended as a NOT (…) clause so obvious
// noise is filtered at the source.
export function buildQueryFromKeywords(
  positive: string[],
  matchMode: MatchMode = 'all',
  negative: string[] = []
): string {
  const quote = (w: string) => (/\s/.test(w) ? `"${w}"` : w);
  const terms = positive
    .map((w) => w.trim())
    .filter(Boolean)
    .map(quote)
    .slice(0, 12);
  if (terms.length === 0) return '';
  let q = terms.join(matchMode === 'any' ? ' OR ' : ' AND ');
  const neg = negative.map((w) => w.trim()).filter(Boolean).map(quote).slice(0, 8);
  if (neg.length) q += ` NOT (${neg.join(' OR ')})`;
  return q;
}

// --- Relevance engine -----------------------------------------------------
// Extract the concept terms from a query string (quoted phrases + bare words),
// stripping boolean operators, field prefixes, and punctuation.
export function queryTerms(query: string): string[] {
  const phrases = [...query.matchAll(/"([^"]+)"/g)].map((m) =>
    m[1].toLowerCase().trim()
  );
  const rest = query
    .replace(/"[^"]+"/g, ' ')
    .replace(/\b(AND|OR|NOT)\b/gi, ' ')
    .replace(/[A-Z_]+:/g, ' ') // field prefixes like PUB_YEAR:
    .replace(/[()[\]]/g, ' ');
  const words = rest
    .split(/\s+/)
    .map((s) => s.toLowerCase().trim())
    .filter((s) => s.length > 2 && !/^\d+$/.test(s));
  return Array.from(new Set([...phrases, ...words])).slice(0, 20);
}

// Score a result 0–100 for how well it matches the query: term coverage over
// title + abstract (title weighted), plus mild recency and citation boosts.
// This re-ranks the two sources by intent, which neither API does across both.
export function relevanceScore(
  r: Pick<SearchResult, 'title' | 'abstract' | 'year' | 'citedBy'>,
  terms: string[],
  currentYear = 2026
): number {
  if (terms.length === 0) return 0;
  const title = (r.title || '').toLowerCase();
  const abs = (r.abstract || '').toLowerCase();
  let covered = 0;
  let titleHits = 0;
  for (const t of terms) {
    const inTitle = title.includes(t);
    const inAbs = abs.includes(t);
    if (inTitle || inAbs) covered += 1;
    if (inTitle) titleHits += 1;
  }
  const coverage = covered / terms.length; // 0..1
  const titleBoost = titleHits / terms.length; // 0..1
  const y = Number(r.year) || 0;
  const recency = y
    ? Math.max(0, Math.min(1, (y - (currentYear - 15)) / 15))
    : 0.3;
  const cites = r.citedBy || 0;
  const citeBoost = Math.min(1, Math.log10(cites + 1) / 3); // ~1000 cites → 1
  const score =
    0.55 * coverage + 0.2 * titleBoost + 0.15 * recency + 0.1 * citeBoost;
  return Math.round(score * 100);
}
