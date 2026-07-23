'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import ThemeToggle from '@/components/ThemeToggle';
import MobileTabBar from '@/components/MobileTabBar';
import {
  crosstab,
  effectContinuous,
  effectFrom2x2,
  getPyodide,
  numericColumn,
  parseDataset,
  parseNumbers,
  parseTable,
  runStats,
  splitByGroup,
  type Dataset,
  type StatMode,
  type StatPayload,
} from '@/lib/stats';

type Result = Record<string, unknown> | null;
type InputSource = 'dataset' | 'manual';

// A sample long-format dataset (one row per observation) for the data table.
const SAMPLE_DATASET = `group\tscore\tage\tsex\timproved
control\t21\t54\tF\tno
control\t22\t61\tM\tno
control\t19\t58\tF\tyes
control\t23\t49\tM\tno
control\t24\t63\tF\tno
control\t20\t57\tM\tyes
treatment\t27\t52\tF\tyes
treatment\t29\t60\tM\tyes
treatment\t31\t47\tF\tyes
treatment\t28\t55\tM\tno
treatment\t30\t62\tF\tyes
treatment\t33\t50\tM\tyes`;

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
  {
    id: 'meta',
    label: 'Meta-analysis',
    short: 'META',
    desc: 'Pool study effect sizes; forest & funnel plots with heterogeneity.',
  },
  {
    id: 'diagnostic',
    label: 'Diagnostic',
    short: 'DIAG',
    desc: 'Sensitivity, specificity, predictive values, likelihood ratios from a 2×2.',
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

const finiteValue = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const fmtOptional = (value: unknown, digits = 4): string => {
  const number = finiteValue(value);
  return number === null ? 'Not available' : fmt(number, digits);
};

const fmtOptionalP = (value: unknown): string => {
  const number = finiteValue(value);
  return number === null ? 'Not available' : fmtP(number);
};

const fmtCI = (low: unknown, high: unknown, digits = 3): string => {
  const lower = finiteValue(low);
  const upper = finiteValue(high);
  if (lower === null || upper === null) return 'Not available';
  return `${fmt(lower, digits)} to ${fmt(upper, digits)}`;
};

function AssumptionPanel({ flags }: { flags: unknown }) {
  const items = Array.isArray(flags)
    ? flags.filter((item): item is string => typeof item === 'string')
    : [];

  return (
    <div
      className={`clay-soft rounded-xl p-4 ${
        items.length > 0 ? 'clay-amber' : 'clay-mint'
      }`}
    >
      <div className="text-[10px] font-black uppercase tracking-widest text-neutral-600 dark:text-slate-300">
        Automated assumption check
      </div>
      {items.length > 0 ? (
        <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-neutral-700 dark:text-slate-300">
          {items.map((item) => (
            <li key={item}>• {item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[12px] leading-relaxed text-neutral-600 dark:text-slate-400">
          No automatic warning was triggered. This does not prove assumptions;
          inspect study design, distributions, and plots before inference.
        </p>
      )}
    </div>
  );
}

// The rank-based counterpart to a parametric test (the "which test when"
// alternative), shown alongside so a normality flag has an immediate fallback.
function NonParametricLine({
  np,
}: {
  np: { test: string; statistic: number; p: number; df?: number } | null | undefined;
}) {
  if (!np) return null;
  return (
    <div className="clay-soft rounded-xl p-4 flex flex-wrap items-center justify-between gap-2">
      <div className="text-[12px] text-neutral-700 dark:text-slate-300">
        <span className="text-[10px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-400 mr-2">
          Non-parametric check
        </span>
        <span className="font-bold">{np.test}</span>
        <span className="font-mono text-neutral-500 dark:text-slate-400 ml-2">
          {np.df !== undefined
            ? `H = ${fmt(np.statistic, 2)}, df = ${np.df}`
            : `stat = ${fmt(np.statistic, 2)}`}{' '}
          · p = {fmtP(np.p)}
        </span>
      </div>
      <PChip p={np.p} />
    </div>
  );
}

// Diagnostic-accuracy readout — sensitivity/specificity (with Wilson CIs),
// predictive values, likelihood ratios (Jaeschke bands), and the Bayes /
// post-test probability chain, matching the diagnostic-test lecture.
function DiagnosticResult({ result }: { result: Record<string, unknown> }) {
  const c = result.counts as { tp: number; fp: number; fn: number; tn: number; n: number };
  const W = (k: string) =>
    result[k] as { est: number; low: number; high: number } | null;
  const num = (k: string) =>
    typeof result[k] === 'number' ? (result[k] as number) : null;
  const pct = (x: number | null | undefined, d = 1) =>
    x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(d)}%`;
  const wilsonStr = (w: { est: number; low: number; high: number } | null) =>
    w ? `${pct(w.est)} [${pct(w.low)}, ${pct(w.high)}]` : '—';
  const fmtLR = (lr: number | null) =>
    lr == null || !Number.isFinite(lr) ? '—' : lr.toFixed(2);
  const lrBand = (lr: number | null, positive: boolean) => {
    if (lr == null || !Number.isFinite(lr)) return '—';
    if (positive) {
      if (lr > 10) return 'large';
      if (lr >= 5) return 'moderate';
      if (lr >= 2) return 'small';
      return 'minimal';
    }
    if (lr < 0.1) return 'large';
    if (lr <= 0.2) return 'moderate';
    if (lr <= 0.5) return 'small';
    return 'minimal';
  };
  const lrPos = num('lr_pos');
  const lrNeg = num('lr_neg');

  return (
    <div className="space-y-4">
      <div className="clay p-5 rounded-2xl space-y-4">
        <div className="text-[11px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-400">
          Diagnostic accuracy · N = {c.n} · prevalence {pct(num('prevalence'))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatTile label="Sensitivity" value={wilsonStr(W('sensitivity'))} accent="text-cyan-600 dark:text-cyan-300" />
          <StatTile label="Specificity" value={wilsonStr(W('specificity'))} accent="text-cyan-600 dark:text-cyan-300" />
          <StatTile label="PPV" value={wilsonStr(W('ppv'))} />
          <StatTile label="NPV" value={wilsonStr(W('npv'))} />
          <StatTile label="Accuracy" value={pct(num('accuracy'))} />
          <StatTile label="False-negative rate" value={pct(num('fnr'))} />
          <StatTile label="LR+" value={fmtLR(lrPos)} />
          <StatTile label="LR−" value={fmtLR(lrNeg)} />
        </div>
        <div className="clay-soft rounded-xl p-4 text-[12px] text-neutral-600 dark:text-slate-300 space-y-1.5">
          <div className="text-[10px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-400">
            Likelihood-ratio strength (Jaeschke)
          </div>
          <div>
            LR+ {fmtLR(lrPos)} → <span className="font-bold">{lrBand(lrPos, true)}</span> shift toward disease ·
            LR− {fmtLR(lrNeg)} → <span className="font-bold">{lrBand(lrNeg, false)}</span> shift away.
          </div>
          <div className="text-neutral-400 dark:text-slate-500">
            SNout — a sensitive test, when negative, rules out · SPin — a specific test, when positive, rules in.
            (Sensitivity = true-positive proportion.)
          </div>
        </div>
      </div>

      <div className="clay p-5 rounded-2xl space-y-3">
        <div className="text-[11px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-400">
          Post-test probability (Bayes)
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <StatTile label="Pre-test (prevalence)" value={pct(num('prevalence'))} />
          <StatTile label="After a positive test" value={pct(num('post_test_prob_pos'))} accent="text-emerald-600 dark:text-emerald-300" />
          <StatTile label="After a negative test" value={pct(num('post_test_prob_neg'))} accent="text-rose-500 dark:text-rose-400" />
        </div>
        <p className="text-[11px] text-neutral-400 dark:text-slate-500">
          post-test odds = pre-test odds × LR; post-test probability = odds ÷ (1 + odds).
        </p>
      </div>
    </div>
  );
}

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
  const f = (k: string) => fmtOptional(d[k]);
  const normality =
    d.normality && typeof d.normality === 'object'
      ? (d.normality as Record<string, unknown>)
      : null;
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
        <StatTile label="SE" value={f('se')} />
        <StatTile
          label="Mean 95% CI"
          value={fmtCI(d.mean_ci95_low, d.mean_ci95_high)}
        />
        <StatTile label="Skewness" value={f('skewness')} />
        <StatTile
          label="Shapiro p"
          value={normality ? fmtOptionalP(normality.p) : 'Not available'}
        />
      </div>
    </div>
  );
}

function pThresholdColor(p: number) {
  if (!isFinite(p)) return 'text-neutral-400';
  if (p < 0.05)
    return 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-500/30';
  return 'text-yellow-700 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-500/15 border-yellow-200 dark:border-yellow-500/30';
}

function PChip({ p }: { p: number }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md border ${pThresholdColor(
        p
      )}`}
      title={
        p < 0.05
          ? 'The p-value is below the conventional α = 0.05 threshold.'
          : 'The p-value is at or above the conventional α = 0.05 threshold.'
      }
    >
      p = {fmtP(p)}
      <span className="opacity-75">
        {p < 0.05 ? 'below α .05' : 'at/above α .05'}
      </span>
    </span>
  );
}

// ---------- Meta-analysis result + plots ----------

type Pooled = {
  estimate: number;
  se: number;
  ci_low: number;
  ci_high: number;
  z: number;
  p: number | null;
};
type MetaStudy = {
  index: number;
  yi: number;
  sei: number;
  ci_low: number;
  ci_high: number;
  w_fixed: number;
  w_random: number;
  subgroup?: string | null;
};
type SubgroupEntry = {
  label: string;
  k: number;
  fixed: Pooled;
  random: Pooled;
  I2: number;
  tau2: number;
};
type SubgroupResult = {
  groups: SubgroupEntry[];
  Q_between: number;
  df: number;
  p: number | null;
} | null;

const linScale =
  (d0: number, d1: number, r0: number, r1: number) =>
  (v: number): number =>
    d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);

function niceTicks(min: number, max: number, count = 5): number[] {
  if (!isFinite(min) || !isFinite(max) || min === max) return [min];
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(min + ((max - min) * i) / (count - 1));
  return out;
}

type ForestRow =
  | { kind: 'header'; label: string }
  | { kind: 'study'; s: MetaStudy; label: string }
  | { kind: 'diamond'; label: string; p: Pooled; overall?: boolean };

function ForestPlot({
  studies,
  labels,
  random,
  log,
  subgroups,
}: {
  studies: MetaStudy[];
  labels: string[];
  random: Pooled;
  log: boolean;
  subgroups?: SubgroupEntry[] | null;
}) {
  const disp = (v: number) => (log ? Math.exp(v) : v);
  const W = 720;
  const rowH = 26;
  const top = 24;
  const plotL = 168;
  const plotR = 520;

  // Build the ordered row list (grouped by subgroup when available).
  const rows: ForestRow[] = [];
  if (subgroups && subgroups.length >= 2) {
    subgroups.forEach((g) => {
      rows.push({ kind: 'header', label: g.label });
      studies.forEach((s, i) => {
        if ((s.subgroup ?? '') === g.label)
          rows.push({ kind: 'study', s, label: labels[i] ?? `Study ${i + 1}` });
      });
      rows.push({ kind: 'diamond', label: `${g.label} (random)`, p: g.random });
    });
  } else {
    studies.forEach((s, i) =>
      rows.push({ kind: 'study', s, label: labels[i] ?? `Study ${i + 1}` })
    );
  }
  rows.push({ kind: 'diamond', label: 'Overall (random)', p: random, overall: true });

  const axisY = top + rows.length * rowH + 14;
  const H = axisY + 34;

  const allCI = [
    ...studies.flatMap((s) => [s.ci_low, s.ci_high]),
    random.ci_low,
    random.ci_high,
    ...(subgroups ?? []).flatMap((g) => [g.random.ci_low, g.random.ci_high]),
    0,
  ];
  const lo = Math.min(...allCI);
  const hi = Math.max(...allCI);
  const pad = (hi - lo) * 0.06 || 1;
  const x = linScale(lo - pad, hi + pad, plotL, plotR);
  const nullX = x(0);
  const maxW = Math.max(...studies.map((s) => s.w_random), 1);
  const sqSize = (w: number) => 5 + (Math.sqrt(w / maxW) || 0) * 9;
  const fmtNum = (v: number) => fmt(disp(v), log ? 2 : 3);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full text-neutral-600 dark:text-slate-300"
      role="img"
      aria-label="Forest plot"
    >
      <text x={12} y={16} className="fill-neutral-500 dark:fill-slate-400" fontSize="11" fontWeight="700">Study</text>
      <text x={plotR + 6} y={16} className="fill-neutral-500 dark:fill-slate-400" fontSize="11" fontWeight="700">
        {log ? 'Ratio [95% CI]' : 'Effect [95% CI]'}
      </text>
      <line x1={nullX} y1={top - 4} x2={nullX} y2={axisY} stroke="currentColor" strokeOpacity="0.35" strokeDasharray="4 3" />
      {rows.map((row, i) => {
        const cy = top + i * rowH + rowH / 2;
        if (row.kind === 'header') {
          return (
            <text key={i} x={12} y={cy + 3.5} fontSize="10.5" fontWeight="800" className="fill-neutral-500 dark:fill-slate-400" letterSpacing="0.5">
              {row.label.slice(0, 30).toUpperCase()}
            </text>
          );
        }
        if (row.kind === 'study') {
          const s = row.s;
          const sz = sqSize(s.w_random);
          return (
            <g key={i}>
              <text x={22} y={cy + 3.5} fontSize="11.5" className="fill-neutral-700 dark:fill-slate-200">
                {row.label.slice(0, 22)}
              </text>
              <line x1={x(s.ci_low)} y1={cy} x2={x(s.ci_high)} y2={cy} stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.4" />
              <rect x={x(s.yi) - sz / 2} y={cy - sz / 2} width={sz} height={sz} className="fill-cyan-600 dark:fill-cyan-300" />
              <text x={plotR + 6} y={cy + 3.5} fontSize="10.5" className="fill-neutral-600 dark:fill-slate-300" fontFamily="monospace">
                {fmtNum(s.yi)} [{fmtNum(s.ci_low)}, {fmtNum(s.ci_high)}]
              </text>
            </g>
          );
        }
        // diamond
        const p = row.p;
        const dcol = row.overall
          ? 'fill-violet-600 dark:fill-violet-300 stroke-violet-700 dark:stroke-violet-200'
          : 'fill-amber-500 dark:fill-amber-300 stroke-amber-600 dark:stroke-amber-200';
        return (
          <g key={i}>
            <polygon
              points={`${x(p.ci_low)},${cy} ${x(p.estimate)},${cy - 7} ${x(p.ci_high)},${cy} ${x(p.estimate)},${cy + 7}`}
              className={dcol}
              strokeWidth="1"
            />
            <text x={row.overall ? 12 : 22} y={cy + 3.5} fontSize="11" fontWeight="700" className="fill-neutral-800 dark:fill-white">
              {row.label}
            </text>
            <text x={plotR + 6} y={cy + 3.5} fontSize="10.5" fontWeight="700" className="fill-neutral-800 dark:fill-white" fontFamily="monospace">
              {fmtNum(p.estimate)} [{fmtNum(p.ci_low)}, {fmtNum(p.ci_high)}]
            </text>
          </g>
        );
      })}
      <line x1={plotL} y1={axisY} x2={plotR} y2={axisY} stroke="currentColor" strokeOpacity="0.4" />
      {niceTicks(lo - pad, hi + pad).map((t, i) => (
        <g key={i}>
          <line x1={x(t)} y1={axisY} x2={x(t)} y2={axisY + 4} stroke="currentColor" strokeOpacity="0.4" />
          <text x={x(t)} y={axisY + 16} fontSize="9.5" textAnchor="middle" className="fill-neutral-500 dark:fill-slate-400" fontFamily="monospace">
            {fmt(disp(t), 2)}
          </text>
        </g>
      ))}
      {/* Directional cue relative to the line of no effect (RevMan convention). */}
      <text x={nullX - 6} y={axisY + 30} fontSize="9" textAnchor="end" className="fill-neutral-400 dark:fill-slate-500">
        ← favours treatment
      </text>
      <text x={nullX + 6} y={axisY + 30} fontSize="9" textAnchor="start" className="fill-neutral-400 dark:fill-slate-500">
        favours control →
      </text>
    </svg>
  );
}

function FunnelPlot({
  studies,
  random,
  log,
}: {
  studies: MetaStudy[];
  random: Pooled;
  log: boolean;
}) {
  const disp = (v: number) => (log ? Math.exp(v) : v);
  const W = 460;
  const H = 340;
  const l = 46;
  const r = 440;
  const t = 18;
  const b = 288;
  const maxSE = Math.max(...studies.map((s) => s.sei), random.se) * 1.05 || 1;
  const spread = 1.96 * maxSE;
  const xlo = Math.min(...studies.map((s) => s.yi), random.estimate - spread);
  const xhi = Math.max(...studies.map((s) => s.yi), random.estimate + spread);
  const xpad = (xhi - xlo) * 0.05 || 1;
  const x = linScale(xlo - xpad, xhi + xpad, l, r);
  const y = linScale(0, maxSE, t, b); // SE 0 at top
  const cx = x(random.estimate);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full text-neutral-600 dark:text-slate-300"
      role="img"
      aria-label="Funnel plot"
    >
      {/* axes */}
      <line x1={l} y1={t} x2={l} y2={b} stroke="currentColor" strokeOpacity="0.4" />
      <line x1={l} y1={b} x2={r} y2={b} stroke="currentColor" strokeOpacity="0.4" />
      {/* pseudo 95% funnel */}
      <line x1={cx} y1={y(0)} x2={x(random.estimate - spread)} y2={y(maxSE)} stroke="currentColor" strokeOpacity="0.3" strokeDasharray="4 3" />
      <line x1={cx} y1={y(0)} x2={x(random.estimate + spread)} y2={y(maxSE)} stroke="currentColor" strokeOpacity="0.3" strokeDasharray="4 3" />
      {/* pooled line */}
      <line x1={cx} y1={t} x2={cx} y2={b} className="stroke-violet-500 dark:stroke-violet-300" strokeOpacity="0.7" strokeDasharray="5 3" />
      {/* points */}
      {studies.map((s, i) => (
        <circle key={i} cx={x(s.yi)} cy={y(s.sei)} r={4} className="fill-cyan-600 dark:fill-cyan-300" fillOpacity="0.85" />
      ))}
      {/* axis labels */}
      <text x={(l + r) / 2} y={H - 4} fontSize="10" textAnchor="middle" className="fill-neutral-500 dark:fill-slate-400">
        {log ? 'Effect (ratio scale, log units)' : 'Effect size'}
      </text>
      <text x={14} y={(t + b) / 2} fontSize="10" textAnchor="middle" transform={`rotate(-90 14 ${(t + b) / 2})`} className="fill-neutral-500 dark:fill-slate-400">
        Standard error
      </text>
      {niceTicks(xlo - xpad, xhi + xpad, 5).map((tv, i) => (
        <text key={i} x={x(tv)} y={b + 14} fontSize="9" textAnchor="middle" className="fill-neutral-400 dark:fill-slate-500" fontFamily="monospace">
          {fmt(disp(tv), 2)}
        </text>
      ))}
      {niceTicks(0, maxSE, 4).map((tv, i) => (
        <text key={i} x={l - 6} y={y(tv) + 3} fontSize="9" textAnchor="end" className="fill-neutral-400 dark:fill-slate-500" fontFamily="monospace">
          {fmt(tv, 2)}
        </text>
      ))}
    </svg>
  );
}

function MetaResult({
  result,
  meta,
}: {
  result: Record<string, unknown>;
  meta: { labels: string[]; log: boolean; kind?: string; measure?: string } | null;
}) {
  const log = meta?.log ?? false;
  const studies = (result.studies as MetaStudy[]) ?? [];
  const random = result.random as Pooled;
  const fixed = result.fixed as Pooled;
  const het = result.heterogeneity as {
    Q: number;
    df: number;
    p: number | null;
    I2: number;
    tau2: number;
  };
  const egger = result.egger as {
    intercept: number | null;
    se: number | null;
    p: number | null;
    note: string;
  };
  const subgroup = (result.subgroup as SubgroupResult) ?? null;
  const prediction = (result.prediction as { low: number; high: number } | null) ?? null;
  const loo =
    (result.leave_one_out as {
      omitted: number;
      estimate: number;
      ci_low: number;
      ci_high: number;
      I2: number;
    }[]) ?? [];
  const method = (result.method as string) ?? null;
  const totalEvents =
    (result.total_events as { treatment: number; control: number } | null) ?? null;
  const kind = meta?.kind ?? 'effect';
  // Number needed to treat / harm from the pooled risk difference (NNT = 1/|RD|).
  // Benefit (RD<0) rounds up, harm (RD>0) rounds down, per the course.
  let nntTile: { label: string; value: string } | null = null;
  if (meta?.measure === 'rd' && random) {
    const rd = random.estimate;
    const absrd = Math.abs(rd);
    if (absrd < 1e-9) {
      nntTile = { label: 'NNT', value: '∞ (no difference)' };
    } else {
      const beneficial = rd < 0;
      const n = 1 / absrd;
      const rounded = beneficial ? Math.ceil(n) : Math.floor(n);
      const crosses = random.ci_low < 0 && random.ci_high > 0;
      nntTile = {
        label: beneficial ? 'NNT (benefit)' : 'NNH (harm)',
        value: crosses ? `${rounded} · CI crosses 0` : `${rounded}`,
      };
    }
  }
  const labels =
    meta?.labels ?? studies.map((_, i) => `Study ${i + 1}`);
  const disp = (v: number) => (log ? Math.exp(v) : v);
  // RevMan-style p-value string: "P = 0.01" or "P < 0.0001".
  const pStr = (p: number | null | undefined) => {
    if (p === null || p === undefined || !Number.isFinite(p)) return 'P —';
    return p < 0.0001 ? 'P < 0.0001' : `P = ${p < 0.01 ? p.toFixed(4) : p.toFixed(2)}`;
  };
  const showCI = (p: Pooled) =>
    `${fmt(disp(p.estimate), log ? 3 : 3)} [${fmt(disp(p.ci_low), 3)}, ${fmt(disp(p.ci_high), 3)}]`;

  return (
    <div className="space-y-4">
      <div className="clay p-5 rounded-2xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-400">
            Meta-analysis · {String(result.k)} studies{log ? ' · ratio scale' : ''}
          </div>
          {random.p !== null && <PChip p={Number(random.p)} />}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatTile
            label="Random effect"
            value={showCI(random)}
            accent="text-violet-600 dark:text-violet-300"
          />
          <StatTile label="Fixed effect" value={showCI(fixed)} />
          <StatTile label="I² (heterogeneity)" value={`${fmt(het.I2, 1)}%`} />
          <StatTile label="τ² (between-study var)" value={fmt(het.tau2, 4)} />
          <StatTile
            label={`Cochran's Q (df ${het.df})`}
            value={fmt(het.Q, 2)}
          />
          <StatTile label="Q p-value" value={fmtOptionalP(het.p)} />
          <StatTile
            label="Egger intercept"
            value={egger.intercept === null ? '—' : fmt(egger.intercept, 3)}
          />
          <StatTile label="Egger p" value={fmtOptionalP(egger.p)} />
          {prediction && (
            <StatTile
              label="95% prediction interval"
              value={`${fmt(disp(prediction.low), 3)} to ${fmt(disp(prediction.high), 3)}`}
            />
          )}
          {nntTile && (
            <StatTile
              label={nntTile.label}
              value={nntTile.value}
              accent="text-cyan-600 dark:text-cyan-300"
            />
          )}
        </div>

        {/* RevMan / Cochrane-style readout — matches the SRMA lecture's forest plots. */}
        <div className="rounded-xl bg-black/[0.03] dark:bg-white/[0.04] px-4 py-3 font-mono text-[11.5px] leading-relaxed text-neutral-600 dark:text-slate-300 space-y-1">
          {method && (
            <div className="text-neutral-400 dark:text-slate-500">{method}</div>
          )}
          {kind === 'events' && totalEvents && (
            <div>
              Total events: {totalEvents.treatment} (treatment), {totalEvents.control} (control)
            </div>
          )}
          <div>
            Heterogeneity: τ² = {fmt(het.tau2, 2)}; χ² = {fmt(het.Q, 2)}, df = {het.df} ({pStr(het.p)}); I² = {fmt(het.I2, 0)}%
          </div>
          <div>
            Test for overall effect: Z = {fmt(Math.abs(Number(random.z)), 2)} ({pStr(random.p as number | null)})
          </div>
        </div>
      </div>

      {subgroup && (
        <div className="clay p-5 rounded-2xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-400">
              Subgroups · test for difference
            </div>
            {subgroup.p !== null && <PChip p={Number(subgroup.p)} />}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatTile label={`Q between (df ${subgroup.df})`} value={fmt(subgroup.Q_between, 2)} />
            <StatTile label="Q between p" value={fmtOptionalP(subgroup.p)} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] font-mono border-collapse">
              <thead>
                <tr className="text-neutral-500 dark:text-slate-400">
                  <th className="text-left px-2 py-1">Subgroup</th>
                  <th className="text-right px-2 py-1">k</th>
                  <th className="text-right px-2 py-1">Random [95% CI]</th>
                  <th className="text-right px-2 py-1">I²</th>
                </tr>
              </thead>
              <tbody>
                {subgroup.groups.map((g, i) => (
                  <tr key={i} className="odd:bg-black/[0.02] dark:odd:bg-white/[0.02]">
                    <td className="px-2 py-1 text-neutral-700 dark:text-slate-200 whitespace-nowrap">{g.label}</td>
                    <td className="px-2 py-1 text-right">{g.k}</td>
                    <td className="px-2 py-1 text-right">{showCI(g.random)}</td>
                    <td className="px-2 py-1 text-right">{fmt(g.I2, 1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="clay-soft p-5 rounded-2xl space-y-2">
        <div className="text-[11px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-400">
          Forest plot
        </div>
        <div className="overflow-x-auto">
          <ForestPlot
            studies={studies}
            labels={labels}
            random={random}
            log={log}
            subgroups={subgroup?.groups}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="clay-soft p-5 rounded-2xl space-y-2">
          <div className="text-[11px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-400">
            Funnel plot
          </div>
          <FunnelPlot studies={studies} random={random} log={log} />
          <p className="text-[11px] text-neutral-500 dark:text-slate-400 leading-relaxed">
            {egger.note}
          </p>
        </div>
        <div className="clay-soft p-5 rounded-2xl overflow-x-auto">
          <div className="text-[11px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-400 mb-2">
            Per-study
          </div>
          <table className="w-full text-[12px] font-mono border-collapse">
            <thead>
              <tr className="text-neutral-500 dark:text-slate-400">
                <th className="text-left px-2 py-1">Study</th>
                <th className="text-right px-2 py-1">{log ? 'Ratio' : 'Effect'}</th>
                <th className="text-right px-2 py-1">95% CI</th>
                <th className="text-right px-2 py-1">Weight</th>
              </tr>
            </thead>
            <tbody>
              {studies.map((s, i) => (
                <tr key={i} className="odd:bg-black/[0.02] dark:odd:bg-white/[0.02]">
                  <td className="px-2 py-1 text-neutral-700 dark:text-slate-200 whitespace-nowrap">
                    {(labels[i] ?? `Study ${i + 1}`).slice(0, 22)}
                  </td>
                  <td className="px-2 py-1 text-right">{fmt(disp(s.yi), 3)}</td>
                  <td className="px-2 py-1 text-right text-neutral-500 dark:text-slate-400">
                    [{fmt(disp(s.ci_low), 3)}, {fmt(disp(s.ci_high), 3)}]
                  </td>
                  <td className="px-2 py-1 text-right">{fmt(s.w_random, 1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {loo.length > 0 && (
        <div className="clay-soft p-5 rounded-2xl overflow-x-auto">
          <div className="text-[11px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-400 mb-2">
            Leave-one-out (influence)
          </div>
          <table className="w-full text-[12px] font-mono border-collapse">
            <thead>
              <tr className="text-neutral-500 dark:text-slate-400">
                <th className="text-left px-2 py-1">Omitting</th>
                <th className="text-right px-2 py-1">Pooled (random)</th>
                <th className="text-right px-2 py-1">95% CI</th>
                <th className="text-right px-2 py-1">I²</th>
              </tr>
            </thead>
            <tbody>
              {loo.map((l, i) => (
                <tr key={i} className="odd:bg-black/[0.02] dark:odd:bg-white/[0.02]">
                  <td className="px-2 py-1 text-neutral-700 dark:text-slate-200 whitespace-nowrap">
                    {(labels[i] ?? `Study ${i + 1}`).slice(0, 22)}
                  </td>
                  <td className="px-2 py-1 text-right">{fmt(disp(l.estimate), 3)}</td>
                  <td className="px-2 py-1 text-right text-neutral-500 dark:text-slate-400">
                    [{fmt(disp(l.ci_low), 3)}, {fmt(disp(l.ci_high), 3)}]
                  </td>
                  <td className="px-2 py-1 text-right">{fmt(l.I2, 1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ColumnSelect({
  label,
  value,
  onChange,
  options,
  dataset,
  accent,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  options: number[];
  dataset: Dataset;
  accent?: string;
}) {
  return (
    <div>
      <label
        className={`block text-[11px] font-bold uppercase tracking-widest mb-2 ${
          accent ?? 'text-neutral-500 dark:text-slate-400'
        }`}
      >
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="clay-field w-full p-3 rounded-xl text-[13px] font-semibold text-neutral-700 dark:text-slate-200 focus:outline-none"
      >
        {options.length === 0 && <option value={-1}>No suitable column</option>}
        {options.map((i) =>
          i < 0 ? (
            <option key={i} value={i}>
              (none)
            </option>
          ) : (
            <option key={i} value={i}>
              {dataset.columns[i]} · {dataset.kinds[i]}
            </option>
          )
        )}
      </select>
    </div>
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

  // --- Data table ("Jamovi-style"): paste once, then pick columns per test. ---
  const [inputSource, setInputSource] = useState<InputSource>('dataset');
  const [rawData, setRawData] = useState('');
  const dataset: Dataset = useMemo(() => parseDataset(rawData), [rawData]);
  const hasData = dataset.columns.length > 0 && dataset.rows.length > 0;

  const numericCols = useMemo(
    () => dataset.kinds.map((k, i) => (k === 'numeric' ? i : -1)).filter((i) => i >= 0),
    [dataset]
  );
  const allCols = useMemo(
    () => dataset.columns.map((_, i) => i),
    [dataset]
  );

  // Column selections (indices). Resolved against valid candidates at use time,
  // so a stale pick after a data change gracefully falls back to a valid column.
  const [descCol, setDescCol] = useState(0);
  const [ttValueCol, setTtValueCol] = useState(0);
  const [ttGroupCol, setTtGroupCol] = useState(0);
  const [anValueCol, setAnValueCol] = useState(0);
  const [anGroupCol, setAnGroupCol] = useState(0);
  const [chiRowCol, setChiRowCol] = useState(0);
  const [chiColCol, setChiColCol] = useState(0);
  const [corrXCol, setCorrXCol] = useState(0);
  const [corrYCol, setCorrYCol] = useState(1);

  // Return `sel` if it's a valid candidate, else the first candidate (or -1).
  const resolve = (sel: number, candidates: number[]): number =>
    candidates.includes(sel) ? sel : candidates[0] ?? -1;

  // --- Meta-analysis inputs ---
  const [metaKind, setMetaKind] = useState<'effect' | 'events' | 'continuous'>('effect');
  const [metaMeasure, setMetaMeasure] = useState<'or' | 'rr' | 'rd'>('or');

  // Diagnostic 2×2 (index test × reference standard): TP / FP / FN / TN.
  const [diagTP, setDiagTP] = useState('');
  const [diagFP, setDiagFP] = useState('');
  const [diagFN, setDiagFN] = useState('');
  const [diagTN, setDiagTN] = useState('');
  const [metaContMeasure, setMetaContMeasure] = useState<'smd' | 'md'>('smd');
  const [metaText, setMetaText] = useState('');
  const [metaStudyCol, setMetaStudyCol] = useState(0);
  const [metaEffectCol, setMetaEffectCol] = useState(1);
  const [metaSeCol, setMetaSeCol] = useState(2);
  const [metaSubCol, setMetaSubCol] = useState(-1); // subgroup column (-1 = none)
  // Event-data (2×2) columns: events & totals per arm.
  const [metaEvtT, setMetaEvtT] = useState(1);
  const [metaNT, setMetaNT] = useState(2);
  const [metaEvtC, setMetaEvtC] = useState(3);
  const [metaNC, setMetaNC] = useState(4);
  // Continuous columns: mean/SD/n per arm.
  const [metaM1, setMetaM1] = useState(1);
  const [metaSd1, setMetaSd1] = useState(2);
  const [metaN1, setMetaN1] = useState(3);
  const [metaM2, setMetaM2] = useState(4);
  const [metaSd2, setMetaSd2] = useState(5);
  const [metaN2, setMetaN2] = useState(6);
  const [metaLog, setMetaLog] = useState(false);
  // Study labels + log flag stashed for the result renderer (labels aren't
  // carried through the Python interchange).
  const [metaMeta, setMetaMeta] = useState<{ labels: string[]; log: boolean; kind?: string; measure?: string } | null>(null);

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
      const useData = inputSource === 'dataset';
      if (useData && !hasData)
        throw new Error('Paste a data table first (or switch to Manual entry).');

      let payload: StatPayload;
      switch (mode) {
        case 'descriptive': {
          const g = useData
            ? numericColumn(dataset, resolve(descCol, numericCols))
            : parseNumbers(groupText);
          if (g.length < 1)
            throw new Error(
              useData
                ? 'The chosen column has no numeric values.'
                : 'Paste at least one number.'
            );
          payload = { group: g };
          break;
        }
        case 'ttest': {
          if (useData) {
            const vCol = resolve(ttValueCol, numericCols);
            const gCol = resolve(ttGroupCol, allCols);
            if (vCol < 0 || gCol < 0)
              throw new Error('Pick an outcome column and a grouping column.');
            if (vCol === gCol)
              throw new Error('Outcome and group must be different columns.');
            const groups = splitByGroup(dataset, vCol, gCol);
            if (groups.length !== 2)
              throw new Error(
                `The grouping column must have exactly 2 groups (found ${groups.length}: ${groups
                  .map((g) => g.level)
                  .join(', ') || 'none'}).`
              );
            const [a, b] = groups;
            if (a.values.length < 2 || b.values.length < 2)
              throw new Error('Each group needs at least 2 values.');
            payload = { group1: a.values, group2: b.values, paired };
          } else {
            const g1 = parseNumbers(group1Text);
            const g2 = parseNumbers(group2Text);
            if (g1.length < 2 || g2.length < 2)
              throw new Error('Each group needs at least 2 values.');
            payload = { group1: g1, group2: g2, paired };
          }
          break;
        }
        case 'anova': {
          if (useData) {
            const vCol = resolve(anValueCol, numericCols);
            const gCol = resolve(anGroupCol, allCols);
            if (vCol < 0 || gCol < 0)
              throw new Error('Pick an outcome column and a grouping column.');
            if (vCol === gCol)
              throw new Error('Outcome and group must be different columns.');
            const split = splitByGroup(dataset, vCol, gCol);
            const groups = split.map((s) => s.values);
            if (groups.length < 2)
              throw new Error('The grouping column needs at least 2 groups.');
            if (groups.some((g) => g.length < 2))
              throw new Error('Each group needs at least 2 values.');
            payload = { groups };
          } else {
            const groups = anovaGroups
              .map((t) => parseNumbers(t))
              .filter((g) => g.length > 0);
            if (groups.length < 2)
              throw new Error('Provide values for at least 2 groups.');
            if (groups.some((g) => g.length < 2))
              throw new Error('Each group needs at least 2 values.');
            payload = { groups };
          }
          break;
        }
        case 'chi2': {
          if (useData) {
            const rCol = resolve(chiRowCol, allCols);
            const cCol = resolve(chiColCol, allCols);
            if (rCol < 0 || cCol < 0)
              throw new Error('Pick two categorical columns.');
            if (rCol === cCol)
              throw new Error('Choose two different columns.');
            const { table, rowLevels, colLevels } = crosstab(dataset, rCol, cCol);
            if (rowLevels.length < 2 || colLevels.length < 2)
              throw new Error(
                'Both columns need at least 2 categories to cross-tabulate.'
              );
            payload = { observed: table };
          } else {
            const tbl = parseTable(tableText);
            if (tbl.length < 2 || (tbl[0]?.length ?? 0) < 2)
              throw new Error(
                'Provide a contingency table of at least 2 rows × 2 columns.'
              );
            payload = { observed: tbl };
          }
          break;
        }
        case 'correlation':
        case 'regression': {
          if (useData) {
            const xCol = resolve(corrXCol, numericCols);
            const yCol = resolve(corrYCol, numericCols);
            if (xCol < 0 || yCol < 0)
              throw new Error('Pick two numeric columns (X and Y).');
            if (xCol === yCol)
              throw new Error('X and Y must be different columns.');
            // Pair row-wise, dropping rows where either value is non-finite.
            const xs: number[] = [];
            const ys: number[] = [];
            for (const row of dataset.rows) {
              const xv = Number(row[xCol]);
              const yv = Number(row[yCol]);
              if (Number.isFinite(xv) && Number.isFinite(yv)) {
                xs.push(xv);
                ys.push(yv);
              }
            }
            if (xs.length < 3)
              throw new Error('Need at least 3 complete paired rows.');
            payload = { x: xs, y: ys };
          } else {
            const x = parseNumbers(xText);
            const y = parseNumbers(yText);
            if (x.length !== y.length)
              throw new Error(
                `X and Y must be the same length (got ${x.length} vs ${y.length}).`
              );
            if (x.length < 3)
              throw new Error('Need at least 3 paired observations.');
            payload = { x, y };
          }
          break;
        }
        case 'meta': {
          const labels: string[] = [];
          const yi: number[] = [];
          const sei: number[] = [];
          const subs: string[] = [];
          let anySub = false;
          // Raw 2x2 counts (dichotomous only), aligned to the pushed studies,
          // so the engine can do genuine Mantel–Haenszel pooling + total events.
          const cA: number[] = [];
          const cN1: number[] = [];
          const cC: number[] = [];
          const cN2: number[] = [];

          const pushStudy = (
            label: string,
            eff: number,
            se: number,
            sub: string
          ) => {
            if (!Number.isFinite(eff) || !Number.isFinite(se) || se <= 0) return false;
            yi.push(eff);
            sei.push(se);
            labels.push(label || `Study ${yi.length}`);
            subs.push(sub);
            if (sub) anySub = true;
            return true;
          };

          if (useData) {
            const sCol = resolve(metaStudyCol, allCols);
            const subCol = metaSubCol;
            if (metaKind === 'events') {
              const cols = [metaEvtT, metaNT, metaEvtC, metaNC].map((c) =>
                resolve(c, numericCols)
              );
              if (cols.some((c) => c < 0))
                throw new Error('Pick the four event/total columns.');
              dataset.rows.forEach((row) => {
                const [eT, nT, eC, nC] = cols.map((c) => Number(row[c]));
                const es = effectFrom2x2(eT, nT, eC, nC, metaMeasure);
                if (!es) return;
                if (
                  pushStudy(
                    (sCol >= 0 ? (row[sCol] ?? '').trim() : '') || `Study ${yi.length + 1}`,
                    es.yi,
                    es.sei,
                    subCol >= 0 ? (row[subCol] ?? '').trim() : ''
                  )
                ) {
                  cA.push(eT); cN1.push(nT); cC.push(eC); cN2.push(nC);
                }
              });
            } else if (metaKind === 'continuous') {
              const cols = [metaM1, metaSd1, metaN1, metaM2, metaSd2, metaN2].map(
                (c) => resolve(c, numericCols)
              );
              if (cols.some((c) => c < 0))
                throw new Error('Pick the six mean / SD / n columns.');
              dataset.rows.forEach((row) => {
                const [m1, s1, n1, m2, s2, n2] = cols.map((c) => Number(row[c]));
                const es = effectContinuous(m1, s1, n1, m2, s2, n2, metaContMeasure);
                if (!es) return;
                pushStudy(
                  (sCol >= 0 ? (row[sCol] ?? '').trim() : '') || `Study ${yi.length + 1}`,
                  es.yi,
                  es.sei,
                  subCol >= 0 ? (row[subCol] ?? '').trim() : ''
                );
              });
            } else {
              const eCol = resolve(metaEffectCol, numericCols);
              const seCol = resolve(metaSeCol, numericCols);
              if (eCol < 0 || seCol < 0)
                throw new Error('Pick an effect column and a standard-error column.');
              if (eCol === seCol)
                throw new Error('Effect and standard error must be different columns.');
              dataset.rows.forEach((row) => {
                pushStudy(
                  (sCol >= 0 ? (row[sCol] ?? '').trim() : '') || `Study ${yi.length + 1}`,
                  Number(row[eCol]),
                  Number(row[seCol]),
                  subCol >= 0 ? (row[subCol] ?? '').trim() : ''
                );
              });
            }
          } else {
            metaText
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter(Boolean)
              .forEach((line) => {
                const parts = line
                  .split(/[,;\t]/)
                  .map((s) => s.trim())
                  .filter(Boolean);
                if (metaKind === 'events') {
                  // label, eventsT, nT, eventsC, nC [, subgroup]
                  if (parts.length < 5) return;
                  const nums = parts.slice(1, 5).map(Number);
                  const es = effectFrom2x2(
                    nums[0], nums[1], nums[2], nums[3], metaMeasure
                  );
                  if (!es) return;
                  if (pushStudy(parts[0], es.yi, es.sei, parts[5] ?? '')) {
                    cA.push(nums[0]); cN1.push(nums[1]); cC.push(nums[2]); cN2.push(nums[3]);
                  }
                } else if (metaKind === 'continuous') {
                  // label, m1, sd1, n1, m2, sd2, n2 [, subgroup]
                  if (parts.length < 7) return;
                  const nums = parts.slice(1, 7).map(Number);
                  const es = effectContinuous(
                    nums[0], nums[1], nums[2], nums[3], nums[4], nums[5], metaContMeasure
                  );
                  if (!es) return;
                  pushStudy(parts[0], es.yi, es.sei, parts[7] ?? '');
                } else {
                  // label, effect, se [, subgroup]
                  if (parts.length < 3) {
                    // allow effect, se (no label)
                    if (parts.length === 2) {
                      pushStudy(
                        `Study ${yi.length + 1}`,
                        Number(parts[0]),
                        Number(parts[1]),
                        ''
                      );
                    }
                    return;
                  }
                  pushStudy(
                    parts[0],
                    Number(parts[1]),
                    Number(parts[2]),
                    parts[3] ?? ''
                  );
                }
              });
          }
          if (yi.length < 2)
            throw new Error(
              'Meta-analysis needs at least 2 studies with a positive standard error.'
            );
          payload = { yi, sei };
          if (anySub) (payload as Record<string, unknown>).subgroups = subs;
          if (metaKind === 'events' && cA.length === yi.length && cA.length > 0) {
            (payload as Record<string, unknown>).counts = { a: cA, n1: cN1, c: cC, n2: cN2 };
            (payload as Record<string, unknown>).measure = metaMeasure;
          }
          setMetaMeta({
            labels,
            // Ratio measures (OR/RR) display on the log scale; risk difference
            // and continuous effects are natural-scale (null line at 0).
            log:
              metaKind === 'events'
                ? metaMeasure !== 'rd'
                : metaKind === 'continuous'
                ? false
                : metaLog,
            kind: metaKind,
            measure: metaKind === 'events' ? metaMeasure : undefined,
          });
          break;
        }
        case 'diagnostic': {
          const nums = [diagTP, diagFP, diagFN, diagTN].map((v) => Number(v));
          if (nums.some((n) => !Number.isFinite(n) || n < 0))
            throw new Error('Enter four non-negative counts: TP, FP, FN, TN.');
          if (nums.reduce((a, b) => a + b, 0) <= 0)
            throw new Error('The 2×2 table is empty.');
          payload = { tp: nums[0], fp: nums[1], fn: nums[2], tn: nums[3] };
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
    meta: () => {
      if (metaKind === 'events') {
        // Six trials as 2×2 event counts with a subgroup column.
        setMetaText(
          [
            'Trial A, 12, 100, 20, 100, Adults',
            'Trial B, 8, 80, 15, 82, Adults',
            'Trial C, 20, 150, 28, 150, Adults',
            'Trial D, 5, 60, 6, 58, Children',
            'Trial E, 9, 90, 14, 88, Children',
            'Trial F, 15, 120, 18, 118, Children',
          ].join('\n')
        );
      } else if (metaKind === 'continuous') {
        // Six trials: mean, SD, n per arm, with a subgroup.
        setMetaText(
          [
            'Trial A, 5.1, 1.2, 40, 6.0, 1.3, 42, Adults',
            'Trial B, 4.8, 1.0, 35, 5.6, 1.1, 33, Adults',
            'Trial C, 5.4, 1.4, 55, 5.9, 1.5, 54, Adults',
            'Trial D, 3.2, 0.9, 30, 3.8, 1.0, 29, Children',
            'Trial E, 4.0, 1.1, 45, 4.7, 1.2, 44, Children',
            'Trial F, 4.5, 1.0, 60, 5.1, 1.1, 58, Children',
          ].join('\n')
        );
      } else {
        // Six trials as log odds ratios (negative = protective) with SEs.
        setMetaText(
          [
            'Trial A, -0.35, 0.18, Adults',
            'Trial B, -0.52, 0.25, Adults',
            'Trial C, -0.10, 0.15, Adults',
            'Trial D, -0.68, 0.30, Children',
            'Trial E, -0.22, 0.12, Children',
            'Trial F, -0.45, 0.20, Children',
          ].join('\n')
        );
        setMetaLog(true);
      }
    },
    diagnostic: () => {
      // Course worked example (headache → intracranial injury on CT).
      setDiagTP('49');
      setDiagFP('328');
      setDiagFN('8');
      setDiagTN('779');
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
            aria-label="VESTRIPPN home"
            className="font-black text-[18px] lg:text-[20px] tracking-tighter flex items-center gap-2.5 hover:opacity-80 transition-opacity"
          >
            <Image src="/logo.png" alt="VESTRIPPN logo" width={40} height={40} className="w-10 h-10 object-contain" priority />
            <span>VESTRIPPN</span>
          </Link>
          <nav className="hidden sm:flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest">
            <Link
              href="/"
              className="clay-tab px-3 py-1.5 rounded-lg"
            >
              Scanner
            </Link>
            <Link
              href="/research"
              className="clay-tab px-3 py-1.5 rounded-lg"
            >
              Research
            </Link>
            <span className="clay-tab clay-tab-active px-3 py-1.5 rounded-lg">
              Statistics
            </span>
            <Link href="/library" className="clay-tab px-3 py-1.5 rounded-lg">Library</Link>
            <Link href="/appraisal" className="clay-tab px-3 py-1.5 rounded-lg">Appraisal</Link>
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
              <span className="text-neutral-900 dark:text-white leading-none">VESTRIPPN</span>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-500 via-indigo-500 to-violet-500 dark:from-cyan-300 dark:via-indigo-300 dark:to-violet-300">
                Statistical Engine
              </span>
            </h1>
            <p className="max-w-2xl font-mono text-[10px] sm:text-[11px] text-neutral-500 dark:text-neutral-400 uppercase tracking-[0.3em]">
              CPython · numpy · scipy.stats{' // '}
              <span className="text-cyan-600 dark:text-cyan-300 font-bold">In-browser analysis</span>
            </p>
          </section>

          <section className="clay-soft rounded-2xl p-5 sm:p-6">
            <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-5 lg:gap-8">
              <div>
                <p className="font-mono text-[10px] font-black uppercase tracking-[0.28em] text-cyan-600 dark:text-cyan-300">
                  What this tab does
                </p>
                <h2 className="mt-2 text-[22px] sm:text-[26px] font-black tracking-tight text-neutral-900 dark:text-white">
                  Analyze extracted study data with uncertainty and diagnostics.
                </h2>
                <p className="mt-3 text-[13px] leading-relaxed text-neutral-600 dark:text-slate-400">
                  The Statistics tab runs descriptive summaries and common inferential tests locally with Pyodide, NumPy, and SciPy. Results pair estimates and p-values with confidence intervals, effect sizes, and assumption checks; they support, but do not replace, a prespecified analysis plan.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-3">
                {[
                  ['1. Choose a test', 'Match the analysis to the study question, design, and data structure.', 'clay-mint'],
                  ['2. Enter data', 'Use comma, space, or newline-separated numbers; sample data shows the required format.', 'clay-sky'],
                  ['3. Interpret together', 'Read estimates, confidence intervals, effect sizes, diagnostics, and p-values together.', 'clay-lilac'],
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
                Python Engine
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

          {/* Data source */}
          <div className="clay p-5 rounded-2xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-bold text-[15px] tracking-tight flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-cyan-400 obs-pulse"></span>
                Data
              </h2>
              <div className="flex items-center gap-1 clay-inset rounded-lg p-1">
                {(
                  [
                    ['dataset', 'Data table'],
                    ['manual', 'Manual entry'],
                  ] as [InputSource, string][]
                ).map(([src, lbl]) => (
                  <button
                    key={src}
                    onClick={() => setInputSource(src)}
                    className={`px-3 py-1.5 text-[11px] font-bold rounded-md transition-all ${
                      inputSource === src
                        ? 'clay-tab-active'
                        : 'text-neutral-500 dark:text-slate-400'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {inputSource === 'dataset' ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] text-neutral-500 dark:text-slate-400">
                    Paste a table (CSV or tab-separated). The first row is used as column names.
                  </p>
                  <button
                    onClick={() => setRawData(SAMPLE_DATASET)}
                    className="clay-button rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-neutral-500 dark:text-slate-400 shrink-0"
                  >
                    Load sample
                  </button>
                </div>
                <textarea
                  value={rawData}
                  onChange={(e) => setRawData(e.target.value)}
                  placeholder={'group\tscore\ncontrol\t21\ntreatment\t27'}
                  className="clay-field w-full h-28 p-4 rounded-xl text-[13px] font-mono text-neutral-700 dark:text-slate-200 focus:outline-none resize-none custom-scrollbar"
                />
                {hasData ? (
                  <div className="space-y-2">
                    <div className="text-[11px] font-mono text-neutral-500 dark:text-slate-400">
                      {dataset.rows.length} rows · {dataset.columns.length} columns
                    </div>
                    <div className="clay-inset rounded-xl overflow-auto max-h-52 custom-scrollbar">
                      <table className="w-full text-[12px] font-mono border-collapse">
                        <thead>
                          <tr>
                            {dataset.columns.map((c, i) => (
                              <th
                                key={i}
                                className="text-left px-3 py-2 sticky top-0 bg-clip-padding whitespace-nowrap border-b border-black/10 dark:border-white/10"
                              >
                                <span className="font-bold text-neutral-800 dark:text-slate-100">{c || `V${i + 1}`}</span>
                                <span
                                  className={`ml-1.5 text-[9px] uppercase tracking-widest ${
                                    dataset.kinds[i] === 'numeric'
                                      ? 'text-cyan-600 dark:text-cyan-300'
                                      : 'text-violet-600 dark:text-violet-300'
                                  }`}
                                >
                                  {dataset.kinds[i] === 'numeric' ? '#' : 'abc'}
                                </span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {dataset.rows.slice(0, 8).map((r, ri) => (
                            <tr key={ri} className="odd:bg-black/[0.02] dark:odd:bg-white/[0.02]">
                              {r.map((cell, ci) => (
                                <td
                                  key={ci}
                                  className="px-3 py-1.5 whitespace-nowrap text-neutral-600 dark:text-slate-300 border-b border-black/5 dark:border-white/5"
                                >
                                  {cell === '' ? '—' : cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {dataset.rows.length > 8 && (
                      <div className="text-[10px] font-mono text-neutral-400 dark:text-slate-500">
                        Showing first 8 of {dataset.rows.length} rows.
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-[12px] text-neutral-400 dark:text-slate-500 italic">
                    No data yet — paste a table above or load the sample. Each analysis then
                    picks its variables from your columns.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-[12px] text-neutral-500 dark:text-slate-400">
                Manual entry: type values directly into each analysis below.
              </p>
            )}
          </div>

          {/* Mode tabs */}
          <div className="clay p-5 rounded-2xl space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-[15px] tracking-tight flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 obs-pulse"></span>
                  Analysis Mode
                </h2>
                <p className="text-[11px] text-neutral-500 dark:text-slate-400 mt-1">
                  {currentMode.desc}
                </p>
              </div>
              <button
                onClick={() =>
                  inputSource === 'dataset'
                    ? setRawData(SAMPLE_DATASET)
                    : sampleFillers[mode]()
                }
                className="clay-button rounded-lg px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-neutral-500 dark:text-slate-400"
              >
                {inputSource === 'dataset' ? 'Load sample' : 'Fill Sample Data'}
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
            {mode === 'descriptive' &&
              (inputSource === 'dataset' && hasData ? (
                <div className="max-w-xs">
                  <ColumnSelect
                    label="Variable (numeric)"
                    value={resolve(descCol, numericCols)}
                    onChange={setDescCol}
                    options={numericCols}
                    dataset={dataset}
                    accent="text-cyan-600 dark:text-cyan-300"
                  />
                </div>
              ) : (
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
              ))}

            {mode === 'ttest' && (
              <div className="space-y-4">
                {inputSource === 'dataset' && hasData ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <ColumnSelect
                      label="Outcome (numeric)"
                      value={resolve(ttValueCol, numericCols)}
                      onChange={setTtValueCol}
                      options={numericCols}
                      dataset={dataset}
                      accent="text-cyan-600 dark:text-cyan-300"
                    />
                    <ColumnSelect
                      label="Grouping variable (2 groups)"
                      value={resolve(ttGroupCol, allCols)}
                      onChange={setTtGroupCol}
                      options={allCols}
                      dataset={dataset}
                      accent="text-violet-600 dark:text-violet-300"
                    />
                  </div>
                ) : (
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
                )}
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

            {mode === 'anova' &&
              (inputSource === 'dataset' && hasData ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <ColumnSelect
                    label="Outcome (numeric)"
                    value={resolve(anValueCol, numericCols)}
                    onChange={setAnValueCol}
                    options={numericCols}
                    dataset={dataset}
                    accent="text-cyan-600 dark:text-cyan-300"
                  />
                  <ColumnSelect
                    label="Grouping variable (2+ groups)"
                    value={resolve(anGroupCol, allCols)}
                    onChange={setAnGroupCol}
                    options={allCols}
                    dataset={dataset}
                    accent="text-violet-600 dark:text-violet-300"
                  />
                </div>
              ) : (
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
              ))}

            {mode === 'chi2' &&
              (inputSource === 'dataset' && hasData ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <ColumnSelect
                    label="Row variable"
                    value={resolve(chiRowCol, allCols)}
                    onChange={setChiRowCol}
                    options={allCols}
                    dataset={dataset}
                    accent="text-cyan-600 dark:text-cyan-300"
                  />
                  <ColumnSelect
                    label="Column variable"
                    value={resolve(chiColCol, allCols)}
                    onChange={setChiColCol}
                    options={allCols}
                    dataset={dataset}
                    accent="text-violet-600 dark:text-violet-300"
                  />
                </div>
              ) : (
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
              ))}

            {(mode === 'correlation' || mode === 'regression') &&
              (inputSource === 'dataset' && hasData ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <ColumnSelect
                    label="X (numeric)"
                    value={resolve(corrXCol, numericCols)}
                    onChange={setCorrXCol}
                    options={numericCols}
                    dataset={dataset}
                    accent="text-cyan-600 dark:text-cyan-300"
                  />
                  <ColumnSelect
                    label="Y (numeric)"
                    value={resolve(corrYCol, numericCols)}
                    onChange={setCorrYCol}
                    options={numericCols}
                    dataset={dataset}
                    accent="text-violet-600 dark:text-violet-300"
                  />
                </div>
              ) : (
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
              ))}

            {mode === 'meta' && (
              <div className="space-y-4">
                {/* data-kind + measure toggles */}
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] font-bold uppercase tracking-widest text-neutral-500 dark:text-slate-400">Data</label>
                    {(
                      [
                        ['effect', 'Effect + SE'],
                        ['events', 'Event counts (2×2)'],
                        ['continuous', 'Continuous (mean±SD)'],
                      ] as ['effect' | 'events' | 'continuous', string][]
                    ).map(([kind, lbl]) => (
                      <button
                        key={kind}
                        onClick={() => setMetaKind(kind)}
                        className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                          metaKind === kind ? 'clay-tab-active' : 'clay-button text-neutral-400 dark:text-slate-500'
                        }`}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                  {metaKind === 'events' && (
                    <div className="flex items-center gap-2">
                      <label className="text-[11px] font-bold uppercase tracking-widest text-neutral-500 dark:text-slate-400">Measure</label>
                      {(
                        [
                          ['or', 'Odds ratio'],
                          ['rr', 'Risk ratio'],
                          ['rd', 'Risk difference'],
                        ] as ['or' | 'rr' | 'rd', string][]
                      ).map(([m, lbl]) => (
                        <button
                          key={m}
                          onClick={() => setMetaMeasure(m)}
                          className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                            metaMeasure === m ? 'clay-tab-active' : 'clay-button text-neutral-400 dark:text-slate-500'
                          }`}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  )}
                  {metaKind === 'continuous' && (
                    <div className="flex items-center gap-2">
                      <label className="text-[11px] font-bold uppercase tracking-widest text-neutral-500 dark:text-slate-400">Measure</label>
                      {(
                        [
                          ['smd', "SMD (Hedges' g)"],
                          ['md', 'Mean difference'],
                        ] as ['smd' | 'md', string][]
                      ).map(([m, lbl]) => (
                        <button
                          key={m}
                          onClick={() => setMetaContMeasure(m)}
                          className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                            metaContMeasure === m ? 'clay-tab-active' : 'clay-button text-neutral-400 dark:text-slate-500'
                          }`}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {inputSource === 'dataset' && hasData ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <ColumnSelect
                      label="Study label"
                      value={resolve(metaStudyCol, allCols)}
                      onChange={setMetaStudyCol}
                      options={allCols}
                      dataset={dataset}
                    />
                    {metaKind === 'events' ? (
                      <>
                        <ColumnSelect label="Events (treatment)" value={resolve(metaEvtT, numericCols)} onChange={setMetaEvtT} options={numericCols} dataset={dataset} accent="text-cyan-600 dark:text-cyan-300" />
                        <ColumnSelect label="Total (treatment)" value={resolve(metaNT, numericCols)} onChange={setMetaNT} options={numericCols} dataset={dataset} accent="text-cyan-600 dark:text-cyan-300" />
                        <ColumnSelect label="Events (control)" value={resolve(metaEvtC, numericCols)} onChange={setMetaEvtC} options={numericCols} dataset={dataset} accent="text-violet-600 dark:text-violet-300" />
                        <ColumnSelect label="Total (control)" value={resolve(metaNC, numericCols)} onChange={setMetaNC} options={numericCols} dataset={dataset} accent="text-violet-600 dark:text-violet-300" />
                      </>
                    ) : metaKind === 'continuous' ? (
                      <>
                        <ColumnSelect label="Mean (treatment)" value={resolve(metaM1, numericCols)} onChange={setMetaM1} options={numericCols} dataset={dataset} accent="text-cyan-600 dark:text-cyan-300" />
                        <ColumnSelect label="SD (treatment)" value={resolve(metaSd1, numericCols)} onChange={setMetaSd1} options={numericCols} dataset={dataset} accent="text-cyan-600 dark:text-cyan-300" />
                        <ColumnSelect label="n (treatment)" value={resolve(metaN1, numericCols)} onChange={setMetaN1} options={numericCols} dataset={dataset} accent="text-cyan-600 dark:text-cyan-300" />
                        <ColumnSelect label="Mean (control)" value={resolve(metaM2, numericCols)} onChange={setMetaM2} options={numericCols} dataset={dataset} accent="text-violet-600 dark:text-violet-300" />
                        <ColumnSelect label="SD (control)" value={resolve(metaSd2, numericCols)} onChange={setMetaSd2} options={numericCols} dataset={dataset} accent="text-violet-600 dark:text-violet-300" />
                        <ColumnSelect label="n (control)" value={resolve(metaN2, numericCols)} onChange={setMetaN2} options={numericCols} dataset={dataset} accent="text-violet-600 dark:text-violet-300" />
                      </>
                    ) : (
                      <>
                        <ColumnSelect label="Effect size (numeric)" value={resolve(metaEffectCol, numericCols)} onChange={setMetaEffectCol} options={numericCols} dataset={dataset} accent="text-cyan-600 dark:text-cyan-300" />
                        <ColumnSelect label="Standard error (numeric)" value={resolve(metaSeCol, numericCols)} onChange={setMetaSeCol} options={numericCols} dataset={dataset} accent="text-violet-600 dark:text-violet-300" />
                      </>
                    )}
                    <ColumnSelect
                      label="Subgroup (optional)"
                      value={metaSubCol}
                      onChange={setMetaSubCol}
                      options={[-1, ...allCols]}
                      dataset={dataset}
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-widest text-neutral-500 dark:text-slate-400 mb-2">
                      {metaKind === 'events'
                        ? 'One study per line: label, events(T), n(T), events(C), n(C) [, subgroup]'
                        : metaKind === 'continuous'
                        ? 'One study per line: label, mean(T), SD(T), n(T), mean(C), SD(C), n(C) [, subgroup]'
                        : 'One study per line: label, effect, standard error [, subgroup]'}
                    </label>
                    <textarea
                      value={metaText}
                      onChange={(e) => setMetaText(e.target.value)}
                      placeholder={
                        metaKind === 'events'
                          ? 'Trial A, 12, 100, 20, 100\nTrial B, 8, 80, 15, 82'
                          : metaKind === 'continuous'
                          ? 'Trial A, 5.1, 1.2, 40, 6.0, 1.3, 42\nTrial B, 4.8, 1.0, 35, 5.6, 1.1, 33'
                          : 'Trial A, -0.35, 0.18\nTrial B, -0.52, 0.25'
                      }
                      className="clay-field w-full h-32 p-4 rounded-xl text-[13px] font-mono text-neutral-700 dark:text-slate-200 focus:outline-none resize-none custom-scrollbar"
                    />
                  </div>
                )}
                {metaKind === 'effect' && (
                  <label className="inline-flex items-center gap-2 text-[12px] font-bold text-neutral-600 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={metaLog}
                      onChange={(e) => setMetaLog(e.target.checked)}
                      className="accent-[#00A598]"
                    />
                    Effects are on a log scale (OR / RR / HR) — show as ratios
                  </label>
                )}
              </div>
            )}

            {mode === 'diagnostic' && (
              <div className="space-y-3">
                <p className="text-[11px] leading-relaxed text-neutral-500 dark:text-slate-400">
                  Enter the 2×2 of index test vs reference standard. Rows = test result,
                  columns = disease status (a = TP, b = FP, c = FN, d = TN).
                </p>
                <div className="grid grid-cols-[minmax(0,auto)_1fr_1fr] gap-2 items-center max-w-md">
                  <div></div>
                  <div className="text-center text-[11px] font-black uppercase tracking-wide text-emerald-600 dark:text-emerald-300">
                    Disease +
                  </div>
                  <div className="text-center text-[11px] font-black uppercase tracking-wide text-rose-500 dark:text-rose-400">
                    Disease −
                  </div>
                  <div className="text-[11px] font-bold text-neutral-600 dark:text-slate-300 pr-2 whitespace-nowrap">
                    Test +
                  </div>
                  {(
                    [
                      [diagTP, setDiagTP, 'TP'],
                      [diagFP, setDiagFP, 'FP'],
                    ] as [string, (v: string) => void, string][]
                  ).map(([v, set, ph]) => (
                    <input
                      key={ph}
                      type="number"
                      inputMode="numeric"
                      value={v}
                      onChange={(e) => set(e.target.value)}
                      placeholder={ph}
                      className="clay-field px-3 py-2 rounded-lg text-[13px] font-mono text-neutral-700 dark:text-slate-200 focus:outline-none w-full"
                    />
                  ))}
                  <div className="text-[11px] font-bold text-neutral-600 dark:text-slate-300 pr-2 whitespace-nowrap">
                    Test −
                  </div>
                  {(
                    [
                      [diagFN, setDiagFN, 'FN'],
                      [diagTN, setDiagTN, 'TN'],
                    ] as [string, (v: string) => void, string][]
                  ).map(([v, set, ph]) => (
                    <input
                      key={ph}
                      type="number"
                      inputMode="numeric"
                      value={v}
                      onChange={(e) => set(e.target.value)}
                      placeholder={ph}
                      className="clay-field px-3 py-2 rounded-lg text-[13px] font-mono text-neutral-700 dark:text-slate-200 focus:outline-none w-full"
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                onClick={handleRun}
                disabled={busy}
                className="clay-primary px-5 py-2.5 disabled:cursor-not-allowed text-[13px] font-bold rounded-xl active:scale-[0.98]"
              >
                {busy ? 'Running…' : `Run ${currentMode.label}`}
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
                      <StatTile
                        label="Mean difference"
                        value={fmtOptional(result.mean_difference)}
                      />
                      <StatTile
                        label="Difference 95% CI"
                        value={fmtCI(
                          result.mean_difference_ci95_low,
                          result.mean_difference_ci95_high
                        )}
                      />
                      <StatTile
                        label="Effect magnitude"
                        value={String(result.effect_magnitude ?? 'Not available')}
                      />
                      <StatTile
                        label="Levene p"
                        value={fmtOptionalP(result.levene_p)}
                      />
                    </div>
                    <AssumptionPanel flags={result.assumption_flags} />
                    <NonParametricLine np={result.nonparametric as { test: string; statistic: number; p: number } | null} />
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
                      <StatTile
                        label="p-value"
                        value={fmtP(Number(result.p))}
                      />
                      <StatTile
                        label="ω²"
                        value={fmtOptional(result.omega_squared)}
                      />
                      <StatTile
                        label="Effect magnitude"
                        value={String(result.effect_magnitude ?? 'Not available')}
                      />
                      <StatTile
                        label="Levene p"
                        value={fmtOptionalP(result.levene_p)}
                      />
                    </div>
                    <AssumptionPanel flags={result.assumption_flags} />
                    <NonParametricLine np={result.nonparametric as { test: string; statistic: number; p: number; df?: number } | null} />
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
                    <StatTile label="n" value={String(result.n)} />
                    <StatTile
                      label="Effect magnitude"
                      value={String(result.effect_magnitude ?? 'Not available')}
                    />
                    <StatTile
                      label="Minimum expected"
                      value={fmtOptional(result.minimum_expected, 2)}
                    />
                    <StatTile
                      label="Expected cells < 5"
                      value={`${String(result.expected_below_5_count)} (${fmtOptional(
                        result.expected_below_5_percent,
                        1
                      )}%)`}
                    />
                    {result.fisher != null && (
                      <StatTile
                        label="Fisher's exact p"
                        value={fmtOptionalP((result.fisher as { p: number }).p)}
                      />
                    )}
                  </div>
                  <AssumptionPanel flags={result.assumption_flags} />
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
                      <div className="text-[11px] text-neutral-500 dark:text-slate-400">
                        95% CI: {fmtCI(
                          result.pearson_ci95_low,
                          result.pearson_ci95_high
                        )}
                      </div>
                      <div className="text-[11px] font-bold text-neutral-600 dark:text-slate-300">
                        {String(result.effect_magnitude ?? 'Not available')} association
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
                  <AssumptionPanel flags={result.assumption_flags} />
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
                    <StatTile
                      label="Slope 95% CI"
                      value={fmtCI(
                        result.slope_ci95_low,
                        result.slope_ci95_high
                      )}
                    />
                    <StatTile
                      label="Adjusted R²"
                      value={fmtOptional(result.adjusted_r_squared)}
                    />
                    <StatTile
                      label="Residual SE"
                      value={fmtOptional(result.residual_standard_error)}
                    />
                    <StatTile label="df" value={String(result.df)} />
                  </div>
                  <div className="clay-inset font-mono text-[13px] mt-2 px-3 py-2 rounded-lg">
                    ŷ = {fmt(Number(result.intercept), 4)} +{' '}
                    {fmt(Number(result.slope), 4)} · x
                  </div>
                  <AssumptionPanel flags={result.assumption_flags} />
                </div>
              )}

              {mode === 'meta' && !!result.k && (
                <MetaResult result={result} meta={metaMeta} />
              )}

              {mode === 'diagnostic' && !!result.counts && (
                <DiagnosticResult result={result} />
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
              Choose an analysis mode, enter your numbers (or use{' '}
              <span className="font-bold">Fill Sample Data</span>), and run the
              test. The first analysis loads Pyodide{' '}
              <span className="font-mono">(~30 MB, cached after)</span> — every
              later analysis runs locally in this browser tab.
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
            AI Interpretation
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
          {busy ? 'Interpreting…' : hasAny ? 'Re-interpret' : 'Interpret with AI'}
        </button>
      </div>

      {!hasAny && !busy && !error && (
        <p className="text-[12px] text-neutral-500 dark:text-slate-400 leading-relaxed">
          Click <strong>Interpret with AI</strong> for a plain-English summary, an
          assumption check, and an APA-style write-up of this analysis.
          (Requires <code className="font-mono text-[11px]">OPENAI_API_KEY</code> set on the Vercel project.)
        </p>
      )}
      {busy && (
        <p className="text-[12px] text-neutral-500 dark:text-slate-400 italic">
          Asking the model for a biostatistician&apos;s read…
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
