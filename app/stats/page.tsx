'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import MobileTabBar from '@/components/MobileTabBar';
import {
  getPyodide,
  parseNumbers,
  parseTable,
  pStars,
  runStats,
  type StatMode,
  type StatPayload,
} from '@/lib/stats';

type Result = Record<string, unknown> | null;

const MODES: { id: StatMode; label: string; short: string; desc: string }[] = [
  {
    id: 'descriptive',
    label: 'Descriptive',
    short: 'DESC',
    desc: 'Central tendency + variability for one sample.',
  },
  {
    id: 'ttest',
    label: 'T-test',
    short: 'TTEST',
    desc: 'Compare means of two groups (Welch by default; paired optional).',
  },
  {
    id: 'anova',
    label: 'ANOVA',
    short: 'ANOVA',
    desc: 'Compare means of three or more groups (one-way).',
  },
  {
    id: 'chi2',
    label: 'Chi-Square',
    short: 'CHI²',
    desc: 'Association between two categorical variables (contingency table).',
  },
  {
    id: 'correlation',
    label: 'Correlation',
    short: 'CORR',
    desc: 'Pearson r + Spearman ρ on paired observations.',
  },
  {
    id: 'regression',
    label: 'Regression',
    short: 'REG',
    desc: 'Simple linear regression of y on x.',
  },
];

const fmt = (n: number, digits = 4): string => {
  if (!isFinite(n)) return '—';
  if (Math.abs(n) >= 10000 || (Math.abs(n) < 0.001 && n !== 0)) {
    return n.toExponential(2);
  }
  return Number(n.toFixed(digits)).toString();
};

const fmtP = (p: number): string => {
  if (!isFinite(p)) return '—';
  if (p < 0.0001) return '< 0.0001';
  return p.toFixed(4);
};

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="clay-soft rounded-xl p-3">
      <div className="text-[9px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-500">
        {label}
      </div>
      <div
        className={`text-[18px] font-black mt-1 leading-none ${
          accent ?? 'text-neutral-900 dark:text-white'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function DescriptiveCard({
  title,
  d,
}: {
  title?: string;
  d: Record<string, unknown>;
}) {
  if (d.error) {
    return (
      <div className="clay-soft rounded-2xl p-4 text-[12px] text-red-600 dark:text-red-400">
        {title ? <strong>{title}: </strong> : null}
        {String(d.error)}
      </div>
    );
  }
  const f = (k: string) => fmt(Number(d[k]));
  return (
    <div className="clay-soft rounded-2xl p-4 space-y-3">
      {title && (
        <div className="text-[11px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-500">
          {title}
        </div>
      )}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        <StatTile label="n" value={String(d.n)} />
        <StatTile label="Mean" value={f('mean')} />
        <StatTile label="Median" value={f('median')} />
        <StatTile
          label="Mode"
          value={`${f('mode')}${
            d.mode_count && Number(d.mode_count) > 1
              ? ` (×${d.mode_count})`
              : ''
          }`}
        />
        <StatTile label="SD" value={f('std')} />
        <StatTile label="Variance" value={f('variance')} />
        <StatTile label="Min" value={f('min')} />
        <StatTile label="Max" value={f('max')} />
        <StatTile label="Range" value={f('range')} />
        <StatTile label="Q1" value={f('q1')} />
        <StatTile label="Q3" value={f('q3')} />
        <StatTile label="IQR" value={fmt(Number(d.q3) - Number(d.q1))} />
      </div>
    </div>
  );
}

function pStarColor(p: number) {
  if (!isFinite(p)) return 'text-neutral-400';
  if (p < 0.05)
    return 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-500/30';
  return 'text-yellow-700 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-500/15 border-yellow-200 dark:border-yellow-500/30';
}

function PChip({ p }: { p: number }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md border ${pStarColor(
        p
      )}`}
      title={
        p < 0.05
          ? 'Statistically significant at α = 0.05'
          : 'Not statistically significant at α = 0.05'
      }
    >
      p = {fmtP(p)} <span>{pStars(p)}</span>
    </span>
  );
}

export default function StatsPage() {
  const [mode, setMode] = useState<StatMode>('descriptive');

  // Single + two-group + many-group inputs.
  const [groupText, setGroupText] = useState('');
  const [group1Text, setGroup1Text] = useState('');
  const [group2Text, setGroup2Text] = useState('');
  const [paired, setPaired] = useState(false);
  const [anovaGroups, setAnovaGroups] = useState<string[]>(['', '', '']);
  const [tableText, setTableText] = useState('');
  const [xText, setXText] = useState('');
  const [yText, setYText] = useState('');

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [pyReady, setPyReady] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [error, setError] = useState<string | null>(null);

  // AI interpretation state (driven by /api/interpret on the server).
  const [lastPayload, setLastPayload] = useState<StatPayload | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiText, setAiText] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);

  // Pre-warm Pyodide in the background once the page mounts.
  useEffect(() => {
    let cancelled = false;
    getPyodide((msg) => {
      if (!cancelled) setProgress(msg);
    })
      .then(() => {
        if (!cancelled) setPyReady(true);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err.message || err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRun = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    setAiText('');
    setAiError(null);
    try {
      let payload: StatPayload;
      switch (mode) {
        case 'descriptive': {
          const g = parseNumbers(groupText);
          if (g.length < 1) throw new Error('Paste at least one number.');
          payload = { group: g };
          break;
        }
        case 'ttest': {
          const g1 = parseNumbers(group1Text);
          const g2 = parseNumbers(group2Text);
          if (g1.length < 2 || g2.length < 2)
            throw new Error('Each group needs at least 2 values.');
          payload = { group1: g1, group2: g2, paired };
          break;
        }
        case 'anova': {
          const groups = anovaGroups
            .map((t) => parseNumbers(t))
            .filter((g) => g.length > 0);
          if (groups.length < 2)
            throw new Error('Provide values for at least 2 groups.');
          if (groups.some((g) => g.length < 2))
            throw new Error('Each group needs at least 2 values.');
          payload = { groups };
          break;
        }
        case 'chi2': {
          const tbl = parseTable(tableText);
          if (tbl.length < 2 || (tbl[0]?.length ?? 0) < 2)
            throw new Error(
              'Provide a contingency table of at least 2 rows × 2 columns.'
            );
          payload = { observed: tbl };
          break;
        }
        case 'correlation':
        case 'regression': {
          const x = parseNumbers(xText);
          const y = parseNumbers(yText);
          if (x.length !== y.length)
            throw new Error(
              `X and Y must be the same length (got ${x.length} vs ${y.length}).`
            );
          if (x.length < 3)
            throw new Error('Need at least 3 paired observations.');
          payload = { x, y };
          break;
        }
      }
      const r = await runStats(mode, payload, setProgress);
      if (r.error) throw new Error(String(r.error));
      setResult(r);
      setLastPayload(payload);
    } catch (e) {
      const err = e as Error;
      setError(err.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const currentMode = MODES.find((m) => m.id === mode)!;

  const sampleFillers: Record<StatMode, () => void> = {
    descriptive: () =>
      setGroupText('72, 75, 78, 80, 81, 82, 84, 86, 88, 90, 91, 95'),
    ttest: () => {
      setGroup1Text('21, 22, 19, 23, 24, 25, 20, 22');
      setGroup2Text('27, 29, 31, 28, 30, 32, 30, 33');
      setPaired(false);
    },
    anova: () =>
      setAnovaGroups([
        '15, 17, 18, 14, 16',
        '22, 24, 23, 25, 21',
        '30, 28, 27, 31, 29',
      ]),
    chi2: () => setTableText('30, 10\n20, 40'),
    correlation: () => {
      setXText('1, 2, 3, 4, 5, 6, 7, 8, 9, 10');
      setYText('2.1, 4.0, 6.2, 7.9, 10.1, 11.8, 14.2, 16.1, 17.9, 20.3');
    },
    regression: () => {
      setXText('1, 2, 3, 4, 5, 6, 7, 8, 9, 10');
      setYText('2.1, 4.0, 6.2, 7.9, 10.1, 11.8, 14.2, 16.1, 17.9, 20.3');
    },
  };

  return (
    <div className="min-h-screen flex flex-col app-canvas text-foreground relative overflow-hidden font-sans selection:bg-[#00A598]/30 transition-colors duration-700">
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="obs-drift-a absolute top-[-14%] right-[4%] w-[56%] h-[56%] rounded-full bg-[radial-gradient(circle,rgba(56,189,248,0.20),transparent_66%)] blur-[120px]"></div>
        <div className="obs-drift-b absolute bottom-[-16%] left-[0%] w-[52%] h-[52%] rounded-full bg-[radial-gradient(circle,rgba(168,85,247,0.18),transparent_66%)] blur-[120px]"></div>
        <div className="absolute inset-0 obs-starfield"></div>
        <div className="obs-sweep absolute -top-[24%] -right-[12%] w-[62%] h-[124%] opacity-40 dark:opacity-60"></div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes scanShimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }
        .scan-shimmer::after {
          content:''; position:absolute; inset:0;
          background:linear-gradient(90deg,transparent,rgba(0,165,152,0.35),transparent);
          animation: scanShimmer 1.4s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .scan-shimmer::after { animation: none !important; }
        }
      `}} />

      {/* Header */}
      <header className="clay-header h-[64px] lg:h-[72px] flex items-center justify-between px-4 lg:px-8 shrink-0 z-50">
        <div className="flex items-center gap-4 lg:gap-8">
          <Link
            href="/"
            className="font-black text-[18px] lg:text-[20px] tracking-tighter flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <div className="clay-primary w-8 h-8 rounded-lg flex items-center justify-center text-[15px]">✦</div>
            <div className="flex items-baseline">
              <span>VESTRIPPN</span>
              <span className="text-cyan-500 dark:text-cyan-300">✦</span>
            </div>
          </Link>
          <nav className="hidden sm:flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest">
            <Link
              href="/"
              className="clay-tab px-3 py-1.5 rounded-lg"
            >
              Signal
            </Link>
            <Link
              href="/research"
              className="clay-tab px-3 py-1.5 rounded-lg"
            >
              Survey
            </Link>
            <span className="clay-tab clay-tab-active px-3 py-1.5 rounded-lg">
              Spectra
            </span>
          </nav>
        </div>
        <div className="flex gap-4 lg:gap-6 items-center">
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-5 lg:p-8 pb-32 lg:pb-8 relative z-10">
        <div className="max-w-[1120px] mx-auto space-y-6 lg:space-y-8">

          {/* HERO */}
          <section className="flex flex-col items-center text-center pt-6 sm:pt-8 pb-2">
            <h1 className="font-black tracking-tighter leading-none mb-3 text-[24px] sm:text-[32px] lg:text-[40px] flex items-center gap-3 flex-wrap justify-center">
              <span className="text-neutral-900 dark:text-white leading-none">Spectra</span>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-500 via-indigo-500 to-violet-500 dark:from-cyan-300 dark:via-indigo-300 dark:to-violet-300">
                Readout
              </span>
            </h1>
            <p className="max-w-2xl font-mono text-[10px] sm:text-[11px] text-neutral-500 dark:text-neutral-400 uppercase tracking-[0.3em]">
              CPython · numpy · scipy.stats{' // '}
              <span className="text-cyan-600 dark:text-cyan-300 font-bold">Read the spectra on-station</span>
            </p>
          </section>

          <section className="clay-soft rounded-2xl p-5 sm:p-6">
            <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-5 lg:gap-8">
              <div>
                <p className="font-mono text-[10px] font-black uppercase tracking-[0.28em] text-cyan-600 dark:text-cyan-300">
                  What this station does
                </p>
                <h2 className="mt-2 text-[22px] sm:text-[26px] font-black tracking-tight text-neutral-900 dark:text-white">
                  Read the spectra of your extracted numbers.
                </h2>
                <p className="mt-3 text-[13px] leading-relaxed text-neutral-600 dark:text-slate-400">
                  The spectra deck runs descriptive summaries and common inferential tests right on-station in your browser with Pyodide, NumPy, and SciPy — a fast reading while you survey and extract, not a stand-in for a full analysis plan.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-3">
                {[
                  ['1. Pick a band', 'Choose the test that matches your question and data shape.', 'clay-mint'],
                  ['2. Feed the readout', 'Comma, space, or newline-separated numbers; sample data can fill the format.', 'clay-sky'],
                  ['3. Read it', 'Weigh p-values, effect sizes, descriptives, and the optional AI reading together.', 'clay-lilac'],
                ].map(([label, text, tone]) => (
                  <div key={label} className={`clay-soft ${tone} rounded-xl p-3`}>
                    <div className="text-[10px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-500">
                      {label}
                    </div>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-neutral-600 dark:text-slate-400">
                      {text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Runtime status pill */}
          <div className="clay-soft rounded-2xl px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono">
            <div className="flex items-center gap-3">
              <span
                className={`relative inline-block w-2 h-2 rounded-full ${
                  pyReady
                    ? 'bg-emerald-500'
                    : error
                    ? 'bg-red-500'
                    : 'bg-yellow-500 animate-pulse'
                }`}
              ></span>
              <span className="font-bold uppercase tracking-widest text-neutral-600 dark:text-slate-300">
                Spectrograph
              </span>
              <span className="text-neutral-500 dark:text-slate-400">
                {error
                  ? `error — ${error}`
                  : pyReady
                  ? 'ready · scipy loaded'
                  : progress || 'booting…'}
              </span>
            </div>
            <span className="text-[10px] uppercase tracking-widest text-neutral-400 dark:text-slate-500">
              Pyodide v0.26 · ~30 MB cached
            </span>
          </div>

          {/* Mode tabs */}
          <div className="clay p-5 rounded-2xl space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-[15px] tracking-tight flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 obs-pulse"></span>
                  Spectral Band
                </h2>
                <p className="text-[11px] text-neutral-500 dark:text-slate-400 mt-1">
                  {currentMode.desc}
                </p>
              </div>
              <button
                onClick={() => sampleFillers[mode]()}
                className="clay-button rounded-lg px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-neutral-500 dark:text-slate-400"
              >
                Load Test Signal
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setMode(m.id);
                    setResult(null);
                    setError(null);
                  }}
                  className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                    mode === m.id
                      ? 'clay-tab-active'
                      : 'clay-button text-neutral-500 dark:text-slate-400'
                  }`}
                >
                  <span className="font-black mr-1.5 opacity-70">{m.short}</span>
                  {m.label}
                </button>
              ))}
            </div>

            {/* Inputs per mode */}
            {mode === 'descriptive' && (
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-widest text-neutral-500 dark:text-slate-400 mb-2">
                  Sample values (comma / space / newline separated)
                </label>
                <textarea
                  value={groupText}
                  onChange={(e) => setGroupText(e.target.value)}
                  placeholder="72, 75, 78, 80, 81, 82, 84..."
                  className="clay-field w-full h-28 p-4 rounded-xl text-[13px] font-mono text-neutral-700 dark:text-slate-200 focus:outline-none resize-none custom-scrollbar"
                />
              </div>
            )}

            {mode === 'ttest' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-2">
                      Group 1 (control)
                    </label>
                    <textarea
                      value={group1Text}
                      onChange={(e) => setGroup1Text(e.target.value)}
                      className="clay-field w-full h-28 p-4 rounded-xl text-[13px] font-mono focus:outline-none resize-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400 mb-2">
                      Group 2 (treatment)
                    </label>
                    <textarea
                      value={group2Text}
                      onChange={(e) => setGroup2Text(e.target.value)}
                      className="clay-field w-full h-28 p-4 rounded-xl text-[13px] font-mono focus:outline-none resize-none"
                    />
                  </div>
                </div>
                <label className="inline-flex items-center gap-2 text-[12px] font-bold text-neutral-600 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={paired}
                    onChange={(e) => setPaired(e.target.checked)}
                    className="accent-[#00A598]"
                  />
                  Paired observations (use paired t-test)
                </label>
              </div>
            )}

            {mode === 'anova' && (
              <div className="space-y-3">
                {anovaGroups.map((text, i) => (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-bold uppercase tracking-widest text-neutral-500 dark:text-slate-400">
                        Group {i + 1}
                      </label>
                      {anovaGroups.length > 2 && (
                        <button
                          onClick={() =>
                            setAnovaGroups(
                              anovaGroups.filter((_, idx) => idx !== i)
                            )
                          }
                          className="clay-button rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-red-500"
                        >
                          ✕ Remove
                        </button>
                      )}
                    </div>
                    <textarea
                      value={text}
                      onChange={(e) => {
                        const next = [...anovaGroups];
                        next[i] = e.target.value;
                        setAnovaGroups(next);
                      }}
                      className="clay-field w-full h-20 p-3 rounded-xl text-[13px] font-mono focus:outline-none resize-none"
                    />
                  </div>
                ))}
                <button
                  onClick={() => setAnovaGroups([...anovaGroups, ''])}
                  className="clay-button rounded-lg px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-[#00A598]"
                >
                  + Add Group
                </button>
              </div>
            )}

            {mode === 'chi2' && (
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-widest text-neutral-500 dark:text-slate-400 mb-2">
                  Contingency table — one row per line, cells separated by comma/space
                </label>
                <textarea
                  value={tableText}
                  onChange={(e) => setTableText(e.target.value)}
                  placeholder="30, 10&#10;20, 40"
                  className="clay-field w-full h-28 p-4 rounded-xl text-[13px] font-mono focus:outline-none resize-none"
                />
              </div>
            )}

            {(mode === 'correlation' || mode === 'regression') && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-2">
                    X values
                  </label>
                  <textarea
                    value={xText}
                    onChange={(e) => setXText(e.target.value)}
                    className="clay-field w-full h-28 p-4 rounded-xl text-[13px] font-mono focus:outline-none resize-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400 mb-2">
                    Y values (same length as X)
                  </label>
                  <textarea
                    value={yText}
                    onChange={(e) => setYText(e.target.value)}
                    className="clay-field w-full h-28 p-4 rounded-xl text-[13px] font-mono focus:outline-none resize-none"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                onClick={handleRun}
                disabled={busy}
                className="clay-primary px-5 py-2.5 disabled:cursor-not-allowed text-[13px] font-bold rounded-xl active:scale-[0.98]"
              >
                {busy ? 'Reading…' : `Read ${currentMode.label}`}
              </button>
            </div>

            {error && (
              <div className="text-[12px] text-red-600 dark:text-red-400 font-mono px-1">
                {error}
              </div>
            )}
          </div>

          {/* Results */}
          {result && !error && (
            <div className="space-y-4">
              {mode === 'descriptive' && !!result.descriptive && (
                <DescriptiveCard
                  d={result.descriptive as Record<string, unknown>}
                />
              )}

              {mode === 'ttest' && (
                <>
                  <div className="clay p-5 rounded-2xl space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[11px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-400">
                        {String(result.test)}
                      </div>
                      <PChip p={Number(result.p)} />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <StatTile label="t" value={fmt(Number(result.t))} />
                      <StatTile label="df" value={fmt(Number(result.df), 2)} />
                      <StatTile
                        label="p-value"
                        value={fmtP(Number(result.p))}
                      />
                      <StatTile
                        label="Cohen's d"
                        value={fmt(Number(result.cohen_d))}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <DescriptiveCard
                      title="Group 1"
                      d={result.group1 as Record<string, unknown>}
                    />
                    <DescriptiveCard
                      title="Group 2"
                      d={result.group2 as Record<string, unknown>}
                    />
                  </div>
                </>
              )}

              {mode === 'anova' && (
                <>
                  <div className="clay p-5 rounded-2xl space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[11px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-400">
                        {String(result.test)}
                      </div>
                      <PChip p={Number(result.p)} />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <StatTile label="F" value={fmt(Number(result.F))} />
                      <StatTile
                        label="df (between)"
                        value={String(result.df_between)}
                      />
                      <StatTile
                        label="df (within)"
                        value={String(result.df_within)}
                      />
                      <StatTile
                        label="η²"
                        value={fmt(Number(result.eta_squared))}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {(result.groups as Record<string, unknown>[]).map(
                      (g, i) => (
                        <DescriptiveCard
                          key={i}
                          title={`Group ${i + 1}`}
                          d={g}
                        />
                      )
                    )}
                  </div>
                </>
              )}

              {mode === 'chi2' && (
                <div className="clay p-5 rounded-2xl space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[11px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-400">
                      {String(result.test)}
                    </div>
                    <PChip p={Number(result.p)} />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <StatTile label="χ²" value={fmt(Number(result.chi2))} />
                    <StatTile label="df" value={String(result.df)} />
                    <StatTile
                      label="p-value"
                      value={fmtP(Number(result.p))}
                    />
                    <StatTile
                      label="Cramér's V"
                      value={fmt(Number(result.cramer_v))}
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-400 mb-2">
                        Observed
                      </div>
                      <Table cells={result.observed as number[][]} />
                    </div>
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-400 mb-2">
                        Expected (under H₀)
                      </div>
                      <Table cells={result.expected as number[][]} />
                    </div>
                  </div>
                </div>
              )}

              {mode === 'correlation' && (
                <div className="clay p-5 rounded-2xl space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[11px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-400">
                      {String(result.test)} · n = {String(result.n)}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="clay-soft rounded-xl p-4 space-y-2">
                      <div className="text-[11px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                        Pearson r
                      </div>
                      <div className="text-2xl font-black">
                        {fmt(Number(result.pearson_r))}
                      </div>
                      <PChip p={Number(result.pearson_p)} />
                    </div>
                    <div className="clay-soft rounded-xl p-4 space-y-2">
                      <div className="text-[11px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400">
                        Spearman ρ
                      </div>
                      <div className="text-2xl font-black">
                        {fmt(Number(result.spearman_r))}
                      </div>
                      <PChip p={Number(result.spearman_p)} />
                    </div>
                  </div>
                </div>
              )}

              {mode === 'regression' && (
                <div className="clay p-5 rounded-2xl space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[11px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-400">
                      {String(result.test)} · n = {String(result.n)}
                    </div>
                    <PChip p={Number(result.p)} />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <StatTile
                      label="Slope (b)"
                      value={fmt(Number(result.slope))}
                    />
                    <StatTile
                      label="Intercept (a)"
                      value={fmt(Number(result.intercept))}
                    />
                    <StatTile label="r" value={fmt(Number(result.r))} />
                    <StatTile
                      label="R²"
                      value={fmt(Number(result.r_squared))}
                    />
                    <StatTile
                      label="Slope SE"
                      value={fmt(Number(result.stderr))}
                    />
                    <StatTile
                      label="p-value"
                      value={fmtP(Number(result.p))}
                    />
                  </div>
                  <div className="clay-inset font-mono text-[13px] mt-2 px-3 py-2 rounded-lg">
                    ŷ = {fmt(Number(result.intercept), 4)} +{' '}
                    {fmt(Number(result.slope), 4)} · x
                  </div>
                </div>
              )}

              {/* AI Interpretation */}
              <AIInterpretation
                busy={aiBusy}
                text={aiText}
                error={aiError}
                onInterpret={async () => {
                  if (!result || !lastPayload) return;
                  setAiBusy(true);
                  setAiError(null);
                  setAiText('');
                  try {
                    const resp = await fetch('/api/interpret', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({
                        mode,
                        payload: lastPayload,
                        result,
                      }),
                    });
                    const data = (await resp.json()) as {
                      text?: string;
                      error?: string;
                    };
                    if (!resp.ok || data.error)
                      throw new Error(data.error || `HTTP ${resp.status}`);
                    setAiText(data.text || '');
                  } catch (e) {
                    setAiError((e as Error).message || String(e));
                  } finally {
                    setAiBusy(false);
                  }
                }}
              />
            </div>
          )}

          {!result && !error && (
            <div className="clay-soft p-6 rounded-2xl text-center text-[13px] text-neutral-500 dark:text-slate-400 leading-relaxed">
              Pick a spectral band above, feed the readout your numbers (or hit{' '}
              <span className="font-bold">Load Test Signal</span>), and{' '}
              <span className="font-bold">take the reading</span>. The first
              reading warms up Pyodide{' '}
              <span className="font-mono">(~30 MB, cached after)</span> — every
              reading after that is instant and stays entirely in this tab.
            </div>
          )}
        </div>
      </main>

      <MobileTabBar />
    </div>
  );
}

function Table({ cells }: { cells: number[][] }) {
  if (!Array.isArray(cells) || cells.length === 0) return null;
  return (
    <div className="clay-inset overflow-x-auto rounded-xl">
      <table className="w-full text-[12px] font-mono">
        <tbody>
          {cells.map((row, ri) => (
            <tr
              key={ri}
              className="odd:bg-white/40 dark:odd:bg-white/[0.025]"
            >
              {row.map((v, ci) => (
                <td
                  key={ci}
                  className="px-3 py-1.5 text-right border-b border-black/5 dark:border-white/5"
                >
                  {Number.isFinite(v) ? fmt(v, 3) : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function parseSections(text: string): {
  interpretation: string;
  assumptions: string;
  apa: string;
} {
  const out = { interpretation: '', assumptions: '', apa: '' };
  if (!text) return out;
  const parts = text
    .split(/^##\s+/m)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const header = (nl >= 0 ? part.slice(0, nl) : part).toLowerCase().trim();
    const body = nl >= 0 ? part.slice(nl + 1).trim() : '';
    if (header.startsWith('interpretation')) out.interpretation = body;
    else if (header.startsWith('assumption')) out.assumptions = body;
    else if (header.startsWith('apa')) out.apa = body;
  }
  if (!out.interpretation && !out.assumptions && !out.apa) {
    out.interpretation = text.trim();
  }
  return out;
}

function AIInterpretation({
  busy,
  text,
  error,
  onInterpret,
}: {
  busy: boolean;
  text: string;
  error: string | null;
  onInterpret: () => void;
}) {
  const { interpretation, assumptions, apa } = parseSections(text);
  const hasAny = !!(interpretation || assumptions || apa);

  return (
    <div className="clay p-5 rounded-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-neutral-600 dark:text-slate-300 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 obs-pulse"></span>
            Ground Control
          </span>
          <span className="text-[9px] font-mono uppercase tracking-widest text-neutral-400 dark:text-slate-500 border border-black/10 dark:border-white/10 rounded px-1.5 py-0.5">
            ChatGPT · gpt-4o-mini
          </span>
        </div>
        <button
          onClick={onInterpret}
          disabled={busy}
          className="clay-primary px-4 py-2 disabled:cursor-not-allowed text-[11px] font-bold uppercase tracking-widest rounded-lg"
        >
          {busy ? 'Reading…' : hasAny ? 'Re-read' : 'Ask Ground Control'}
        </button>
      </div>

      {!hasAny && !busy && !error && (
        <p className="text-[12px] text-neutral-500 dark:text-slate-400 leading-relaxed">
          Hail <strong>Ground Control</strong> for a plain-English reading, an
          assumption check, and an APA-style write-up of this analysis.
          (Requires <code className="font-mono text-[11px]">OPENAI_API_KEY</code> set on the Vercel project.)
        </p>
      )}
      {busy && (
        <p className="text-[12px] text-neutral-500 dark:text-slate-400 italic">
          Raising Ground Control for a biostatistician&apos;s read…
        </p>
      )}
      {error && (
        <p className="text-[12px] text-red-600 dark:text-red-400 font-mono leading-relaxed">
          {error}
        </p>
      )}
      {hasAny && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <section className="clay-soft rounded-xl p-4 space-y-1.5">
            <div className="text-[10px] font-black uppercase tracking-widest text-cyan-600 dark:text-cyan-300">
              Interpretation
            </div>
            <p className="text-[13px] leading-relaxed text-neutral-700 dark:text-slate-200 whitespace-pre-wrap">
              {interpretation || '—'}
            </p>
          </section>
          <section className="clay-soft rounded-xl p-4 space-y-1.5">
            <div className="text-[10px] font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-400">
              Assumptions
            </div>
            <p className="text-[13px] leading-relaxed text-neutral-700 dark:text-slate-200 whitespace-pre-wrap">
              {assumptions || '—'}
            </p>
          </section>
          <section className="clay-soft rounded-xl p-4 space-y-1.5">
            <div className="text-[10px] font-black uppercase tracking-widest text-violet-600 dark:text-violet-300">
              APA Write-up
            </div>
            <p className="text-[13px] leading-relaxed font-serif text-neutral-700 dark:text-slate-200 whitespace-pre-wrap">
              {apa || '—'}
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
