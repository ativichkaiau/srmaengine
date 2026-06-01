'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import {
  classifyAbstract,
  loadProtocol,
  type Classification,
  type StoredProtocol,
  type Verdict,
} from '@/lib/pico';
import {
  buildQueryFromKeywords,
  dedupe,
  searchEuropePMC,
  searchOpenAlex,
  type SearchResult,
  type Source,
} from '@/lib/search';

type Hit = SearchResult & { classification: Classification };

type SourceStatus = {
  loading: boolean;
  count: number;
  error?: string;
};

const SOURCE_META: Record<Source, { label: string; short: string; tone: string }> = {
  europepmc: {
    label: 'Europe PMC',
    short: 'EPMC',
    tone:
      'text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/15 border-blue-200 dark:border-blue-500/30',
  },
  openalex: {
    label: 'OpenAlex',
    short: 'OAX',
    tone:
      'text-purple-600 dark:text-purple-300 bg-purple-50 dark:bg-purple-500/15 border-purple-200 dark:border-purple-500/30',
  },
};

const VERDICT_TONE: Record<Verdict, string> = {
  'INCLUDE / MAYBE':
    'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30',
  UNCLEAR:
    'bg-yellow-50 dark:bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-500/30',
  EXCLUDE:
    'bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30',
  NO_CRITERIA:
    'bg-neutral-100 dark:bg-white/10 text-neutral-700 dark:text-slate-300 border-black/10 dark:border-white/15',
};

const VERDICT_LABEL: Record<Verdict, string> = {
  'INCLUDE / MAYBE': '🟩 Include / Maybe',
  UNCLEAR: '⚠️ Unclear',
  EXCLUDE: '🚩 Exclude',
  NO_CRITERIA: '⚙ No criteria',
};

const VERDICT_ORDER: Record<Verdict, number> = {
  'INCLUDE / MAYBE': 0,
  UNCLEAR: 1,
  NO_CRITERIA: 2,
  EXCLUDE: 3,
};

function highlightAbstract(
  text: string,
  positives: string[],
  negatives: string[],
  limit = 320
) {
  if (!text) return null;
  const truncated = text.length > limit ? text.slice(0, limit).trimEnd() + '…' : text;
  const all = [...positives, ...negatives].sort((a, b) => b.length - a.length);
  if (all.length === 0) return truncated;
  const pattern = all.map((w) => w.replace(/\s+/g, '\\s+')).join('|');
  const regex = new RegExp(`\\b(${pattern})\\b`, 'gi');
  const parts = truncated.split(regex);
  return parts.map((part, i) => {
    if (!part) return null;
    const lower = part.toLowerCase().replace(/\s+/g, ' ');
    if (positives.some((p) => p.toLowerCase() === lower)) {
      return (
        <mark
          key={i}
          className="bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 px-0.5 rounded"
        >
          {part}
        </mark>
      );
    }
    if (negatives.some((n) => n.toLowerCase() === lower)) {
      return (
        <mark
          key={i}
          className="bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-300 px-0.5 rounded"
        >
          {part}
        </mark>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export default function ResearchPage() {
  // --- Protocol hydration (same store the scanner uses) ---
  const [protocol, setProtocol] = useState<StoredProtocol>(() => loadProtocol());

  // --- Query controls ---
  const [query, setQuery] = useState<string>(() =>
    buildQueryFromKeywords(loadProtocol().positive)
  );
  const [pageSize, setPageSize] = useState(25);
  const [enabled, setEnabled] = useState<Record<Source, boolean>>({
    europepmc: true,
    openalex: true,
  });

  // --- Result state ---
  const [hits, setHits] = useState<Hit[]>([]);
  const [status, setStatus] = useState<Record<Source, SourceStatus>>({
    europepmc: { loading: false, count: 0 },
    openalex: { loading: false, count: 0 },
  });
  const [overallError, setOverallError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Verdict | 'ALL'>('ALL');
  const [hasSearched, setHasSearched] = useState(false);

  // Pick up protocol changes if the user edits criteria in another tab.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'srma-protocol-v1') setProtocol(loadProtocol());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const noCriteria =
    protocol.positive.length === 0 && protocol.negative.length === 0;

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setOverallError(null);
    setHasSearched(true);
    setHits([]);
    setStatus({
      europepmc: { loading: enabled.europepmc, count: 0 },
      openalex: { loading: enabled.openalex, count: 0 },
    });

    const calls: Array<Promise<{ source: Source; results: SearchResult[] }>> = [];
    if (enabled.europepmc) {
      calls.push(
        searchEuropePMC(q, pageSize)
          .then((results) => ({ source: 'europepmc' as Source, results }))
          .catch((err) => {
            setStatus((s) => ({
              ...s,
              europepmc: { loading: false, count: 0, error: String(err.message || err) },
            }));
            return { source: 'europepmc' as Source, results: [] };
          })
      );
    }
    if (enabled.openalex) {
      calls.push(
        searchOpenAlex(q, pageSize)
          .then((results) => ({ source: 'openalex' as Source, results }))
          .catch((err) => {
            setStatus((s) => ({
              ...s,
              openalex: { loading: false, count: 0, error: String(err.message || err) },
            }));
            return { source: 'openalex' as Source, results: [] };
          })
      );
    }

    if (calls.length === 0) {
      setOverallError('Select at least one source.');
      return;
    }

    const settled = await Promise.all(calls);
    const lists: SearchResult[][] = [];
    for (const { source, results } of settled) {
      lists.push(results);
      setStatus((s) => ({
        ...s,
        [source]: { loading: false, count: results.length, error: s[source].error },
      }));
    }
    const merged = dedupe(lists);

    const classified: Hit[] = merged.map((r) => {
      const text = `${r.title}\n${r.abstract}`;
      return {
        ...r,
        classification: classifyAbstract(text, protocol.positive, protocol.negative),
      };
    });

    classified.sort((a, b) => {
      const v = VERDICT_ORDER[a.classification.verdict] - VERDICT_ORDER[b.classification.verdict];
      if (v !== 0) return v;
      return b.classification.score - a.classification.score;
    });

    setHits(classified);
  };

  const filtered = useMemo(() => {
    if (filter === 'ALL') return hits;
    return hits.filter((h) => h.classification.verdict === filter);
  }, [hits, filter]);

  const counts = useMemo(() => {
    const c: Record<Verdict | 'ALL', number> = {
      ALL: hits.length,
      'INCLUDE / MAYBE': 0,
      UNCLEAR: 0,
      EXCLUDE: 0,
      NO_CRITERIA: 0,
    };
    for (const h of hits) c[h.classification.verdict] += 1;
    return c;
  }, [hits]);

  const anyLoading = status.europepmc.loading || status.openalex.loading;

  return (
    <div className="min-h-screen flex flex-col bg-[#FAFAFA] dark:bg-[#050505] text-neutral-900 dark:text-neutral-100 relative overflow-hidden font-sans selection:bg-[#00A598]/30 transition-colors duration-700">
      {/* atmosphere blobs */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="blob-a absolute top-[-12%] right-[6%] w-[60%] h-[60%] bg-gradient-to-br from-blue-400/25 to-purple-400/25 dark:from-blue-600/18 dark:to-[#00A598]/12 rounded-full blur-[130px] mix-blend-multiply dark:mix-blend-screen opacity-80 dark:opacity-70"></div>
        <div className="blob-b absolute bottom-[-12%] left-[2%] w-[52%] h-[52%] bg-gradient-to-tr from-pink-400/25 to-teal-300/25 dark:from-purple-600/14 dark:to-teal-600/14 rounded-full blur-[130px] mix-blend-multiply dark:mix-blend-screen opacity-80 dark:opacity-55"></div>
        <div className="blob-c absolute top-1/2 left-1/2 w-[46%] h-[46%] bg-gradient-to-br from-[#00A598]/22 to-blue-300/20 dark:from-[#00A598]/14 dark:to-blue-500/10 rounded-full blur-[120px] mix-blend-multiply dark:mix-blend-screen opacity-70 dark:opacity-50"></div>
      </div>

      {/* shared style block (mirrors main page essentials so this route stands alone) */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes blobDriftA {
          0%, 100% { transform: translate(0,0) scale(1); }
          50% { transform: translate(36px, 28px) scale(1.12); }
        }
        @keyframes blobDriftB {
          0%, 100% { transform: translate(0,0) scale(1); }
          50% { transform: translate(-44px, -26px) scale(1.08); }
        }
        @keyframes blobDriftC {
          0%, 100% { transform: translate(-50%, -50%) scale(1); }
          50% { transform: translate(-46%, -56%) scale(1.18); }
        }
        .blob-a { animation: blobDriftA 16s ease-in-out infinite; }
        .blob-b { animation: blobDriftB 20s ease-in-out infinite; }
        .blob-c { animation: blobDriftC 24s ease-in-out infinite; }

        .glass {
          background: linear-gradient(155deg, rgba(255,255,255,0.78), rgba(255,255,255,0.42));
          backdrop-filter: blur(26px) saturate(180%);
          -webkit-backdrop-filter: blur(26px) saturate(180%);
          border: 1px solid rgba(255,255,255,0.65);
          box-shadow: 0 12px 40px -12px rgba(15,23,42,0.18), inset 0 1px 0 rgba(255,255,255,0.85);
        }
        .dark .glass {
          background: linear-gradient(155deg, rgba(255,255,255,0.08), rgba(255,255,255,0.015));
          border: 1px solid rgba(255,255,255,0.10);
          box-shadow: 0 20px 50px -16px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08);
        }
        .glass-soft {
          background: linear-gradient(155deg, rgba(255,255,255,0.7), rgba(255,255,255,0.4));
          backdrop-filter: blur(18px) saturate(160%);
          -webkit-backdrop-filter: blur(18px) saturate(160%);
          border: 1px solid rgba(255,255,255,0.6);
          box-shadow: 0 6px 22px -10px rgba(15,23,42,0.14), inset 0 1px 0 rgba(255,255,255,0.7);
        }
        .dark .glass-soft {
          background: linear-gradient(155deg, rgba(255,255,255,0.06), rgba(255,255,255,0.012));
          border: 1px solid rgba(255,255,255,0.08);
          box-shadow: 0 10px 30px -12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06);
        }

        @keyframes scanShimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .scan-shimmer::after {
          content: '';
          position: absolute; inset: 0;
          background: linear-gradient(90deg, transparent, rgba(0,165,152,0.35), transparent);
          animation: scanShimmer 1.4s linear infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .blob-a, .blob-b, .blob-c, .scan-shimmer::after { animation: none !important; }
        }
      `}} />

      {/* Header */}
      <header className="h-[64px] lg:h-[72px] flex items-center justify-between px-4 lg:px-8 shrink-0 bg-white/60 dark:bg-black/40 backdrop-blur-2xl z-50 border-b border-black/5 dark:border-white/5 transition-colors duration-700">
        <div className="flex items-center gap-4 lg:gap-8">
          <Link href="/" className="font-black text-[18px] lg:text-[20px] tracking-tighter flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="w-7 h-7 bg-neutral-900 dark:bg-white text-white dark:text-black rounded-lg flex items-center justify-center text-[14px]">V</div>
            <div className="flex items-baseline">
              <span>VESTRIPPN</span>
              <span className="text-blue-600 dark:text-blue-400">3.0</span>
            </div>
          </Link>
          <nav className="hidden sm:flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest">
            <Link href="/" className="px-3 py-1.5 rounded-lg text-neutral-500 dark:text-slate-400 hover:text-neutral-900 dark:hover:text-white transition-colors">Scanner</Link>
            <span className="px-3 py-1.5 rounded-lg bg-[#00A598]/10 text-[#00A598] border border-[#00A598]/30">Research</span>
          </nav>
        </div>
        <div className="flex gap-4 lg:gap-6 items-center">
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-5 lg:p-8 pb-32 lg:pb-8 relative z-10">
        <div className="max-w-[1100px] mx-auto space-y-6 lg:space-y-8">

          {/* HERO */}
          <section className="flex flex-col items-center text-center pt-6 sm:pt-8 pb-2">
            <h1 className="font-black tracking-tighter leading-none mb-3 text-[24px] sm:text-[32px] lg:text-[40px] flex items-center gap-3 flex-wrap justify-center">
              <span className="text-neutral-900 dark:text-white leading-none">
                SRMA
              </span>
              <span className="text-transparent bg-clip-text bg-gradient-to-br from-neutral-900 to-neutral-500 dark:from-white dark:to-neutral-500">
                Multi-Source Search
              </span>
            </h1>
            <p className="max-w-2xl font-mono text-[10px] sm:text-[11px] text-neutral-500 dark:text-neutral-400 uppercase tracking-[0.3em]">
              Europe PMC{' + '}OpenAlex{' // '}
              <span className="text-[#00A598] font-bold">Auto-classify against your PICO</span>
            </p>
          </section>

          {/* Protocol summary */}
          <div className="glass-soft p-5 rounded-2xl flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[11px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-400">Active Protocol</span>
              <span className="inline-flex items-center gap-1.5 text-[12px] font-bold bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 rounded-lg px-2.5 py-1">
                Inclusion ({protocol.positive.length})
              </span>
              <span className="inline-flex items-center gap-1.5 text-[12px] font-bold bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-500/30 rounded-lg px-2.5 py-1">
                Exclusion ({protocol.negative.length})
              </span>
              {noCriteria && (
                <span className="text-[11px] text-yellow-700 dark:text-yellow-400 italic">
                  No criteria yet — results won&apos;t be classified until you add some.
                </span>
              )}
            </div>
            <Link
              href="/"
              className="text-[11px] font-bold uppercase tracking-widest text-[#00A598] hover:underline"
            >
              ↩ Edit on Scanner
            </Link>
          </div>

          {/* Query controls */}
          <div className="glass p-6 rounded-2xl space-y-5 relative">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h2 className="font-bold text-[15px] tracking-tight flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                Search Query
              </h2>
              <button
                onClick={() => setQuery(buildQueryFromKeywords(protocol.positive))}
                className="text-[10px] font-bold uppercase tracking-widest text-neutral-500 dark:text-slate-400 hover:text-[#00A598] transition-colors"
              >
                ↻ Reset from Protocol
              </button>
            </div>

            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='e.g.  "vaginal estrogen" AND "recurrent urinary tract infection"'
              className="w-full h-20 p-4 bg-white/70 dark:bg-black/30 backdrop-blur-md border border-black/10 dark:border-white/10 rounded-xl text-[13px] font-mono text-neutral-700 dark:text-slate-200 focus:border-[#00A598] focus:ring-2 focus:ring-[#00A598]/25 focus:outline-none transition-all resize-none custom-scrollbar"
            />

            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-neutral-500 dark:text-slate-400">Sources</label>
                {(Object.keys(SOURCE_META) as Source[]).map((src) => (
                  <button
                    key={src}
                    onClick={() => setEnabled((e) => ({ ...e, [src]: !e[src] }))}
                    className={`px-3 py-1.5 text-[11px] font-bold rounded-lg border transition-all ${
                      enabled[src]
                        ? SOURCE_META[src].tone
                        : 'bg-white/30 dark:bg-white/5 text-neutral-400 dark:text-slate-500 border-black/10 dark:border-white/10'
                    }`}
                  >
                    {enabled[src] ? '✓ ' : ''}
                    {SOURCE_META[src].label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-neutral-500 dark:text-slate-400">
                  Limit / source
                </label>
                <input
                  type="number"
                  min={5}
                  max={50}
                  value={pageSize}
                  onChange={(e) => setPageSize(Math.max(5, Math.min(50, +e.target.value || 25)))}
                  className="w-16 px-2 py-1.5 text-[12px] font-bold bg-white/70 dark:bg-black/30 border border-black/10 dark:border-white/10 rounded-lg text-center focus:outline-none focus:border-[#00A598]"
                />
              </div>

              <button
                onClick={handleSearch}
                disabled={!query.trim() || anyLoading || (!enabled.europepmc && !enabled.openalex)}
                className="ml-auto group relative px-5 py-2.5 overflow-hidden bg-gradient-to-r from-[#00A598] via-[#00b3a5] to-[#0098b8] hover:from-[#009085] hover:to-[#0087a5] disabled:from-neutral-200 disabled:via-neutral-200 disabled:to-neutral-200 dark:disabled:from-white/5 dark:disabled:via-white/5 dark:disabled:to-white/5 disabled:text-neutral-400 dark:disabled:text-slate-500 disabled:cursor-not-allowed text-white text-[13px] font-bold rounded-xl transition-all shadow-[0_6px_22px_-4px_rgba(0,165,152,0.5)] dark:shadow-[0_0_22px_rgba(0,165,152,0.35)] disabled:shadow-none active:scale-[0.98]"
              >
                <span className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out bg-gradient-to-r from-transparent via-white/25 to-transparent disabled:hidden"></span>
                <span className="relative">{anyLoading ? 'Fetching…' : 'Run Multi-Source Search'}</span>
              </button>
            </div>

            {/* Per-source status */}
            <div className="flex flex-wrap gap-2 text-[11px] font-mono">
              {(Object.keys(SOURCE_META) as Source[]).map((src) => {
                if (!enabled[src] && !status[src].count && !status[src].error) return null;
                const s = status[src];
                return (
                  <div
                    key={src}
                    className={`relative px-2.5 py-1 rounded-lg border overflow-hidden ${SOURCE_META[src].tone} ${
                      s.loading ? 'scan-shimmer' : ''
                    }`}
                  >
                    <span className="font-black mr-1.5">{SOURCE_META[src].short}</span>
                    {s.loading
                      ? 'searching…'
                      : s.error
                      ? `error: ${s.error.slice(0, 60)}`
                      : `${s.count} hit${s.count === 1 ? '' : 's'}`}
                  </div>
                );
              })}
            </div>
            {overallError && (
              <p className="text-[11px] text-red-600 dark:text-red-400">{overallError}</p>
            )}
          </div>

          {/* Filter chips + results */}
          {hasSearched && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {(['ALL', 'INCLUDE / MAYBE', 'UNCLEAR', 'EXCLUDE', 'NO_CRITERIA'] as const).map((k) => {
                  const n = counts[k];
                  if (k !== 'ALL' && n === 0) return null;
                  const active = filter === k;
                  const baseTone =
                    k === 'ALL'
                      ? 'bg-neutral-100 dark:bg-white/10 text-neutral-700 dark:text-slate-200 border-black/10 dark:border-white/15'
                      : VERDICT_TONE[k as Verdict];
                  return (
                    <button
                      key={k}
                      onClick={() => setFilter(k)}
                      className={`px-3 py-1.5 text-[11px] font-bold rounded-lg border transition-all ${baseTone} ${
                        active ? 'ring-2 ring-[#00A598]/40' : 'opacity-80 hover:opacity-100'
                      }`}
                    >
                      {k === 'ALL' ? 'All' : VERDICT_LABEL[k as Verdict]}{' '}
                      <span className="ml-1 font-black">{n}</span>
                    </button>
                  );
                })}
              </div>

              {filtered.length === 0 && !anyLoading ? (
                <div className="glass-soft p-8 rounded-2xl text-center text-[13px] text-neutral-500 dark:text-slate-400">
                  No results match the current filter.
                </div>
              ) : (
                <ul className="space-y-3">
                  {filtered.map((h, i) => {
                    const v = h.classification.verdict;
                    return (
                      <li
                        key={`${h.id}-${i}`}
                        className="glass-soft p-5 rounded-2xl flex flex-col gap-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded border ${VERDICT_TONE[v]}`}
                          >
                            {VERDICT_LABEL[v]}
                          </span>
                          <span
                            className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded border ${SOURCE_META[h.source].tone}`}
                          >
                            {SOURCE_META[h.source].short}
                          </span>
                          {h.year && (
                            <span className="text-[10px] font-mono text-neutral-500 dark:text-slate-500 tracking-widest">
                              {h.year}
                            </span>
                          )}
                          {h.journal && (
                            <span className="text-[10px] font-mono text-neutral-500 dark:text-slate-500 truncate max-w-[260px]">
                              {h.journal}
                            </span>
                          )}
                          {(h.classification.positives.length > 0 ||
                            h.classification.negatives.length > 0) && (
                            <span className="ml-auto flex flex-wrap gap-1 justify-end">
                              {h.classification.positives.map((p) => (
                                <span
                                  key={`p-${p}`}
                                  className="text-[9px] font-bold uppercase bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 rounded px-1.5"
                                >
                                  +{p}
                                </span>
                              ))}
                              {h.classification.negatives.map((n) => (
                                <span
                                  key={`n-${n}`}
                                  className="text-[9px] font-bold uppercase bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-500/30 rounded px-1.5"
                                >
                                  −{n}
                                </span>
                              ))}
                              {h.classification.negatedNegatives.map((n) => (
                                <span
                                  key={`nn-${n}`}
                                  className="text-[9px] font-bold uppercase bg-yellow-100 dark:bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-500/30 rounded px-1.5"
                                  title="Trigger overridden by negation context"
                                >
                                  ~{n}
                                </span>
                              ))}
                            </span>
                          )}
                        </div>

                        <a
                          href={h.url || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[14px] sm:text-[15px] font-bold leading-tight text-neutral-900 dark:text-white hover:text-[#00A598] dark:hover:text-[#00A598] transition-colors"
                        >
                          {h.title || '(untitled)'}
                        </a>

                        {h.authors && (
                          <p className="text-[11px] text-neutral-500 dark:text-slate-500 font-mono truncate">
                            {h.authors}
                          </p>
                        )}

                        {h.abstract ? (
                          <p className="text-[13px] leading-relaxed text-neutral-700 dark:text-slate-300 font-serif">
                            {highlightAbstract(
                              h.abstract,
                              h.classification.positives,
                              [
                                ...h.classification.negatives,
                                ...h.classification.negatedNegatives,
                              ]
                            )}
                          </p>
                        ) : (
                          <p className="text-[12px] italic text-neutral-400 dark:text-slate-500">
                            (no abstract provided by source)
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {!hasSearched && (
            <div className="glass-soft p-8 rounded-2xl text-center text-[13px] text-neutral-500 dark:text-slate-400 leading-relaxed">
              Enter a query above (or use{' '}
              <span className="font-bold">Reset from Protocol</span> to derive one
              from your inclusion keywords) and run a multi-source search. Each
              result will be auto-classified into{' '}
              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                Include / Maybe
              </span>
              ,{' '}
              <span className="font-bold text-yellow-600 dark:text-yellow-400">
                Unclear
              </span>
              , or{' '}
              <span className="font-bold text-red-600 dark:text-red-400">
                Exclude
              </span>{' '}
              against your active PICO criteria.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
