// Multi-source literature search. Both endpoints are open (no API key)
// and serve permissive CORS headers, so the browser can fetch directly.

export type Source = 'europepmc' | 'openalex';

export type SearchResult = {
  id: string;
  source: Source;
  title: string;
  abstract: string;
  authors?: string;
  year?: number | string;
  doi?: string;
  pmid?: string;
  url?: string;
  journal?: string;
};

const safeJson = async (res: Response): Promise<unknown> => {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
};

// --- Narrow types for the parts of each API response we actually read ---

type EuropePMCEntry = {
  id?: string;
  pmid?: string;
  doi?: string;
  title?: string;
  abstractText?: string;
  authorString?: string;
  pubYear?: string | number;
  journalTitle?: string;
  bookOrReportDetails?: { publisher?: string };
};

type EuropePMCResponse = {
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
};

type OpenAlexResponse = { results?: OpenAlexEntry[] };

// Europe PMC indexes PubMed, PMC, and others. ResultType=core returns abstracts.
export async function searchEuropePMC(
  query: string,
  pageSize = 25
): Promise<SearchResult[]> {
  const url = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
  url.searchParams.set('query', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('resultType', 'core');
  url.searchParams.set('pageSize', String(pageSize));
  const data = (await safeJson(await fetch(url.toString()))) as EuropePMCResponse;
  const list = data?.resultList?.result ?? [];
  return list.map((r) => ({
    id: r.id || r.pmid || r.doi || r.title || '',
    source: 'europepmc' as Source,
    title: r.title || '',
    abstract: r.abstractText || '',
    authors: r.authorString,
    year: r.pubYear,
    doi: r.doi,
    pmid: r.pmid,
    journal: r.journalTitle || r.bookOrReportDetails?.publisher,
    url: r.doi
      ? `https://doi.org/${r.doi}`
      : r.pmid
      ? `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`
      : undefined,
  })) as SearchResult[];
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

export async function searchOpenAlex(
  query: string,
  pageSize = 25
): Promise<SearchResult[]> {
  const url = new URL('https://api.openalex.org/works');
  url.searchParams.set('search', query);
  url.searchParams.set('per-page', String(Math.min(pageSize, 50)));
  // Be a good citizen — OpenAlex asks for a mailto for the polite pool.
  url.searchParams.set('mailto', 'vestrippn@research.local');
  const data = (await safeJson(await fetch(url.toString()))) as OpenAlexResponse;
  const list = data?.results ?? [];
  return list.map((w) => {
    const doiRaw: string | undefined = w.doi || w.ids?.doi;
    const doi = doiRaw ? doiRaw.replace(/^https?:\/\/doi\.org\//, '') : undefined;
    const pmid = w.ids?.pmid
      ? String(w.ids.pmid).replace(/^.*\//, '')
      : undefined;
    return {
      id: w.id || '',
      source: 'openalex' as Source,
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
      url: doiRaw || w.id,
    };
  }) as SearchResult[];
}

const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

// Merge results from multiple sources, deduping by DOI > PMID > normalized title.
export function dedupe(lists: SearchResult[][]): SearchResult[] {
  const seen = new Map<string, SearchResult>();
  for (const list of lists) {
    for (const r of list) {
      const key =
        (r.doi && `doi:${r.doi.toLowerCase()}`) ||
        (r.pmid && `pmid:${r.pmid}`) ||
        (r.title && `t:${norm(r.title)}`) ||
        r.id;
      if (!key) continue;
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, r);
      } else {
        // Prefer the entry with a longer abstract; keep both source ids.
        if ((r.abstract?.length || 0) > (existing.abstract?.length || 0)) {
          seen.set(key, { ...r, id: existing.id });
        }
      }
    }
  }
  return [...seen.values()];
}

// Sensibly construct a query string from a list of inclusion keywords.
export function buildQueryFromKeywords(positive: string[]): string {
  if (positive.length === 0) return '';
  // Quote multi-word terms; join with AND for relevance.
  return positive
    .map((w) => (w.includes(' ') ? `"${w}"` : w))
    .slice(0, 8) // cap so the URL doesn't blow up
    .join(' AND ');
}
