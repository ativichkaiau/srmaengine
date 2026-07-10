'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import MobileTabBar from '@/components/MobileTabBar';
import {
  clearLibrary,
  loadLibrary,
  prismaCounts,
  removeRecord,
  toCSV,
  updateRecord,
  type Decision,
  type Library,
} from '@/lib/library';

const DECISION_META: Record<Decision, { label: string; tone: string }> = {
  include: {
    label: 'Include',
    tone: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-500/30',
  },
  maybe: {
    label: 'Maybe',
    tone: 'text-yellow-700 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-500/15 border-yellow-200 dark:border-yellow-500/30',
  },
  exclude: {
    label: 'Exclude',
    tone: 'text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/15 border-rose-200 dark:border-rose-500/30',
  },
  unscreened: {
    label: 'Unscreened',
    tone: 'text-neutral-600 dark:text-slate-300 bg-neutral-100 dark:bg-white/10 border-black/10 dark:border-white/15',
  },
};

function PrismaBox({
  x,
  y,
  w,
  h,
  title,
  value,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  value: number;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={10}
        className="fill-cyan-50 dark:fill-white/[0.04] stroke-cyan-300 dark:stroke-cyan-500/40"
        strokeWidth="1"
      />
      <text x={x + w / 2} y={y + 22} textAnchor="middle" fontSize="12" fontWeight="700" className="fill-neutral-700 dark:fill-slate-200">
        {value}
      </text>
      <text x={x + w / 2} y={y + 39} textAnchor="middle" fontSize="10" className="fill-neutral-500 dark:fill-slate-400">
        {title}
      </text>
    </g>
  );
}

function PrismaDiagram({ c }: { c: ReturnType<typeof prismaCounts> }) {
  // Simple vertical flow with an "excluded" side-branch.
  const W = 640;
  const H = 300;
  const cx = 190;
  const bw = 260;
  const bh = 52;
  const gap = 30;
  const ys = [20, 20 + bh + gap, 20 + 2 * (bh + gap), 20 + 3 * (bh + gap)];
  const arrow = (y1: number, y2: number) => (
    <line x1={cx + bw / 2} y1={y1} x2={cx + bw / 2} y2={y2} stroke="currentColor" strokeOpacity="0.4" markerEnd="url(#arr)" />
  );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full text-neutral-500 dark:text-slate-400" role="img" aria-label="PRISMA flow">
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" className="fill-neutral-400 dark:fill-slate-500" />
        </marker>
      </defs>
      <PrismaBox x={cx} y={ys[0]} w={bw} h={bh} title="Records identified" value={c.identified} />
      {arrow(ys[0] + bh, ys[1])}
      <PrismaBox x={cx} y={ys[1]} w={bw} h={bh} title="After duplicates removed" value={c.screened} />
      {arrow(ys[1] + bh, ys[2])}
      <PrismaBox x={cx} y={ys[2]} w={bw} h={bh} title="Records screened" value={c.screened} />
      {arrow(ys[2] + bh, ys[3])}
      <PrismaBox x={cx} y={ys[3]} w={bw} h={bh} title="Included" value={c.included} />
      {/* excluded side-branch */}
      <line x1={cx + bw} y1={ys[2] + bh / 2} x2={cx + bw + 40} y2={ys[2] + bh / 2} stroke="currentColor" strokeOpacity="0.4" markerEnd="url(#arr)" />
      <g>
        <rect x={cx + bw + 40} y={ys[2] + bh / 2 - 34} width={150} height={68} rx={10} className="fill-rose-50 dark:fill-rose-500/10 stroke-rose-300 dark:stroke-rose-500/40" strokeWidth="1" />
        <text x={cx + bw + 115} y={ys[2] + bh / 2 - 12} textAnchor="middle" fontSize="12" fontWeight="700" className="fill-rose-600 dark:fill-rose-300">
          {c.excluded}
        </text>
        <text x={cx + bw + 115} y={ys[2] + bh / 2 + 4} textAnchor="middle" fontSize="10" className="fill-neutral-500 dark:fill-slate-400">
          Excluded
        </text>
        <text x={cx + bw + 115} y={ys[2] + bh / 2 + 20} textAnchor="middle" fontSize="9.5" className="fill-neutral-500 dark:fill-slate-400">
          {c.maybe} maybe · {c.duplicatesRemoved} dupes
        </text>
      </g>
    </svg>
  );
}

export default function LibraryPage() {
  const [lib, setLib] = useState<Library>({ records: [], identified: 0 });
  const [filter, setFilter] = useState<Decision | 'all'>('all');

  useEffect(() => {
    const sync = () => setLib(loadLibrary());
    sync();
    window.addEventListener('srma-library-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('srma-library-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const counts = useMemo(() => prismaCounts(lib), [lib]);
  const filtered = useMemo(
    () =>
      filter === 'all'
        ? lib.records
        : lib.records.filter((r) => r.decision === filter),
    [lib, filter]
  );

  const setDecision = (id: string, decision: Decision) =>
    setLib(updateRecord(id, { decision }));
  const setReason = (id: string, reason: string) =>
    setLib(updateRecord(id, { reason }));

  const exportCSV = () => {
    const blob = new Blob([toCSV(lib)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'srma-screening-library.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen flex flex-col app-canvas text-foreground relative overflow-hidden font-sans selection:bg-[#00A598]/30 transition-colors duration-700">
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="obs-drift-a absolute top-[-14%] right-[4%] w-[56%] h-[56%] rounded-full bg-[radial-gradient(circle,rgba(56,189,248,0.20),transparent_66%)] blur-[120px]"></div>
        <div className="obs-drift-b absolute bottom-[-16%] left-[0%] w-[52%] h-[52%] rounded-full bg-[radial-gradient(circle,rgba(168,85,247,0.18),transparent_66%)] blur-[120px]"></div>
        <div className="absolute inset-0 obs-starfield"></div>
      </div>

      <header className="clay-header h-[64px] lg:h-[72px] flex items-center justify-between px-4 lg:px-8 shrink-0 z-50">
        <div className="flex items-center gap-4 lg:gap-8">
          <Link href="/" className="font-black text-[18px] lg:text-[20px] tracking-tighter flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="brand-mark w-8 h-8 rounded-lg flex items-center justify-center text-[15px]">✦</div>
            <div className="flex items-baseline">
              <span>VESTRIPPN</span>
              <span className="brand-version">3.0</span>
            </div>
          </Link>
          <nav className="hidden sm:flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest">
            <Link href="/" className="clay-tab px-3 py-1.5 rounded-lg">Scanner</Link>
            <Link href="/research" className="clay-tab px-3 py-1.5 rounded-lg">Research</Link>
            <Link href="/stats" className="clay-tab px-3 py-1.5 rounded-lg">Statistics</Link>
            <span className="clay-tab clay-tab-active px-3 py-1.5 rounded-lg">Library</span>
          </nav>
        </div>
        <ThemeToggle />
      </header>

      <main className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-5 lg:p-8 pb-32 lg:pb-8 relative z-10">
        <div className="max-w-[1120px] mx-auto space-y-6 lg:space-y-8">
          <section className="flex flex-col items-center text-center pt-6 sm:pt-8 pb-2">
            <h1 className="font-black tracking-tighter leading-none mb-3 text-[24px] sm:text-[32px] lg:text-[40px] flex items-center gap-3 flex-wrap justify-center">
              <span className="text-neutral-900 dark:text-white">Screening</span>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-500 via-indigo-500 to-violet-500 dark:from-cyan-300 dark:via-indigo-300 dark:to-violet-300">Library</span>
            </h1>
            <p className="max-w-2xl font-mono text-[10px] sm:text-[11px] text-neutral-500 dark:text-neutral-400 uppercase tracking-[0.3em]">
              Decisions · PRISMA flow · export
            </p>
          </section>

          {/* Summary + PRISMA */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="clay p-5 rounded-2xl">
              <div className="text-[11px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-400 mb-3">
                PRISMA flow
              </div>
              {counts.screened > 0 ? (
                <PrismaDiagram c={counts} />
              ) : (
                <p className="text-[13px] text-neutral-500 dark:text-slate-400 leading-relaxed">
                  Nothing screened yet. On the{' '}
                  <Link href="/research" className="font-bold text-cyan-600 dark:text-cyan-300 hover:underline">
                    Research
                  </Link>{' '}
                  tab, use the Include / Maybe / Exclude buttons on each result to build your library.
                </p>
              )}
            </div>
            <div className="clay-soft p-5 rounded-2xl grid grid-cols-2 gap-2 content-start">
              {[
                ['Identified', counts.identified],
                ['Duplicates removed', counts.duplicatesRemoved],
                ['Screened', counts.screened],
                ['Included', counts.included],
                ['Maybe', counts.maybe],
                ['Excluded', counts.excluded],
              ].map(([label, v]) => (
                <div key={label} className="clay-soft rounded-xl p-3">
                  <div className="text-[9px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-500">{label}</div>
                  <div className="text-[20px] font-black text-neutral-900 dark:text-white mt-1 leading-none">{v}</div>
                </div>
              ))}
              <div className="col-span-2 flex gap-2 pt-1">
                <button
                  onClick={exportCSV}
                  disabled={counts.screened === 0}
                  className="clay-primary flex-1 py-2.5 rounded-xl text-[12px] font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Export CSV
                </button>
                <button
                  onClick={() => {
                    if (confirm('Clear the entire screening library? This cannot be undone.'))
                      setLib(clearLibrary());
                  }}
                  disabled={counts.screened === 0}
                  className="clay-button px-4 py-2.5 rounded-xl text-[12px] font-bold text-rose-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          {/* Filter + records */}
          {lib.records.length > 0 && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {(['all', 'include', 'maybe', 'exclude', 'unscreened'] as const).map((k) => {
                  const n = k === 'all' ? lib.records.length : lib.records.filter((r) => r.decision === k).length;
                  if (k !== 'all' && n === 0) return null;
                  const active = filter === k;
                  const tone = k === 'all' ? 'bg-neutral-100 dark:bg-white/10 text-neutral-700 dark:text-slate-200 border-black/10 dark:border-white/15' : DECISION_META[k].tone;
                  return (
                    <button
                      key={k}
                      onClick={() => setFilter(k)}
                      className={`px-3 py-1.5 text-[11px] font-bold rounded-lg border transition-all ${tone} ${active ? 'ring-2 ring-[#00A598]/40' : 'opacity-80 hover:opacity-100'}`}
                    >
                      {k === 'all' ? 'All' : DECISION_META[k].label} <span className="ml-1 font-black">{n}</span>
                    </button>
                  );
                })}
              </div>

              <ul className="space-y-3">
                {filtered.map((r) => (
                  <li key={r.id} className="clay-soft p-4 rounded-2xl flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded border ${DECISION_META[r.decision].tone}`}>
                        {DECISION_META[r.decision].label}
                      </span>
                      {r.source && <span className="text-[10px] font-mono text-neutral-500 dark:text-slate-500">{r.source}</span>}
                      {r.year && <span className="text-[10px] font-mono text-neutral-500 dark:text-slate-500 tracking-widest">{r.year}</span>}
                      <div className="ml-auto flex items-center gap-1.5">
                        <select
                          value={r.decision}
                          onChange={(e) => setDecision(r.id, e.target.value as Decision)}
                          className="clay-field rounded-lg px-2 py-1 text-[11px] font-bold focus:outline-none"
                        >
                          <option value="include">Include</option>
                          <option value="maybe">Maybe</option>
                          <option value="exclude">Exclude</option>
                          <option value="unscreened">Unscreened</option>
                        </select>
                        <button
                          onClick={() => setLib(removeRecord(r.id))}
                          className="clay-button rounded-lg px-2 py-1 text-[11px] font-bold text-rose-500"
                          title="Remove"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    <a
                      href={r.url || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[14px] font-bold leading-tight text-neutral-900 dark:text-white hover:text-cyan-600 dark:hover:text-cyan-300 transition-colors"
                    >
                      {r.title || '(untitled)'}
                    </a>
                    {r.authors && <p className="text-[11px] text-neutral-500 dark:text-slate-500 font-mono truncate">{r.authors}</p>}
                    <input
                      value={r.reason ?? ''}
                      onChange={(e) => setReason(r.id, e.target.value)}
                      placeholder="Reason / note (e.g. wrong population, no full text)…"
                      className="clay-field rounded-lg px-3 py-2 text-[12px] focus:outline-none"
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </main>

      <MobileTabBar />
    </div>
  );
}
