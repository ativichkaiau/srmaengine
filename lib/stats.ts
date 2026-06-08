// Pyodide-powered statistical engine. Loads real CPython + numpy + scipy in
// the browser via WebAssembly, so descriptive / inferential analyses run
// against actual scipy.stats rather than a JS reimplementation.

const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
const PYODIDE_SCRIPT = `${PYODIDE_CDN}pyodide.js`;

type PyodideAPI = {
  loadPackage: (pkgs: string[] | string) => Promise<void>;
  runPython: (code: string) => unknown;
  globals: {
    set: (name: string, value: unknown) => void;
    get: (name: string) => unknown;
  };
};

declare global {
  interface Window {
    loadPyodide?: (opts: { indexURL: string }) => Promise<PyodideAPI>;
  }
}

let pyPromise: Promise<PyodideAPI> | null = null;

export type ProgressHandler = (msg: string) => void;

export function getPyodide(onProgress?: ProgressHandler): Promise<PyodideAPI> {
  if (pyPromise) {
    onProgress?.('Ready.');
    return pyPromise;
  }
  pyPromise = (async () => {
    if (typeof window === 'undefined')
      throw new Error('Pyodide is client-only.');
    if (!window.loadPyodide) {
      onProgress?.('Downloading Pyodide runtime…');
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = PYODIDE_SCRIPT;
        s.onload = () => resolve();
        s.onerror = () =>
          reject(new Error('Failed to load Pyodide script from CDN.'));
        document.head.appendChild(s);
      });
    }
    onProgress?.('Booting CPython interpreter…');
    const py = await window.loadPyodide!({ indexURL: PYODIDE_CDN });
    onProgress?.('Loading numpy + scipy…');
    await py.loadPackage(['numpy', 'scipy']);
    onProgress?.('Engine ready.');
    return py;
  })();
  return pyPromise;
}

export type StatMode =
  | 'descriptive'
  | 'ttest'
  | 'anova'
  | 'chi2'
  | 'correlation'
  | 'regression';

export type StatPayload = Record<string, unknown>;

// One big Python program that dispatches on `mode`. Input arrives as a JSON
// string on a global, results come back the same way — that keeps the JS↔Py
// interchange free of JsProxy gotchas.
const PY_ANALYSIS_CODE = `
import json
import numpy as np
from scipy import stats as st

req = json.loads(req_json)
mode = req['mode']
data = req['data']

def desc(arr_list):
    arr = np.asarray(arr_list, dtype=float)
    arr = arr[~np.isnan(arr)]
    n = int(arr.size)
    if n == 0:
        return {'error': 'empty data'}
    m = st.mode(arr, keepdims=False)
    out = {
        'n': n,
        'mean': float(arr.mean()),
        'median': float(np.median(arr)),
        'mode': float(m.mode),
        'mode_count': int(m.count),
        'std': float(arr.std(ddof=1)) if n > 1 else 0.0,
        'variance': float(arr.var(ddof=1)) if n > 1 else 0.0,
        'min': float(arr.min()),
        'max': float(arr.max()),
        'range': float(arr.max() - arr.min()),
        'q1': float(np.percentile(arr, 25)),
        'q3': float(np.percentile(arr, 75)),
    }
    return out

try:
    if mode == 'descriptive':
        result = {'descriptive': desc(data['group'])}

    elif mode == 'ttest':
        g1 = np.asarray(data['group1'], dtype=float)
        g2 = np.asarray(data['group2'], dtype=float)
        g1 = g1[~np.isnan(g1)]
        g2 = g2[~np.isnan(g2)]
        if g1.size < 2 or g2.size < 2:
            raise ValueError('Each group needs at least 2 observations.')
        paired = bool(data.get('paired'))
        if paired:
            if g1.size != g2.size:
                raise ValueError(
                    f'Paired t-test requires equal sample sizes (n1={g1.size}, n2={g2.size}).'
                )
            res = st.ttest_rel(g1, g2)
            df = float(g1.size - 1)
            diff = g1 - g2
            sd = float(diff.std(ddof=1))
            d = float(diff.mean() / sd) if sd > 0 else 0.0
            test_label = 'Paired t-test'
        else:
            res = st.ttest_ind(g1, g2, equal_var=False)
            v1 = float(g1.var(ddof=1)); v2 = float(g2.var(ddof=1))
            n1 = int(g1.size); n2 = int(g2.size)
            df = ((v1/n1 + v2/n2) ** 2) / (((v1/n1) ** 2)/(n1-1) + ((v2/n2) ** 2)/(n2-1)) \
                if n1 > 1 and n2 > 1 else float('nan')
            pooled = (((n1-1)*v1 + (n2-1)*v2) / (n1+n2-2)) ** 0.5 if n1+n2 > 2 else 0.0
            d = float((g1.mean() - g2.mean()) / pooled) if pooled > 0 else 0.0
            test_label = "Welch's t-test (unequal variance)"
        result = {
            'test': test_label,
            't': float(res.statistic),
            'p': float(res.pvalue),
            'df': float(df),
            'cohen_d': d,
            'group1': desc(data['group1']),
            'group2': desc(data['group2']),
        }

    elif mode == 'anova':
        raw = data['groups']
        groups = [np.asarray(g, dtype=float) for g in raw]
        groups = [g[~np.isnan(g)] for g in groups]
        if len(groups) < 2:
            raise ValueError('ANOVA needs at least 2 groups.')
        if any(g.size < 2 for g in groups):
            raise ValueError('Each ANOVA group needs at least 2 observations.')
        res = st.f_oneway(*groups)
        all_vals = np.concatenate(groups)
        grand = float(all_vals.mean())
        ss_between = float(sum(g.size * (g.mean() - grand) ** 2 for g in groups))
        ss_total = float(((all_vals - grand) ** 2).sum())
        eta2 = float(ss_between / ss_total) if ss_total > 0 else 0.0
        df_between = len(groups) - 1
        df_within = int(sum(g.size for g in groups) - len(groups))
        result = {
            'test': 'One-way ANOVA',
            'F': float(res.statistic),
            'p': float(res.pvalue),
            'df_between': df_between,
            'df_within': df_within,
            'eta_squared': eta2,
            'groups': [desc(g.tolist()) for g in groups],
        }

    elif mode == 'chi2':
        observed = np.asarray(data['observed'], dtype=float)
        if observed.ndim != 2 or observed.size == 0:
            raise ValueError('Chi-square needs a 2D contingency table.')
        if (observed < 0).any():
            raise ValueError('Cell counts must be non-negative.')
        chi2, p, dof, expected = st.chi2_contingency(observed)
        n = float(observed.sum())
        k = int(min(observed.shape)) - 1
        cramer_v = float(((chi2 / (n * k)) ** 0.5)) if n > 0 and k > 0 else 0.0
        result = {
            'test': 'Chi-square test of independence',
            'chi2': float(chi2),
            'p': float(p),
            'df': int(dof),
            'cramer_v': cramer_v,
            'n': int(n),
            'observed': observed.tolist(),
            'expected': expected.tolist(),
        }

    elif mode == 'correlation':
        x = np.asarray(data['x'], dtype=float)
        y = np.asarray(data['y'], dtype=float)
        if x.size != y.size:
            raise ValueError(f'X and Y must be the same length (got {x.size} vs {y.size}).')
        mask = ~(np.isnan(x) | np.isnan(y))
        x, y = x[mask], y[mask]
        if x.size < 3:
            raise ValueError('Correlation needs at least 3 paired observations.')
        pr = st.pearsonr(x, y)
        sr = st.spearmanr(x, y)
        result = {
            'test': 'Correlation',
            'n': int(x.size),
            'pearson_r': float(pr.statistic if hasattr(pr, 'statistic') else pr[0]),
            'pearson_p': float(pr.pvalue if hasattr(pr, 'pvalue') else pr[1]),
            'spearman_r': float(sr.statistic if hasattr(sr, 'statistic') else sr[0]),
            'spearman_p': float(sr.pvalue if hasattr(sr, 'pvalue') else sr[1]),
        }

    elif mode == 'regression':
        x = np.asarray(data['x'], dtype=float)
        y = np.asarray(data['y'], dtype=float)
        if x.size != y.size:
            raise ValueError(f'X and Y must be the same length (got {x.size} vs {y.size}).')
        mask = ~(np.isnan(x) | np.isnan(y))
        x, y = x[mask], y[mask]
        if x.size < 3:
            raise ValueError('Regression needs at least 3 paired observations.')
        lr = st.linregress(x, y)
        result = {
            'test': 'Simple linear regression  (y = a + b·x)',
            'n': int(x.size),
            'slope': float(lr.slope),
            'intercept': float(lr.intercept),
            'r': float(lr.rvalue),
            'r_squared': float(lr.rvalue ** 2),
            'p': float(lr.pvalue),
            'stderr': float(lr.stderr),
            'intercept_stderr': float(getattr(lr, 'intercept_stderr', float('nan'))),
        }

    else:
        result = {'error': f'unknown mode: {mode}'}
except Exception as e:
    result = {'error': str(e)}

result_json = json.dumps(result)
`;

export async function runStats(
  mode: StatMode,
  data: StatPayload,
  onProgress?: ProgressHandler
): Promise<Record<string, unknown>> {
  const py = await getPyodide(onProgress);
  py.globals.set('req_json', JSON.stringify({ mode, data }));
  py.runPython(PY_ANALYSIS_CODE);
  const json = py.globals.get('result_json') as string;
  return JSON.parse(json);
}

// Tolerant numeric parser: accepts comma/space/newline/tab/semicolon separated.
export function parseNumbers(text: string): number[] {
  if (!text) return [];
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
}

// Parse a contingency table: each non-empty line is a row, cells separated by
// comma/space/tab/semicolon. Rows are padded with zeros to equal length.
export function parseTable(text: string): number[][] {
  if (!text) return [];
  const rows = text
    .split(/\r?\n/)
    .map((line) => parseNumbers(line))
    .filter((row) => row.length > 0);
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) =>
    r.length === width ? r : [...r, ...Array(width - r.length).fill(0)]
  );
}

// Format a p-value with significance stars.
export function pStars(p: number): string {
  if (!isFinite(p)) return 'n/a';
  if (p < 0.001) return '***';
  if (p < 0.01) return '**';
  if (p < 0.05) return '*';
  return 'ns';
}
