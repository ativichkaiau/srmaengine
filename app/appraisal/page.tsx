'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import ThemeToggle from '../../components/ThemeToggle';
import MobileTabBar from '../../components/MobileTabBar';
import { loadLibrary } from '../../lib/library';
import {
  ROB_DOMAINS,
  ROB_LABELS,
  robOverall,
  emptyRobDomains,
  loadRob,
  saveRob,
  type RobStudy,
  type RobJudgement,
  type RobDomainKey,
  GRADE_DOWNGRADE,
  GRADE_UPGRADE,
  GRADE_LABELS,
  gradeCompute,
  gradePips,
  emptyGradeRow,
  loadGrade,
  saveGrade,
  type GradeRow,
  type GradeLevel,
  type GradeStep,
  type GradeDesign,
} from '../../lib/appraisal';

const newId = (prefix: string) =>
  `${prefix}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.abs((Math.sin(performance.now()) * 1e9) | 0)}`;

const JUDGE: Record<RobJudgement, { label: string; sym: string; dot: string; chip: string }> = {
  low: {
    label: 'Low',
    sym: '+',
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/25',
  },
  some: {
    label: 'Some',
    sym: '?',
    dot: 'bg-amber-400',
    chip: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/25',
  },
  high: {
    label: 'High',
    sym: '−',
    dot: 'bg-rose-500',
    chip: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/25',
  },
};

const GRADE_STYLE: Record<GradeLevel, string> = {
  high: 'text-emerald-600 dark:text-emerald-300',
  moderate: 'text-cyan-600 dark:text-cyan-300',
  low: 'text-amber-600 dark:text-amber-300',
  verylow: 'text-rose-600 dark:text-rose-300',
};

export default function AppraisalPage() {
  const [tool, setTool] = useState<'rob' | 'grade'>('rob');
  const [rob, setRob] = useState<RobStudy[]>([]);
  const [grade, setGrade] = useState<GradeRow[]>([]);
  const [mounted, setMounted] = useState(false);

  // Hydrate from localStorage after mount (SSR-safe: state starts empty). Only
  // the cross-tab `storage` event re-syncs — same-tab writes flow through the
  // save effects below, so listening to our own change event would loop.
  useEffect(() => {
    const sync = () => {
      setRob(loadRob());
      setGrade(loadGrade());
      setMounted(true);
    };
    sync();
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  useEffect(() => {
    if (mounted) saveRob(rob);
  }, [rob, mounted]);
  useEffect(() => {
    if (mounted) saveGrade(grade);
  }, [grade, mounted]);

  // ---- RoB actions ----
  const addRobStudy = () =>
    setRob((r) => [
      ...r,
      { id: newId('rob'), label: `Study ${r.length + 1}`, domains: emptyRobDomains() },
    ]);

  const importIncluded = () => {
    const included = loadLibrary().records.filter((x) => x.decision === 'include');
    setRob((r) => {
      const have = new Set(r.map((s) => s.id));
      const additions = included
        .filter((x) => !have.has(x.id))
        .map((x) => ({ id: x.id, label: x.title.slice(0, 80), domains: emptyRobDomains() }));
      return [...r, ...additions];
    });
  };

  const setDomain = (id: string, key: RobDomainKey, val: RobJudgement) =>
    setRob((r) => r.map((s) => (s.id === id ? { ...s, domains: { ...s.domains, [key]: val } } : s)));
  const setRobLabel = (id: string, label: string) =>
    setRob((r) => r.map((s) => (s.id === id ? { ...s, label } : s)));
  const removeRob = (id: string) => setRob((r) => r.filter((s) => s.id !== id));

  // Per-domain distribution for the weighted-bar summary.
  const robSummary = ROB_DOMAINS.map((d) => {
    const counts = { low: 0, some: 0, high: 0 } as Record<RobJudgement, number>;
    rob.forEach((s) => (counts[s.domains[d.key]] += 1));
    return { ...d, counts };
  });
  const overallCounts = rob.reduce(
    (acc, s) => {
      acc[robOverall(s)] += 1;
      return acc;
    },
    { low: 0, some: 0, high: 0 } as Record<RobJudgement, number>
  );

  // ---- GRADE actions ----
  const addGradeRow = () =>
    setGrade((g) => [...g, emptyGradeRow(newId('grade'), `Outcome ${g.length + 1}`)]);
  const removeGrade = (id: string) => setGrade((g) => g.filter((r) => r.id !== id));
  const setGradeField = (id: string, patch: Partial<GradeRow>) =>
    setGrade((g) => g.map((r) => (r.id === id ? { ...r, ...patch } : r)));

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
            <Link href="/library" className="clay-tab px-3 py-1.5 rounded-lg">Library</Link>
            <span className="clay-tab clay-tab-active px-3 py-1.5 rounded-lg">Appraisal</span>
          </nav>
        </div>
        <ThemeToggle />
      </header>

      <main className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-5 lg:p-8 pb-32 lg:pb-8 relative z-10">
        <div className="max-w-[1120px] mx-auto space-y-6 lg:space-y-8">
          <section className="flex flex-col items-center text-center pt-6 sm:pt-8 pb-2">
            <h1 className="font-black tracking-tighter leading-none mb-3 text-[24px] sm:text-[32px] lg:text-[40px] flex items-center gap-3 flex-wrap justify-center">
              <span className="text-neutral-900 dark:text-white">Critical</span>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-500 via-indigo-500 to-violet-500 dark:from-cyan-300 dark:via-indigo-300 dark:to-violet-300">Appraisal</span>
            </h1>
            <p className="max-w-2xl font-mono text-[10px] sm:text-[11px] text-neutral-500 dark:text-neutral-400 uppercase tracking-[0.3em]">
              Risk of bias (RoB 2) · certainty of evidence (GRADE)
            </p>
          </section>

          {/* Tool switch */}
          <div className="flex justify-center">
            <div className="clay-inset flex rounded-xl p-1">
              {([
                ['rob', 'Risk of Bias (RoB 2)'],
                ['grade', 'Certainty (GRADE)'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setTool(id)}
                  className={`px-4 py-2 text-[12px] font-bold rounded-lg transition-all ${
                    tool === id ? 'clay-tab-active' : 'text-neutral-500 dark:text-slate-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* ================= RISK OF BIAS ================= */}
          {tool === 'rob' && (
            <div className="space-y-6">
              <div className="clay p-5 rounded-2xl space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-bold text-[15px] tracking-tight flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 obs-pulse"></span>
                    RoB 2 — assess each included trial
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={importIncluded} className="clay-button px-3 py-1.5 text-[11px] font-bold rounded-lg text-neutral-600 dark:text-slate-300">
                      + Import included from library
                    </button>
                    <button onClick={addRobStudy} className="clay-primary px-3 py-1.5 text-[11px] font-bold rounded-lg">
                      + Add study
                    </button>
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-neutral-500 dark:text-slate-400">
                  Five RoB 2 domains, each judged{' '}
                  <span className="font-bold text-emerald-600 dark:text-emerald-300">Low</span>,{' '}
                  <span className="font-bold text-amber-600 dark:text-amber-300">Some concerns</span>, or{' '}
                  <span className="font-bold text-rose-600 dark:text-rose-300">High</span>. The overall
                  judgement follows the RoB 2 algorithm (High if any domain is High; otherwise Some
                  concerns if any domain raises them; otherwise Low).
                </p>

                {rob.length === 0 ? (
                  <p className="text-[12px] text-neutral-400 dark:text-slate-500 italic">
                    No studies yet — import your included studies or add one to begin.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {rob.map((s) => {
                      const overall = robOverall(s);
                      return (
                        <div key={s.id} className="clay-soft rounded-2xl p-4 space-y-3">
                          <div className="flex items-center gap-2">
                            <input
                              value={s.label}
                              onChange={(e) => setRobLabel(s.id, e.target.value)}
                              className="clay-field flex-1 px-3 py-1.5 rounded-lg text-[13px] font-bold text-neutral-700 dark:text-slate-200 focus:outline-none"
                            />
                            <span className={`px-2.5 py-1 rounded-lg border text-[10px] font-black uppercase tracking-wide whitespace-nowrap ${JUDGE[overall].chip}`}>
                              Overall: {ROB_LABELS[overall]}
                            </span>
                            <button
                              onClick={() => removeRob(s.id)}
                              className="clay-button w-8 h-8 rounded-lg text-neutral-400 dark:text-slate-500 hover:text-rose-500 shrink-0"
                              title="Remove"
                            >
                              ×
                            </button>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                            {ROB_DOMAINS.map((d) => (
                              <div key={d.key} className="rounded-xl bg-black/[0.02] dark:bg-white/[0.03] p-2.5">
                                <div className="flex items-start justify-between gap-2 mb-1.5">
                                  <div className="text-[11px] font-bold text-neutral-600 dark:text-slate-300 leading-tight">
                                    <span className="font-mono text-neutral-400 dark:text-slate-500">{d.short}</span>{' '}
                                    {d.label}
                                  </div>
                                </div>
                                <p className="text-[10px] leading-snug text-neutral-400 dark:text-slate-500 mb-2">{d.hint}</p>
                                <div className="flex gap-1">
                                  {(['low', 'some', 'high'] as RobJudgement[]).map((j) => (
                                    <button
                                      key={j}
                                      onClick={() => setDomain(s.id, d.key, j)}
                                      className={`flex-1 py-1 rounded-md text-[10px] font-black uppercase tracking-wide border transition-all ${
                                        s.domains[d.key] === j
                                          ? JUDGE[j].chip
                                          : 'border-transparent text-neutral-400 dark:text-slate-500 hover:bg-black/[0.03] dark:hover:bg-white/[0.05]'
                                      }`}
                                    >
                                      {JUDGE[j].sym} {JUDGE[j].label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Traffic-light matrix + weighted bars */}
              {rob.length > 0 && (
                <div className="clay p-5 rounded-2xl space-y-5">
                  <div className="text-[11px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-400">
                    Risk-of-bias summary
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12px] border-collapse">
                      <thead>
                        <tr className="text-neutral-500 dark:text-slate-400">
                          <th className="text-left px-2 py-1.5">Study</th>
                          {ROB_DOMAINS.map((d) => (
                            <th key={d.key} className="px-2 py-1.5 font-mono" title={d.label}>
                              {d.short}
                            </th>
                          ))}
                          <th className="px-2 py-1.5">Overall</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rob.map((s) => (
                          <tr key={s.id} className="border-t border-black/5 dark:border-white/5">
                            <td className="px-2 py-1.5 text-neutral-700 dark:text-slate-200 whitespace-nowrap max-w-[220px] truncate">
                              {s.label}
                            </td>
                            {ROB_DOMAINS.map((d) => (
                              <td key={d.key} className="px-2 py-1.5 text-center">
                                <TrafficDot j={s.domains[d.key]} />
                              </td>
                            ))}
                            <td className="px-2 py-1.5 text-center">
                              <TrafficDot j={robOverall(s)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="space-y-2">
                    {robSummary.map((d) => (
                      <WeightedBar key={d.key} label={`${d.short} · ${d.label}`} counts={d.counts} total={rob.length} />
                    ))}
                    <WeightedBar label="Overall" counts={overallCounts} total={rob.length} emphasize />
                  </div>

                  <div className="flex flex-wrap gap-4 pt-1 text-[10px] font-bold uppercase tracking-wide text-neutral-500 dark:text-slate-400">
                    {(['low', 'some', 'high'] as RobJudgement[]).map((j) => (
                      <span key={j} className="flex items-center gap-1.5">
                        <TrafficDot j={j} /> {ROB_LABELS[j]}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================= GRADE ================= */}
          {tool === 'grade' && (
            <div className="space-y-6">
              <div className="clay p-5 rounded-2xl space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-bold text-[15px] tracking-tight flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-violet-400 obs-pulse"></span>
                    GRADE — certainty per outcome
                  </h2>
                  <button onClick={addGradeRow} className="clay-primary px-3 py-1.5 text-[11px] font-bold rounded-lg">
                    + Add outcome
                  </button>
                </div>
                <p className="text-[11px] leading-relaxed text-neutral-500 dark:text-slate-400">
                  Certainty starts <span className="font-bold text-emerald-600 dark:text-emerald-300">High</span> for
                  randomized trials and <span className="font-bold text-amber-600 dark:text-amber-300">Low</span> for
                  observational studies, is downgraded by five domains, and (observational only) upgraded by three.
                </p>

                {grade.length === 0 ? (
                  <p className="text-[12px] text-neutral-400 dark:text-slate-500 italic">
                    No outcomes yet — add one to rate its certainty.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {grade.map((row) => {
                      const level = gradeCompute(row);
                      return (
                        <div key={row.id} className="clay-soft rounded-2xl p-4 space-y-3">
                          <div className="flex items-center gap-2">
                            <input
                              value={row.outcome}
                              onChange={(e) => setGradeField(row.id, { outcome: e.target.value })}
                              className="clay-field flex-1 px-3 py-1.5 rounded-lg text-[13px] font-bold text-neutral-700 dark:text-slate-200 focus:outline-none"
                            />
                            <div className={`flex items-center gap-1.5 font-black text-[13px] whitespace-nowrap ${GRADE_STYLE[level]}`}>
                              <span className="tracking-tight">{gradePips(level)}</span>
                              <span className="uppercase tracking-wide text-[11px]">{GRADE_LABELS[level]}</span>
                            </div>
                            <button
                              onClick={() => removeGrade(row.id)}
                              className="clay-button w-8 h-8 rounded-lg text-neutral-400 dark:text-slate-500 hover:text-rose-500 shrink-0"
                              title="Remove"
                            >
                              ×
                            </button>
                          </div>

                          {/* Design */}
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-400">Design</span>
                            {([
                              ['rct', 'Randomized trial'],
                              ['observational', 'Observational'],
                            ] as const).map(([id, label]) => (
                              <button
                                key={id}
                                onClick={() => setGradeField(row.id, { design: id as GradeDesign })}
                                className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all ${
                                  row.design === id ? 'clay-tab-active' : 'clay-button text-neutral-400 dark:text-slate-500'
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>

                          {/* Downgrades */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                            {GRADE_DOWNGRADE.map((d) => (
                              <StepControl
                                key={d.key}
                                label={d.label}
                                dir="down"
                                value={row.downgrades[d.key]}
                                onChange={(v) =>
                                  setGradeField(row.id, {
                                    downgrades: { ...row.downgrades, [d.key]: v },
                                  })
                                }
                              />
                            ))}
                          </div>

                          {/* Upgrades (observational only) */}
                          {row.design !== 'rct' && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 pt-1 border-t border-black/5 dark:border-white/10">
                              {GRADE_UPGRADE.map((u) => (
                                <StepControl
                                  key={u.key}
                                  label={u.label}
                                  dir="up"
                                  value={row.upgrades[u.key]}
                                  onChange={(v) =>
                                    setGradeField(row.id, {
                                      upgrades: { ...row.upgrades, [u.key]: v },
                                    })
                                  }
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      <MobileTabBar />
    </div>
  );
}

function TrafficDot({ j }: { j: RobJudgement }) {
  return (
    <span
      className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-[11px] font-black ${JUDGE[j].dot}`}
      title={ROB_LABELS[j]}
    >
      {JUDGE[j].sym}
    </span>
  );
}

function WeightedBar({
  label,
  counts,
  total,
  emphasize,
}: {
  label: string;
  counts: Record<RobJudgement, number>;
  total: number;
  emphasize?: boolean;
}) {
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  return (
    <div className="flex items-center gap-3">
      <div className={`text-[10px] ${emphasize ? 'font-black' : 'font-semibold'} text-neutral-500 dark:text-slate-400 w-[190px] shrink-0 truncate`}>
        {label}
      </div>
      <div className="flex-1 h-4 rounded-md overflow-hidden flex bg-black/5 dark:bg-white/5">
        {(['low', 'some', 'high'] as RobJudgement[]).map((j) =>
          counts[j] > 0 ? (
            <div
              key={j}
              className={JUDGE[j].dot}
              style={{ width: `${pct(counts[j])}%` }}
              title={`${ROB_LABELS[j]}: ${counts[j]}`}
            />
          ) : null
        )}
      </div>
    </div>
  );
}

function StepControl({
  label,
  value,
  onChange,
  dir,
}: {
  label: string;
  value: GradeStep;
  onChange: (v: GradeStep) => void;
  dir: 'down' | 'up';
}) {
  const opts: { v: GradeStep; t: string }[] =
    dir === 'down'
      ? [
          { v: 0, t: 'Not serious' },
          { v: 1, t: 'Serious −1' },
          { v: 2, t: 'Very serious −2' },
        ]
      : [
          { v: 0, t: 'None' },
          { v: 1, t: '+1' },
          { v: 2, t: '+2' },
        ];
  const active = dir === 'down' ? 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/25' : 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/25';
  return (
    <div className="rounded-xl bg-black/[0.02] dark:bg-white/[0.03] p-2">
      <div className="text-[11px] font-bold text-neutral-600 dark:text-slate-300 mb-1.5">{label}</div>
      <div className="flex gap-1">
        {opts.map((o) => (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className={`flex-1 py-1 rounded-md text-[10px] font-bold border transition-all ${
              value === o.v ? active : 'border-transparent text-neutral-400 dark:text-slate-500 hover:bg-black/[0.03] dark:hover:bg-white/[0.05]'
            }`}
          >
            {o.t}
          </button>
        ))}
      </div>
    </div>
  );
}
