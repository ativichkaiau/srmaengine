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
let pyInstance: PyodideAPI | null = null;

export type ProgressHandler = (msg: string) => void;

export function getPyodide(onProgress?: ProgressHandler): Promise<PyodideAPI> {
  if (pyInstance) {
    onProgress?.('Ready.');
    return Promise.resolve(pyInstance);
  }
  if (pyPromise) {
    onProgress?.('Engine is still loading…');
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
    pyInstance = py;
    return py;
  })().catch((error: unknown) => {
    pyPromise = null;
    throw error;
  });
  return pyPromise;
}

export type StatMode =
  | 'descriptive'
  | 'ttest'
  | 'anova'
  | 'chi2'
  | 'correlation'
  | 'regression'
  | 'meta';

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

def clean(arr_list):
    arr = np.asarray(arr_list, dtype=float)
    return arr[np.isfinite(arr)]

def mean_ci(arr, confidence=0.95):
    n = int(arr.size)
    if n < 2:
        return {'low': None, 'high': None, 'se': None}
    se = float(st.sem(arr))
    if not np.isfinite(se):
        return {'low': None, 'high': None, 'se': None}
    critical = float(st.t.ppf((1 + confidence) / 2, n - 1))
    mean = float(arr.mean())
    margin = critical * se
    return {'low': mean - margin, 'high': mean + margin, 'se': se}

def normality(arr):
    n = int(arr.size)
    if n < 3:
        return {
            'w': None,
            'p': None,
            'note': 'Shapiro-Wilk requires at least 3 observations.'
        }
    if float(arr.std()) == 0:
        return {
            'w': None,
            'p': None,
            'note': 'Normality cannot be assessed because the sample has no variation.'
        }
    if n > 5000:
        return {
            'w': None,
            'p': None,
            'note': 'Shapiro-Wilk p-values are not reliable above 5,000 observations.'
        }
    res = st.shapiro(arr)
    return {
        'w': float(res.statistic),
        'p': float(res.pvalue),
        'note': (
            'Potential departure from normality.'
            if float(res.pvalue) < 0.05
            else 'No strong evidence against normality.'
        )
    }

def standardized_effect_label(value):
    x = abs(float(value))
    if x < 0.2: return 'negligible'
    if x < 0.5: return 'small'
    if x < 0.8: return 'moderate'
    return 'large'

def association_effect_label(value):
    x = abs(float(value))
    if x < 0.1: return 'negligible'
    if x < 0.3: return 'small'
    if x < 0.5: return 'moderate'
    return 'large'

def eta_effect_label(value):
    x = max(0.0, float(value))
    if x < 0.01: return 'negligible'
    if x < 0.06: return 'small'
    if x < 0.14: return 'moderate'
    return 'large'

def desc(arr_list):
    arr = clean(arr_list)
    n = int(arr.size)
    if n == 0:
        return {'error': 'empty data'}
    m = st.mode(arr, keepdims=False)
    ci = mean_ci(arr)
    spread = float(arr.std(ddof=1)) if n > 1 else 0.0
    shape_ok = n > 2 and spread > 0
    out = {
        'n': n,
        'mean': float(arr.mean()),
        'median': float(np.median(arr)),
        'mode': float(m.mode),
        'mode_count': int(m.count),
        'std': spread,
        'variance': float(arr.var(ddof=1)) if n > 1 else 0.0,
        'se': ci['se'],
        'mean_ci95_low': ci['low'],
        'mean_ci95_high': ci['high'],
        'min': float(arr.min()),
        'max': float(arr.max()),
        'range': float(arr.max() - arr.min()),
        'q1': float(np.percentile(arr, 25)),
        'q3': float(np.percentile(arr, 75)),
        'skewness': float(st.skew(arr, bias=False)) if shape_ok else None,
        'kurtosis_excess': float(st.kurtosis(arr, bias=False)) if n > 3 and spread > 0 else None,
        'normality': normality(arr),
    }
    return out

try:
    if mode == 'descriptive':
        result = {'descriptive': desc(data['group'])}

    elif mode == 'ttest':
        g1 = clean(data['group1'])
        g2 = clean(data['group2'])
        if g1.size < 2 or g2.size < 2:
            raise ValueError('Each group needs at least 2 observations.')
        paired = bool(data.get('paired'))
        flags = []
        mean_diff = float(g1.mean() - g2.mean())
        levene_w = None
        levene_p = None
        if paired:
            if g1.size != g2.size:
                raise ValueError(
                    f'Paired t-test requires equal sample sizes (n1={g1.size}, n2={g2.size}).'
                )
            res = st.ttest_rel(g1, g2)
            df = float(g1.size - 1)
            diff = g1 - g2
            sd = float(diff.std(ddof=1))
            if sd == 0:
                raise ValueError(
                    'Paired t-test requires variation in the within-pair differences.'
                )
            d = float(diff.mean() / sd) if sd > 0 else 0.0
            se_diff = sd / np.sqrt(g1.size) if sd > 0 else 0.0
            norm_diff = normality(diff)
            if norm_diff['p'] is not None and norm_diff['p'] < 0.05:
                flags.append(
                    'Paired differences depart from normality; consider a Wilcoxon signed-rank sensitivity analysis.'
                )
            normality_report = {'paired_differences': norm_diff}
            test_label = 'Paired t-test'
        else:
            res = st.ttest_ind(g1, g2, equal_var=False)
            v1 = float(g1.var(ddof=1)); v2 = float(g2.var(ddof=1))
            n1 = int(g1.size); n2 = int(g2.size)
            if v1 == 0 and v2 == 0:
                raise ValueError(
                    'T-test requires variation in at least one group.'
                )
            se_diff = float(np.sqrt(v1/n1 + v2/n2))
            df = ((v1/n1 + v2/n2) ** 2) / (((v1/n1) ** 2)/(n1-1) + ((v2/n2) ** 2)/(n2-1)) \
                if n1 > 1 and n2 > 1 else float('nan')
            pooled = (((n1-1)*v1 + (n2-1)*v2) / (n1+n2-2)) ** 0.5 if n1+n2 > 2 else 0.0
            d = float((g1.mean() - g2.mean()) / pooled) if pooled > 0 else 0.0
            lev = st.levene(g1, g2, center='median')
            levene_w = float(lev.statistic)
            levene_p = float(lev.pvalue)
            norm1 = normality(g1)
            norm2 = normality(g2)
            normality_report = {'group1': norm1, 'group2': norm2}
            if levene_p < 0.05:
                flags.append(
                    'Group variances differ; Welch correction is already applied.'
                )
            if (
                (norm1['p'] is not None and norm1['p'] < 0.05)
                or (norm2['p'] is not None and norm2['p'] < 0.05)
            ):
                flags.append(
                    'At least one group departs from normality; inspect distributions and consider a Mann-Whitney sensitivity analysis.'
                )
            test_label = "Welch's t-test (unequal variance)"
        critical = float(st.t.ppf(0.975, df))
        ci_low = mean_diff - critical * se_diff
        ci_high = mean_diff + critical * se_diff
        result = {
            'test': test_label,
            't': float(res.statistic),
            'p': float(res.pvalue),
            'df': float(df),
            'mean_difference': mean_diff,
            'mean_difference_ci95_low': float(ci_low),
            'mean_difference_ci95_high': float(ci_high),
            'cohen_d': d,
            'effect_magnitude': standardized_effect_label(d),
            'levene_w': levene_w,
            'levene_p': levene_p,
            'normality': normality_report,
            'assumption_flags': flags,
            'group1': desc(data['group1']),
            'group2': desc(data['group2']),
        }

    elif mode == 'anova':
        raw = data['groups']
        groups = [clean(g) for g in raw]
        if len(groups) < 2:
            raise ValueError('ANOVA needs at least 2 groups.')
        if any(g.size < 2 for g in groups):
            raise ValueError('Each ANOVA group needs at least 2 observations.')
        res = st.f_oneway(*groups)
        lev = st.levene(*groups, center='median')
        all_vals = np.concatenate(groups)
        if float(all_vals.std()) == 0:
            raise ValueError('ANOVA requires variation in the observed values.')
        grand = float(all_vals.mean())
        ss_between = float(sum(g.size * (g.mean() - grand) ** 2 for g in groups))
        ss_total = float(((all_vals - grand) ** 2).sum())
        ss_within = max(0.0, ss_total - ss_between)
        eta2 = float(ss_between / ss_total) if ss_total > 0 else 0.0
        df_between = len(groups) - 1
        df_within = int(sum(g.size for g in groups) - len(groups))
        ms_within = ss_within / df_within if df_within > 0 else 0.0
        omega2 = (
            max(0.0, (ss_between - df_between * ms_within) / (ss_total + ms_within))
            if ss_total + ms_within > 0
            else 0.0
        )
        normality_report = [normality(g) for g in groups]
        flags = []
        if float(lev.pvalue) < 0.05:
            flags.append(
                'Group variances differ; consider Welch ANOVA or a heteroscedastic model.'
            )
        if any(n['p'] is not None and n['p'] < 0.05 for n in normality_report):
            flags.append(
                'At least one group departs from normality; inspect residuals and consider a Kruskal-Wallis sensitivity analysis.'
            )
        result = {
            'test': 'One-way ANOVA',
            'F': float(res.statistic),
            'p': float(res.pvalue),
            'df_between': df_between,
            'df_within': df_within,
            'eta_squared': eta2,
            'omega_squared': float(omega2),
            'effect_magnitude': eta_effect_label(eta2),
            'levene_w': float(lev.statistic),
            'levene_p': float(lev.pvalue),
            'normality': normality_report,
            'assumption_flags': flags,
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
        sparse_count = int((expected < 5).sum())
        sparse_percent = float(100 * sparse_count / expected.size)
        minimum_expected = float(expected.min())
        flags = []
        if minimum_expected < 1:
            flags.append(
                'At least one expected cell count is below 1; the chi-square approximation is unreliable.'
            )
        elif sparse_percent > 20:
            flags.append(
                'More than 20% of expected cell counts are below 5; consider exact or Monte Carlo methods.'
            )
        result = {
            'test': 'Chi-square test of independence',
            'chi2': float(chi2),
            'p': float(p),
            'df': int(dof),
            'cramer_v': cramer_v,
            'effect_magnitude': association_effect_label(cramer_v),
            'n': int(n),
            'minimum_expected': minimum_expected,
            'expected_below_5_count': sparse_count,
            'expected_below_5_percent': sparse_percent,
            'yates_correction': bool(observed.shape == (2, 2)),
            'assumption_flags': flags,
            'observed': observed.tolist(),
            'expected': expected.tolist(),
        }

    elif mode == 'correlation':
        x = np.asarray(data['x'], dtype=float)
        y = np.asarray(data['y'], dtype=float)
        if x.size != y.size:
            raise ValueError(f'X and Y must be the same length (got {x.size} vs {y.size}).')
        mask = np.isfinite(x) & np.isfinite(y)
        x, y = x[mask], y[mask]
        if x.size < 3:
            raise ValueError('Correlation needs at least 3 paired observations.')
        if float(x.std()) == 0 or float(y.std()) == 0:
            raise ValueError('Correlation is undefined when X or Y has no variation.')
        pr = st.pearsonr(x, y)
        sr = st.spearmanr(x, y)
        pearson_r = float(pr.statistic if hasattr(pr, 'statistic') else pr[0])
        if x.size > 3 and abs(pearson_r) < 1:
            z = float(np.arctanh(pearson_r))
            z_margin = float(st.norm.ppf(0.975) / np.sqrt(x.size - 3))
            pearson_ci_low = float(np.tanh(z - z_margin))
            pearson_ci_high = float(np.tanh(z + z_margin))
        else:
            pearson_ci_low = -1.0
            pearson_ci_high = 1.0
        norm_x = normality(x)
        norm_y = normality(y)
        flags = []
        if (
            (norm_x['p'] is not None and norm_x['p'] < 0.05)
            or (norm_y['p'] is not None and norm_y['p'] < 0.05)
        ):
            flags.append(
                'At least one variable departs from normality; emphasize Spearman correlation and inspect the scatterplot.'
            )
        result = {
            'test': 'Correlation',
            'n': int(x.size),
            'pearson_r': pearson_r,
            'pearson_p': float(pr.pvalue if hasattr(pr, 'pvalue') else pr[1]),
            'pearson_ci95_low': pearson_ci_low,
            'pearson_ci95_high': pearson_ci_high,
            'spearman_r': float(sr.statistic if hasattr(sr, 'statistic') else sr[0]),
            'spearman_p': float(sr.pvalue if hasattr(sr, 'pvalue') else sr[1]),
            'effect_magnitude': association_effect_label(pearson_r),
            'normality': {'x': norm_x, 'y': norm_y},
            'assumption_flags': flags,
        }

    elif mode == 'regression':
        x = np.asarray(data['x'], dtype=float)
        y = np.asarray(data['y'], dtype=float)
        if x.size != y.size:
            raise ValueError(f'X and Y must be the same length (got {x.size} vs {y.size}).')
        mask = np.isfinite(x) & np.isfinite(y)
        x, y = x[mask], y[mask]
        if x.size < 3:
            raise ValueError('Regression needs at least 3 paired observations.')
        if float(x.std()) == 0:
            raise ValueError('Regression requires variation in X.')
        if float(y.std()) == 0:
            raise ValueError('Regression is not informative when Y has no variation.')
        lr = st.linregress(x, y)
        df = int(x.size - 2)
        critical = float(st.t.ppf(0.975, df))
        intercept_se = float(getattr(lr, 'intercept_stderr', float('nan')))
        fitted = lr.intercept + lr.slope * x
        residuals = y - fitted
        residual_se = float(np.sqrt(np.sum(residuals ** 2) / df))
        residual_normality = normality(residuals)
        r_squared = float(lr.rvalue ** 2)
        adjusted_r_squared = float(1 - (1 - r_squared) * (x.size - 1) / df)
        flags = []
        if (
            residual_normality['p'] is not None
            and residual_normality['p'] < 0.05
        ):
            flags.append(
                'Residuals depart from normality; inspect residual plots and consider robust standard errors or transformation.'
            )
        result = {
            'test': 'Simple linear regression  (y = a + b·x)',
            'n': int(x.size),
            'df': df,
            'slope': float(lr.slope),
            'slope_ci95_low': float(lr.slope - critical * lr.stderr),
            'slope_ci95_high': float(lr.slope + critical * lr.stderr),
            'intercept': float(lr.intercept),
            'intercept_ci95_low': float(lr.intercept - critical * intercept_se),
            'intercept_ci95_high': float(lr.intercept + critical * intercept_se),
            'r': float(lr.rvalue),
            'r_squared': r_squared,
            'adjusted_r_squared': adjusted_r_squared,
            'p': float(lr.pvalue),
            'stderr': float(lr.stderr),
            'intercept_stderr': intercept_se,
            'residual_standard_error': residual_se,
            'residual_normality': residual_normality,
            'assumption_flags': flags,
        }

    elif mode == 'meta':
        yi = np.asarray(data['yi'], dtype=float)
        sei = np.asarray(data['sei'], dtype=float)
        if yi.size != sei.size:
            raise ValueError('Each study needs one effect and one standard error.')
        mask = np.isfinite(yi) & np.isfinite(sei) & (sei > 0)
        idx = [int(i) for i in np.where(mask)[0]]
        yi = yi[mask]; sei = sei[mask]
        k = int(yi.size)
        if k < 2:
            raise ValueError('Meta-analysis needs at least 2 studies with a positive standard error.')
        z = 1.959963984540054
        vi = sei ** 2
        wi = 1.0 / vi
        sw = float(wi.sum())
        theta_fe = float((wi * yi).sum() / sw)
        se_fe = float(np.sqrt(1.0 / sw))

        # Heterogeneity
        Q = float((wi * (yi - theta_fe) ** 2).sum())
        df = k - 1
        Q_p = float(st.chi2.sf(Q, df)) if df > 0 else None
        I2 = float(max(0.0, (Q - df) / Q) * 100.0) if Q > 0 else 0.0
        C = sw - float((wi ** 2).sum()) / sw
        tau2 = float(max(0.0, (Q - df) / C)) if C > 0 else 0.0

        # Random effects (DerSimonian-Laird)
        wr = 1.0 / (vi + tau2)
        swr = float(wr.sum())
        theta_re = float((wr * yi).sum() / swr)
        se_re = float(np.sqrt(1.0 / swr))

        def pooled(theta, se):
            zval = theta / se if se > 0 else float('nan')
            return {
                'estimate': float(theta),
                'se': float(se),
                'ci_low': float(theta - z * se),
                'ci_high': float(theta + z * se),
                'z': float(zval),
                'p': float(2 * st.norm.sf(abs(zval))) if np.isfinite(zval) else None,
            }

        studies = []
        for j in range(k):
            studies.append({
                'index': idx[j],
                'yi': float(yi[j]),
                'sei': float(sei[j]),
                'ci_low': float(yi[j] - z * sei[j]),
                'ci_high': float(yi[j] + z * sei[j]),
                'w_fixed': float(wi[j] / sw * 100.0),
                'w_random': float(wr[j] / swr * 100.0),
            })

        # Egger's regression test for funnel asymmetry (needs >= 3 studies with
        # varying standard errors — linregress is undefined for constant x).
        # np.ptp is exact for identical values (unlike np.std, which can be ~1e-17).
        if k < 3:
            egger = {'intercept': None, 'se': None, 'p': None,
                     'note': 'Egger test needs at least 3 studies.'}
        elif float(np.ptp(sei)) == 0:
            egger = {'intercept': None, 'se': None, 'p': None,
                     'note': 'Egger test needs studies with differing standard errors.'}
        else:
            snd = yi / sei          # standard normal deviate
            prec = 1.0 / sei        # precision
            try:
                lr = st.linregress(prec, snd)
                icept = float(lr.intercept)
                ise = float(getattr(lr, 'intercept_stderr', float('nan')))
                if np.isfinite(ise) and ise > 0:
                    t_e = icept / ise
                    p_e = float(2 * st.t.sf(abs(t_e), k - 2))
                else:
                    p_e = None
            except Exception:
                icept = float('nan')
                ise = float('nan')
                p_e = None
            egger = {
                'intercept': icept if np.isfinite(icept) else None,
                'se': ise if np.isfinite(ise) else None,
                'p': p_e,
                'note': (
                    'Small-study effects / funnel asymmetry are suggested.'
                    if (p_e is not None and p_e < 0.05)
                    else 'No strong evidence of funnel asymmetry.'
                ),
            }

        result = {
            'test': 'Meta-analysis (inverse-variance)',
            'k': k,
            'fixed': pooled(theta_fe, se_fe),
            'random': pooled(theta_re, se_re),
            'heterogeneity': {
                'Q': Q, 'df': df, 'p': Q_p, 'I2': I2, 'tau2': tau2,
            },
            'egger': egger,
            'studies': studies,
        }

    else:
        result = {'error': f'unknown mode: {mode}'}
except Exception as e:
    result = {'error': str(e)}

def json_safe(value):
    if isinstance(value, dict):
        return {k: json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    if isinstance(value, (float, np.floating)):
        return float(value) if np.isfinite(value) else None
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, (int, np.integer)):
        return int(value)
    return value

result_json = json.dumps(json_safe(result))
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

// ============================================================
// Tabular data ("Jamovi-style") — paste a table once, then pick columns.
// ============================================================

export type ColumnKind = 'numeric' | 'categorical';

export type Dataset = {
  columns: string[];
  rows: string[][]; // cell strings aligned to columns
  kinds: ColumnKind[]; // detected per-column type
};

// Auto-detect the delimiter from the header line: tab > comma > semicolon > whitespace.
function detectDelimiter(sample: string): RegExp {
  if (sample.includes('\t')) return /\t/;
  if (sample.includes(',')) return /,/;
  if (sample.includes(';')) return /;/;
  return /\s+/;
}

// Parse pasted CSV/TSV into a typed dataset. The first row is treated as a
// header unless it is entirely numeric (then synthetic V1..Vn names are used).
export function parseDataset(text: string): Dataset {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { columns: [], rows: [], kinds: [] };

  const delim = detectDelimiter(lines[0]);
  const split = (l: string) => l.split(delim).map((c) => c.trim());

  let header = split(lines[0]);
  const firstAllNumeric =
    header.length > 0 &&
    header.every((c) => c !== '' && Number.isFinite(Number(c)));

  let dataLines: string[];
  if (firstAllNumeric) {
    header = header.map((_, i) => `V${i + 1}`);
    dataLines = lines; // first row is data, not a header
  } else {
    dataLines = lines.slice(1);
  }

  const width = header.length;
  const rows = dataLines.map((l) => {
    const cells = split(l);
    if (cells.length < width) {
      return [...cells, ...Array(width - cells.length).fill('')];
    }
    return cells.slice(0, width);
  });

  const kinds: ColumnKind[] = header.map((_, ci) => {
    let nonEmpty = 0;
    let numeric = 0;
    for (const r of rows) {
      const v = r[ci];
      if (v === undefined || v === '') continue;
      nonEmpty += 1;
      if (Number.isFinite(Number(v))) numeric += 1;
    }
    return nonEmpty > 0 && numeric / nonEmpty >= 0.8 ? 'numeric' : 'categorical';
  });

  return { columns: header, rows, kinds };
}

// Finite numeric values from a column.
export function numericColumn(ds: Dataset, col: number): number[] {
  const out: number[] = [];
  for (const r of ds.rows) {
    const n = Number(r[col]);
    if (Number.isFinite(n) && r[col] !== '' && r[col] !== undefined) out.push(n);
  }
  return out;
}

// Distinct non-empty levels of a column, in first-seen order.
export function columnLevels(ds: Dataset, col: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of ds.rows) {
    const v = (r[col] ?? '').trim();
    if (!v) continue;
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

// Split a numeric value column by a grouping column → { level, values }[].
// Rows with a non-finite value or blank group are dropped.
export function splitByGroup(
  ds: Dataset,
  valueCol: number,
  groupCol: number
): { level: string; values: number[] }[] {
  const map = new Map<string, number[]>();
  const order: string[] = [];
  for (const r of ds.rows) {
    const g = (r[groupCol] ?? '').trim();
    const raw = r[valueCol];
    const v = Number(raw);
    if (!g || raw === '' || raw === undefined || !Number.isFinite(v)) continue;
    if (!map.has(g)) {
      map.set(g, []);
      order.push(g);
    }
    map.get(g)!.push(v);
  }
  return order.map((level) => ({ level, values: map.get(level)! }));
}

// Cross-tabulate two categorical columns → contingency table + level labels.
export function crosstab(
  ds: Dataset,
  rowCol: number,
  colCol: number
): { table: number[][]; rowLevels: string[]; colLevels: string[] } {
  const rowLevels = columnLevels(ds, rowCol);
  const colLevels = columnLevels(ds, colCol);
  const rIdx = new Map(rowLevels.map((l, i) => [l, i] as const));
  const cIdx = new Map(colLevels.map((l, i) => [l, i] as const));
  const table = rowLevels.map(() => colLevels.map(() => 0));
  for (const r of ds.rows) {
    const rv = (r[rowCol] ?? '').trim();
    const cv = (r[colCol] ?? '').trim();
    const ri = rIdx.get(rv);
    const ci = cIdx.get(cv);
    if (ri !== undefined && ci !== undefined) table[ri][ci] += 1;
  }
  return { table, rowLevels, colLevels };
}
