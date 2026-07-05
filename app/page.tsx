'use client';

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import ThemeToggle from '../components/ThemeToggle';
import MobileTabBar from '../components/MobileTabBar';

type SmartMatch = {
  word: string;
  sentence: string;
  isNegated: boolean;
};

type SentenceBreakdown = {
  index: number;
  text: string;
  isNegated: boolean;
  positives: string[];
  negatives: string[];
};

type WordCount = {
  word: string;
  count: number;
  polarity: 'positive' | 'negative';
};

type ScanResult = {
  decision: string;
  sentenceCount: number;
  tokenCount: number;
  positives: SmartMatch[];
  negatives: SmartMatch[];
  sentences: SentenceBreakdown[];
  wordCounts: WordCount[];
};

// Common English + academic filler stopwords stripped before keyword extraction.
const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'also', 'am', 'an', 'and',
  'any', 'are', 'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between',
  'both', 'but', 'by', 'can', 'cannot', 'could', 'did', 'do', 'does', 'doing', 'done',
  'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having',
  'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'however', 'i',
  'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'me', 'more', 'most', 'my',
  'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other',
  'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'she', 'should', 'so', 'some',
  'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there',
  'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why',
  'will', 'with', 'would', 'you', 'your', 'yours', 'yourself', 'yourselves',
  'study', 'studies', 'group', 'groups', 'result', 'results', 'using', 'used', 'use',
  'method', 'methods', 'conclusion', 'conclusions', 'background', 'objective', 'objectives',
  'aim', 'aims', 'data', 'analysis', 'patients', 'patient', 'compared', 'versus', 'among',
  'within', 'two', 'one', 'three', 'four', 'five', 'may', 'were', 'was', 'between', 'total',
  'mean', 'median', 'showed', 'found', 'including', 'included', 'associated', 'significant',
  'significantly', 'respectively', 'overall', 'based', 'performed', 'reported', 'assessed',
]);

// Escape regex metacharacters so user-supplied keywords (e.g. "estrogen (oral)",
// "uti+", "t2dm [type 2]") can't crash or corrupt the matcher. Internal
// whitespace is then made flexible with \s+.
function keywordToRegexSource(word: string): string {
  return word
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
}

function extractCandidates(text: string, exclude: Set<string>): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return [];

  const tokens = cleaned.split(' ').filter(Boolean);

  const score = new Map<string, number>();

  const isUseful = (t: string) =>
    t.length >= 3 && !STOPWORDS.has(t) && !/^[\d-]+$/.test(t);

  // Unigrams.
  for (const tok of tokens) {
    if (!isUseful(tok)) continue;
    score.set(tok, (score.get(tok) ?? 0) + 1);
  }

  // Bigrams (multi-word clinical terms are more specific, so weight them up).
  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (!isUseful(a) || !isUseful(b)) continue;
    const bigram = `${a} ${b}`;
    score.set(bigram, (score.get(bigram) ?? 0) + 1.6);
  }

  return Array.from(score.entries())
    .filter(([word, s]) => s >= 1.6 || (score.get(word) ?? 0) >= 2 || word.includes(' ') === false)
    .filter(([word]) => !exclude.has(word))
    .sort((x, y) => y[1] - x[1] || y[0].length - x[0].length)
    .slice(0, 24)
    .map(([word]) => word);
}

// --- LOCAL PERSISTENCE (protocol survives reloads, per browser) ---
const STORE_KEY = 'srma-protocol-v1';

type PersistedProtocol = {
  positive: string[];
  negative: string[];
  dismissed: string[];
};

type IntroScene = {
  index: string;
  phase: string;
  title: string;
  copy: string;
};

const INTRO_SCENES: IntroScene[] = [
  {
    index: '01',
    phase: 'DEFINE',
    title: 'Anchor the review to a clear question',
    copy: 'Set the population, intervention, comparator, outcomes, and exclusion boundaries before screening begins. The saved protocol keeps every record aligned to the same criteria.',
  },
  {
    index: '02',
    phase: 'SCREEN',
    title: 'Review each abstract with context',
    copy: 'VESTRIPPN3.0 evaluates the full abstract first, then identifies the sentences and terms that explain the screening result.',
  },
  {
    index: '03',
    phase: 'SYNTHESIZE',
    title: 'Carry one protocol through the workflow',
    copy: 'Saved criteria flow into literature discovery and statistical analysis, keeping the Scanner, Research, and Statistics tabs connected.',
  },
];

function loadPersisted(): PersistedProtocol {
  const empty: PersistedProtocol = { positive: [], negative: [], dismissed: [] };
  if (typeof window === 'undefined') return empty;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    return {
      positive: Array.isArray(parsed.positive) ? parsed.positive : [],
      negative: Array.isArray(parsed.negative) ? parsed.negative : [],
      dismissed: Array.isArray(parsed.dismissed) ? parsed.dismissed : [],
    };
  } catch {
    return empty;
  }
}

export default function SRMATelemetryPage() {
  // --- ENGINE STATE ---
  const [inputText, setInputText] = useState('');
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [isScanned, setIsScanned] = useState(false);

  // Drill-down disclosure tiers.
  const [showSentences, setShowSentences] = useState(false);
  const [showWords, setShowWords] = useState(false);

  // --- INTRO SPLASH SCREEN (replays on every load + bfcache restore) ---
  const [introVisible, setIntroVisible] = useState(true);
  const [introLeaving, setIntroLeaving] = useState(false);
  const [introTick, setIntroTick] = useState(0);
  const [introStep, setIntroStep] = useState(0);

  const closeIntro = () => {
    setIntroLeaving(true);
    window.setTimeout(() => setIntroVisible(false), 560);
  };

  const replayIntro = () => {
    setIntroStep(0);
    setIntroLeaving(false);
    setIntroVisible(true);
    setIntroTick((t) => t + 1);
  };

  // --- CONFIGURATION STATE (hydrated from localStorage; no placeholders) ---
  const [positiveKeywords, setPositiveKeywords] = useState<string[]>(
    () => loadPersisted().positive
  );
  const [negativeKeywords, setNegativeKeywords] = useState<string[]>(
    () => loadPersisted().negative
  );

  const [isEditingProtocol, setIsEditingProtocol] = useState(false);
  const [posInput, setPosInput] = useState(() => loadPersisted().positive.join(', '));
  const [negInput, setNegInput] = useState(() => loadPersisted().negative.join(', '));

  const [dismissed, setDismissed] = useState<string[]>(
    () => loadPersisted().dismissed
  );

  // Persist the protocol whenever it changes (external-system sync).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          positive: positiveKeywords,
          negative: negativeKeywords,
          dismissed,
        })
      );
    } catch {
      /* storage unavailable (private mode / quota) — non-fatal */
    }
  }, [positiveKeywords, negativeKeywords, dismissed]);

  // Replay the intro animation on every appearance — including
  // back/forward (bfcache) restores, which a fresh CSS load misses.
  useEffect(() => {
    const replay = () => {
      const els = document.querySelectorAll<HTMLElement>(
        '.intro, .intro-atmosphere'
      );
      els.forEach((el) => {
        el.style.animation = 'none';
        void el.offsetWidth; // force reflow so the animation restarts
        el.style.animation = '';
      });
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        replay();
        // Re-run the research intro on back/forward (bfcache) restores.
        replayIntro();
      }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  // Heuristic Negation Dictionary
  const negationTriggers = [
    'exclud', 'without', 'no ', 'exception', 'ruled out', 'history of', 'omitted',
  ];

  // --- AUTO-SUGGEST: derived from the pasted text ---
  const suggestions = useMemo(() => {
    const exclude = new Set<string>([
      ...positiveKeywords,
      ...negativeKeywords,
      ...dismissed,
    ]);
    return extractCandidates(inputText, exclude);
  }, [inputText, positiveKeywords, negativeKeywords, dismissed]);

  const resetResults = () => {
    setScan(null);
    setIsScanned(false);
    setShowSentences(false);
    setShowWords(false);
  };

  const classify = (word: string, polarity: 'positive' | 'negative') => {
    const w = word.trim().toLowerCase();
    if (!w) return;
    if (polarity === 'positive') {
      setPositiveKeywords((prev) => {
        if (prev.includes(w)) return prev;
        const next = [...prev, w];
        setPosInput(next.join(', '));
        return next;
      });
      setNegativeKeywords((prev) => {
        if (!prev.includes(w)) return prev;
        const next = prev.filter((k) => k !== w);
        setNegInput(next.join(', '));
        return next;
      });
    } else {
      setNegativeKeywords((prev) => {
        if (prev.includes(w)) return prev;
        const next = [...prev, w];
        setNegInput(next.join(', '));
        return next;
      });
      setPositiveKeywords((prev) => {
        if (!prev.includes(w)) return prev;
        const next = prev.filter((k) => k !== w);
        setPosInput(next.join(', '));
        return next;
      });
    }
    resetResults();
  };

  const removeKeyword = (word: string, polarity: 'positive' | 'negative') => {
    if (polarity === 'positive') {
      setPositiveKeywords((prev) => {
        const next = prev.filter((k) => k !== word);
        setPosInput(next.join(', '));
        return next;
      });
    } else {
      setNegativeKeywords((prev) => {
        const next = prev.filter((k) => k !== word);
        setNegInput(next.join(', '));
        return next;
      });
    }
    resetResults();
  };

  const dismissSuggestion = (word: string) => {
    setDismissed((prev) => (prev.includes(word) ? prev : [...prev, word]));
  };

  // --- PROTOCOL HANDLER (manual editor stays as a power-user fallback) ---
  const handleApplyProtocol = () => {
    const parseKeywords = (raw: string) =>
      raw
        .split(',')
        .map((w) => w.trim().toLowerCase())
        .filter((w) => w.length > 0);

    setPositiveKeywords(parseKeywords(posInput));
    setNegativeKeywords(parseKeywords(negInput));
    setIsEditingProtocol(false);
    resetResults();
  };

  // --- HIERARCHICAL ENGINE: abstract -> sentences -> words ---
  const handleScan = () => {
    if (!inputText.trim()) return;

    const normalizedText = inputText.replace(/\s+/g, ' ').trim();
    const rawSentences = normalizedText.match(/[^.!?]+[.!?]+/g) || [normalizedText];
    const sentences = rawSentences.map((s) => s.trim()).filter(Boolean);
    const tokenCount = normalizedText.split(' ').filter(Boolean).length;

    const isSentenceNegated = (sentence: string) => {
      const lower = sentence.toLowerCase();
      return negationTriggers.some((trigger) => lower.includes(trigger));
    };

    const buildRegex = (word: string) =>
      new RegExp(`\\b${keywordToRegexSource(word)}\\b`, 'gi');

    const abstractPositives = new Map<string, SmartMatch>();
    const abstractNegatives = new Map<string, SmartMatch>();
    const sentenceBreakdown: SentenceBreakdown[] = [];

    sentences.forEach((sentence, index) => {
      const isNegatedContext = isSentenceNegated(sentence);
      const posHere: string[] = [];
      const negHere: string[] = [];

      positiveKeywords.forEach((word) => {
        if (buildRegex(word).test(sentence)) {
          posHere.push(word);
          if (!abstractPositives.has(word)) {
            abstractPositives.set(word, { word, sentence, isNegated: false });
          }
        }
      });

      negativeKeywords.forEach((word) => {
        if (buildRegex(word).test(sentence)) {
          negHere.push(word);
          if (!abstractNegatives.has(word)) {
            abstractNegatives.set(word, { word, sentence, isNegated: isNegatedContext });
          }
        }
      });

      if (posHere.length > 0 || negHere.length > 0) {
        sentenceBreakdown.push({
          index,
          text: sentence,
          isNegated: isNegatedContext,
          positives: posHere,
          negatives: negHere,
        });
      }
    });

    // Word-level: total occurrences of each matched keyword across the abstract.
    const wordCounts: WordCount[] = [];
    const countAll = (word: string) =>
      (normalizedText.match(buildRegex(word)) || []).length;

    Array.from(abstractPositives.keys()).forEach((word) => {
      wordCounts.push({ word, count: countAll(word), polarity: 'positive' });
    });
    Array.from(abstractNegatives.keys()).forEach((word) => {
      wordCounts.push({ word, count: countAll(word), polarity: 'negative' });
    });
    wordCounts.sort((a, b) => b.count - a.count);

    const posArray = Array.from(abstractPositives.values());
    const negArray = Array.from(abstractNegatives.values());

    const hardExclusions = negArray.filter((n) => !n.isNegated).length;
    const negatedExclusions = negArray.filter((n) => n.isNegated).length;

    let decision: string;
    if (positiveKeywords.length === 0 && negativeKeywords.length === 0) {
      decision = 'NO_CRITERIA';
    } else if (hardExclusions > 0) {
      decision = 'EXCLUDE';
    } else if (negatedExclusions > 0) {
      decision = 'UNCLEAR';
    } else if (posArray.length > 0) {
      decision = 'INCLUDE / MAYBE';
    } else {
      decision = 'UNCLEAR';
    }

    setScan({
      decision,
      sentenceCount: sentences.length,
      tokenCount,
      positives: posArray,
      negatives: negArray,
      sentences: sentenceBreakdown,
      wordCounts,
    });
    setShowSentences(false);
    setShowWords(false);
    setIsScanned(true);
  };

  const handleClear = () => {
    setInputText('');
    resetResults();
  };

  const getHighlightedText = (text: string) => {
    if (!text) return null;
    const allKeywords = [...positiveKeywords, ...negativeKeywords].sort(
      (a, b) => b.length - a.length
    );
    if (allKeywords.length === 0) return text;

    const regexPattern = allKeywords.map(keywordToRegexSource).join('|');
    const regex = new RegExp(`\\b(${regexPattern})\\b`, 'gi');
    const parts = text.split(regex);

    return parts.map((part, i) => {
      if (!part) return null;
      const lowerPart = part.toLowerCase().replace(/\s+/g, ' ');

      if (positiveKeywords.includes(lowerPart)) {
        return (
          <span
            key={i}
            className="bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-400 font-bold px-1 rounded border border-emerald-200 dark:border-emerald-500/30 transition-colors"
          >
            {part}
          </span>
        );
      } else if (negativeKeywords.includes(lowerPart)) {
        const isNegated = scan?.negatives.some(
          (n) => n.word === lowerPart && n.isNegated
        );
        if (isNegated) {
          return (
            <span
              key={i}
              className="bg-yellow-100 dark:bg-yellow-500/20 text-yellow-800 dark:text-yellow-400 font-bold px-1 rounded border border-yellow-200 dark:border-yellow-500/30 cursor-help transition-colors"
              title="Context implies this exclusion was controlled for."
            >
              {part}
            </span>
          );
        }
        return (
          <span
            key={i}
            className="bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-400 font-bold px-1 rounded border border-red-200 dark:border-red-500/30 transition-colors"
          >
            {part}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  const decision = scan?.decision ?? null;

  const decisionBannerClass =
    decision === 'EXCLUDE'
      ? 'bg-red-50/80 dark:bg-red-950/30 border-red-200 dark:border-red-500/50 text-red-600 dark:text-red-500 shadow-[0_4px_20px_rgba(220,38,38,0.05)] dark:shadow-[0_0_20px_rgba(239,68,68,0.15)]'
      : decision === 'INCLUDE / MAYBE'
      ? 'bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-500/50 text-emerald-600 dark:text-emerald-400 shadow-[0_4px_20px_rgba(16,185,129,0.05)] dark:shadow-[0_0_20px_rgba(16,185,129,0.15)]'
      : 'bg-yellow-50/80 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-500/50 text-yellow-600 dark:text-yellow-500 shadow-[0_4px_20px_rgba(234,179,8,0.05)] dark:shadow-[0_0_20px_rgba(234,179,8,0.15)]';

  const decisionLabel =
    decision === 'EXCLUDE'
      ? 'Exclude — criterion detected'
      : decision === 'INCLUDE / MAYBE'
      ? 'Include / maybe — relevant evidence found'
      : decision === 'NO_CRITERIA'
      ? 'Add screening criteria'
      : 'Needs review — context is ambiguous';

  const introScene = INTRO_SCENES[introStep];
  const isLastIntroStep = introStep === INTRO_SCENES.length - 1;

  // Hero/context summary.
  const totalCriteria = positiveKeywords.length + negativeKeywords.length;
  const protocolStatusLine =
    totalCriteria === 0
      ? 'No criteria saved yet. Paste an abstract and review the suggested inclusion or exclusion terms.'
      : `${positiveKeywords.length} inclusion and ${negativeKeywords.length} exclusion terms saved in this browser.`;

  const focusScanner = () => {
    const el = document.getElementById('engine');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => {
      const ta = el.querySelector<HTMLTextAreaElement>('textarea');
      ta?.focus();
    }, 450);
  };

  // --- UI RENDER ---
  return (
    <div className="min-h-screen flex flex-col app-canvas text-foreground relative overflow-hidden font-sans selection:bg-[#00A598]/30 transition-colors duration-700">

      {/* CUSTOM ANIMATION STYLES */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes introUp {
          from { opacity: 0; transform: translateY(18px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes introGlow {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .intro { opacity: 0; animation: introUp 0.7s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .intro-delay-1 { animation-delay: 0.08s; }
        .intro-delay-2 { animation-delay: 0.20s; }
        .intro-delay-3 { animation-delay: 0.32s; }
        .intro-delay-4 { animation-delay: 0.44s; }
        .intro-atmosphere { opacity: 0; animation: introGlow 1.8s ease-out 0.1s both; }

        /* --- Research workflow intro screen --- */
        @keyframes researchCardIn {
          from { opacity: 0; transform: translateY(24px) scale(0.975); filter: blur(10px); }
          to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }
        @keyframes researchPanelIn {
          from { opacity: 0; transform: translateY(18px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes researchRowIn {
          from { opacity: 0; transform: translateX(-10px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes reviewSweep {
          0% { transform: translateY(-110%); opacity: 0; }
          15%, 70% { opacity: 1; }
          100% { transform: translateY(210%); opacity: 0; }
        }
        @keyframes progressIgnite {
          from { width: 0; opacity: 0.35; }
          to { width: 100%; opacity: 1; }
        }
        .research-card { animation: researchCardIn 0.75s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .research-panel { animation: researchPanelIn 0.55s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .research-row { animation: researchRowIn 0.45s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .review-sweep { animation: reviewSweep 3s cubic-bezier(0.5, 0, 0.2, 1) infinite; }
        .progress-ignite { animation: progressIgnite 0.55s cubic-bezier(0.22, 1, 0.36, 1) both; }

        @media (prefers-reduced-motion: reduce) {
          .intro, .intro-atmosphere, .research-card, .research-panel, .research-row, .progress-ignite {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
          }
          .review-sweep { animation: none !important; }
          .progress-ignite { width: 100% !important; }
        }
      `}} />

      {/* INTRO RESEARCH WORKFLOW SCREEN */}
      {introVisible && (
        <div
          key={`srma-research-${introTick}`}
          className={`fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-background text-foreground transition-opacity duration-700 ${
            introLeaving ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(0,165,152,0.12),transparent_32%),radial-gradient(circle_at_80%_8%,rgba(59,130,246,0.10),transparent_30%),linear-gradient(rgba(15,23,42,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.04)_1px,transparent_1px)] dark:bg-[radial-gradient(circle_at_20%_0%,rgba(0,165,152,0.09),transparent_32%),radial-gradient(circle_at_80%_8%,rgba(59,130,246,0.08),transparent_30%),linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:auto,auto,72px_72px,72px_72px]"></div>

          <button
            onClick={closeIntro}
            className="clay-button absolute right-4 top-4 sm:right-8 sm:top-7 z-20 rounded-full px-4 py-2 text-[10px] sm:text-[11px] font-black uppercase tracking-[0.18em] text-neutral-500 dark:text-slate-300 active:scale-95"
          >
            Skip Intro
          </button>

          <div className="research-card clay custom-scrollbar relative z-10 mx-4 max-h-[calc(100vh-28px)] w-full max-w-[980px] overflow-y-auto rounded-[28px] p-4 sm:p-6 lg:p-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="pr-24 sm:pr-0 font-mono text-[10px] font-black uppercase tracking-[0.2em] sm:tracking-[0.34em] text-cyan-600 dark:text-cyan-300">
                  VESTRIPPN3.0
                </p>
                <h2 className="mt-2 text-[30px] font-black leading-none tracking-tighter text-neutral-950 dark:text-white sm:text-[44px] lg:text-[50px]">
                  Systematic Review Workflow
                </h2>
                <p className="mt-3 max-w-2xl text-[13px] font-semibold leading-relaxed text-neutral-500 dark:text-slate-400 sm:text-[15px]">
                  Define the protocol, screen abstracts with transparent evidence, discover related studies, and analyze extracted data.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center lg:min-w-[290px]">
                {[
                  ['Protocol', 'Saved'],
                  ['Sources', '2'],
                  ['Analysis', 'Local'],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-black/5 bg-white/55 p-3 dark:border-white/10 dark:bg-white/[0.035]">
                    <div className="text-[9px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-500">
                      {label}
                    </div>
                    <div className="mt-1 text-[14px] font-black text-neutral-900 dark:text-white">
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="research-panel clay-inset relative mt-5 overflow-hidden rounded-[22px] p-4 sm:p-5">
              <div className="review-sweep absolute left-0 right-0 top-0 h-20 bg-gradient-to-b from-transparent via-[#00A598]/10 to-transparent"></div>

              <div className="relative z-10 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.1fr]">
                <div className="rounded-2xl border border-black/5 bg-white/65 p-4 dark:border-white/10 dark:bg-white/[0.035]">
                  {introStep === 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3 border-b border-black/5 pb-3 dark:border-white/10">
                        <div>
                          <div className="text-[10px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-500">
                            Review protocol
                          </div>
                          <div className="mt-1 text-[16px] font-black text-neutral-900 dark:text-white">
                            PICO criteria board
                          </div>
                        </div>
                        <span className="rounded-lg border border-[#00A598]/30 bg-[#00A598]/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-[#00A598]">
                          Ready
                        </span>
                      </div>
                      {[
                        ['P', 'Population', 'Target participants or condition', 'clay-chip-emerald'],
                        ['I', 'Intervention', 'Exposure, therapy, or index test', 'clay-chip-blue'],
                        ['C', 'Comparator', 'Placebo, standard care, or alternate arm', 'clay-chip-violet'],
                        ['O', 'Outcomes', 'Primary endpoints and extracted measures', 'clay-chip-amber'],
                      ].map(([code, label, text, chip], i) => (
                        <div
                          key={code}
                          className="research-row flex items-start gap-3 rounded-xl border border-black/5 bg-white/55 p-3 dark:border-white/10 dark:bg-black/20"
                          style={{ animationDelay: `${i * 0.07}s` }}
                        >
                          <div className={`clay-chip ${chip} flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[12px] font-black`}>
                            {code}
                          </div>
                          <div>
                            <div className="text-[12px] font-black text-neutral-900 dark:text-white">
                              {label}
                            </div>
                            <div className="mt-0.5 text-[11px] leading-relaxed text-neutral-500 dark:text-slate-400">
                              {text}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {introStep === 1 && (
                    <div className="space-y-3">
                      <div className="text-[10px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-500">
                        Abstract record
                      </div>
                      <div className="rounded-2xl border border-black/5 bg-white/70 p-4 dark:border-white/10 dark:bg-black/20">
                        <div className="h-3 w-3/4 rounded-full bg-neutral-300 dark:bg-slate-700"></div>
                        <div className="mt-3 space-y-2">
                          <div className="h-2 rounded-full bg-neutral-200 dark:bg-slate-800"></div>
                          <div className="h-2 rounded-full bg-neutral-200 dark:bg-slate-800"></div>
                          <div className="h-2 w-5/6 rounded-full bg-neutral-200 dark:bg-slate-800"></div>
                        </div>
                      </div>
                      {[
                        ['Sentence 1', 'Population + condition detected', 'include'],
                        ['Sentence 3', 'Intervention phrase detected', 'include'],
                        ['Sentence 5', 'Exclusion trigger in context', 'review'],
                      ].map(([label, text, tone], i) => (
                        <div
                          key={label}
                          className="research-row flex items-center justify-between gap-3 rounded-xl border border-black/5 bg-white/55 p-3 dark:border-white/10 dark:bg-black/20"
                          style={{ animationDelay: `${i * 0.08}s` }}
                        >
                          <div>
                            <div className="text-[11px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-500">
                              {label}
                            </div>
                            <div className="mt-1 text-[12px] font-semibold text-neutral-700 dark:text-slate-300">
                              {text}
                            </div>
                          </div>
                          <span
                            className={`rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-widest ${
                              tone === 'review'
                                ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300'
                                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                            }`}
                          >
                            {tone}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {introStep === 2 && (
                    <div className="space-y-3">
                      <div className="text-[10px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-500">
                        Screening decisions
                      </div>
                      {[
                        ['Include', 'Matches the protocol without an exclusion trigger', 'emerald'],
                        ['Needs review', 'Relevant terms are present, but context needs a second look', 'yellow'],
                        ['Exclude', 'An exclusion criterion or ineligible study type was detected', 'red'],
                      ].map(([label, text, tone], i) => (
                        <div
                          key={label}
                          className={`research-row rounded-2xl border p-4 ${
                            tone === 'emerald'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300'
                              : tone === 'yellow'
                              ? 'border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-500/25 dark:bg-yellow-500/10 dark:text-yellow-300'
                              : 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300'
                          }`}
                          style={{ animationDelay: `${i * 0.08}s` }}
                        >
                          <div className="text-[13px] font-black">{label}</div>
                          <div className="mt-1 text-[11px] leading-relaxed opacity-80">{text}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-black/5 bg-white/50 p-4 dark:border-white/10 dark:bg-black/20">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-500">
                        Review workflow
                      </div>
                      <div className="mt-1 text-[16px] font-black text-neutral-900 dark:text-white">
                        {introStep === 0
                          ? 'Define before screening'
                          : introStep === 1
                          ? 'Decisions with context'
                          : 'Evidence ready to reuse'}
                      </div>
                    </div>
                    <div className="rounded-full border border-black/10 bg-white/65 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-neutral-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
                      Step {introStep + 1}/3
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-1">
                    {(introStep === 0
                      ? [
                          ['1', 'Save the protocol', 'Inclusion and exclusion terms persist after reload.'],
                          ['2', 'Detect candidates', 'Candidate terms are extracted from each pasted abstract.'],
                          ['3', 'Apply consistently', 'The same criteria guide scanning and literature discovery.'],
                        ]
                      : introStep === 1
                      ? [
                          ['1', 'Whole abstract', 'Context is read before sentence-level hits.'],
                          ['2', 'Sentence evidence', 'Matched sentences explain why a record was classified.'],
                          ['3', 'Keyword evidence', 'Term counts show what influenced the decision.'],
                        ]
                      : [
                          ['1', 'Scanner', 'Triage the current abstract.'],
                          ['2', 'Research', 'Search external records with the saved protocol.'],
                          ['3', 'Statistics', 'Analyze extracted numbers locally.'],
                        ]
                    ).map(([num, label, text], i) => (
                      <div
                        key={label}
                        className="research-row flex gap-3 rounded-xl border border-black/5 bg-white/55 p-3 dark:border-white/10 dark:bg-white/[0.035]"
                        style={{ animationDelay: `${i * 0.08}s` }}
                      >
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#00A598]/30 bg-[#00A598]/10 text-[11px] font-black text-[#00A598]">
                          {num}
                        </div>
                        <div>
                          <div className="text-[12px] font-black text-neutral-900 dark:text-white">
                            {label}
                          </div>
                          <div className="mt-0.5 text-[11px] leading-relaxed text-neutral-500 dark:text-slate-400">
                            {text}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5">
              <div className="font-mono text-[12px] font-black uppercase tracking-[0.28em] text-[#00A598]">
                {introScene.index} <span className="mx-3 inline-block h-px w-8 translate-y-[-3px] bg-[#00A598]/50"></span> {introScene.phase}
              </div>
              <h3 className="mt-2 text-[25px] font-black tracking-tight text-neutral-950 dark:text-white sm:text-[31px]">
                {introScene.title}
              </h3>
              <p className="mt-2 max-w-[760px] text-[14px] font-semibold leading-relaxed text-neutral-600 dark:text-slate-400 sm:text-[16px]">
                {introScene.copy}
              </p>
            </div>

            <div className="mt-5 border-t border-black/10 pt-4 dark:border-white/10">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-3">
                  {INTRO_SCENES.map((scene, index) => (
                    <button
                      key={scene.index}
                      onClick={() => setIntroStep(index)}
                      aria-label={`Go to intro step ${scene.index}`}
                      className={`h-3 rounded-full transition-all ${
                        index === introStep
                          ? 'w-16 bg-[#00A598] shadow-[0_0_18px_rgba(0,165,152,0.45)]'
                          : 'w-10 bg-neutral-300 hover:bg-neutral-400 dark:bg-slate-700 dark:hover:bg-slate-600'
                      }`}
                    >
                      {index === introStep && <span className="progress-ignite block h-full rounded-full bg-gradient-to-r from-[#00A598] via-blue-400 to-violet-400"></span>}
                    </button>
                  ))}
                </div>

                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setIntroStep((s) => Math.max(0, s - 1))}
                    disabled={introStep === 0}
                    className="clay-button rounded-full px-6 py-3 text-[13px] font-black text-neutral-600 disabled:cursor-not-allowed disabled:opacity-35 dark:text-slate-300"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => {
                      if (isLastIntroStep) {
                        closeIntro();
                        return;
                      }
                      setIntroStep((s) => Math.min(INTRO_SCENES.length - 1, s + 1));
                    }}
                    className="clay-primary rounded-full px-7 py-3 text-[13px] font-black active:scale-95"
                  >
                    {isLastIntroStep ? 'Get Started' : 'Next'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Observatory atmosphere: nebulae, starfield, radar sweep, shooting star */}
      <div className="intro-atmosphere absolute inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="obs-drift-a absolute top-[-14%] right-[4%] w-[58%] h-[58%] rounded-full bg-[radial-gradient(circle,rgba(56,189,248,0.22),transparent_66%)] blur-[120px]"></div>
        <div className="obs-drift-b absolute bottom-[-16%] left-[0%] w-[54%] h-[54%] rounded-full bg-[radial-gradient(circle,rgba(168,85,247,0.20),transparent_66%)] blur-[120px]"></div>
        <div className="absolute inset-0 obs-starfield"></div>
        <div className="obs-sweep absolute -top-[20%] -right-[10%] w-[60%] h-[120%] opacity-40 dark:opacity-60"></div>
        <div className="obs-shoot absolute top-[16%] left-[62%] h-[2px] w-[150px] rounded-full"></div>
      </div>

      {/* MINIMALIST HEADER */}
      <header className="intro intro-delay-1 clay-header h-[64px] lg:h-[72px] flex items-center justify-between px-4 lg:px-8 shrink-0 z-50 transition-colors duration-700">
        <div className="flex items-center gap-4 lg:gap-8">
          <Link href="/" aria-label="VESTRIPPN3.0 home" className="font-black text-[18px] lg:text-[20px] tracking-tighter flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="brand-mark w-8 h-8 rounded-lg flex items-center justify-center text-[15px]">V</div>
            <div className="flex items-baseline" aria-label="VESTRIPPN3.0">
              <span>VESTRIPPN</span>
              <span className="brand-version transition-colors duration-700">3.0</span>
            </div>
          </Link>
          <nav className="hidden sm:flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest">
            <span className="clay-tab clay-tab-active px-3 py-1.5 rounded-lg">Scanner</span>
            <Link href="/research" className="clay-tab px-3 py-1.5 rounded-lg">Research</Link>
            <Link href="/stats" className="clay-tab px-3 py-1.5 rounded-lg">Statistics</Link>
          </nav>
        </div>

        <div className="flex gap-4 lg:gap-6 items-center">
          <ThemeToggle />
        </div>
      </header>

      {/* MAIN WORKSPACE */}
      <main className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-5 lg:p-8 pb-32 lg:pb-8 relative z-10 transition-all duration-500">
        <div className="max-w-[1120px] mx-auto space-y-6 lg:space-y-8">

          {/* HERO SECTION */}
          <section className="intro intro-delay-2 clay-soft rounded-[24px] p-5 sm:p-7 lg:p-8 flex flex-col gap-5">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
              <div className="max-w-3xl">
                <p className="font-mono text-[10px] font-black uppercase tracking-[0.28em] text-cyan-600 dark:text-cyan-300">
                  Abstract Scanner
                </p>
                <h1 className="mt-2 text-[32px] sm:text-[44px] lg:text-[54px] font-black tracking-tighter leading-[0.98] text-neutral-900 dark:text-white">
                  Screen{' '}
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-500 via-indigo-500 to-violet-500 dark:from-cyan-300 dark:via-indigo-300 dark:to-violet-300">
                    evidence
                  </span>{' '}
                  from one abstract at a time.
                </h1>
                <p className="mt-4 max-w-2xl text-[13px] sm:text-[14px] leading-relaxed text-neutral-600 dark:text-slate-400">
                  Paste an abstract, review its suggested keywords, mark inclusion and exclusion terms, then inspect the decision from abstract to sentence to word.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row lg:flex-col gap-3 lg:min-w-[260px]">
                <button
                  onClick={focusScanner}
                  className="clay-primary px-5 py-3 rounded-xl text-[12px] font-black uppercase tracking-[0.18em] active:scale-95"
                >
                  Start Screening
                </button>
                <Link
                  href="/research"
                  className="clay-button px-5 py-3 rounded-xl text-[12px] font-black uppercase tracking-[0.18em] text-center"
                >
                  Open Research
                </Link>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 border-t border-black/5 dark:border-white/10 pt-4">
              {[
                ['Saved protocol', protocolStatusLine, 'clay-mint'],
                ['Research search', 'Search Europe PMC and OpenAlex, then screen every result against the same saved criteria.', 'clay-sky'],
                ['Statistical analysis', 'Summarize extracted numbers with confidence intervals, effect sizes, and diagnostics in the browser.', 'clay-lilac'],
              ].map(([label, text, tone]) => (
                <div key={label} className={`clay-soft ${tone} rounded-2xl p-4`}>
                  <div className="text-[10px] font-black uppercase tracking-[0.22em] text-neutral-500 dark:text-slate-500">
                    {label}
                  </div>
                  <p className="mt-2 text-[12px] leading-relaxed text-neutral-600 dark:text-slate-400">
                    {text}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* THE ENGINE (Bento Box Wrapper) */}
          <div id="engine" className="intro intro-delay-4 relative clay clay-sheen flex flex-col rounded-[24px] lg:rounded-[32px] p-5 lg:p-8 transition-all duration-700 scroll-mt-24">

            {/* Dynamic Protocol Editor Header */}
            <div className="flex justify-between items-center mb-6 px-1">
              <h2 className="font-bold text-[16px] tracking-tight flex items-center gap-2 text-neutral-900 dark:text-white transition-colors duration-700">
                <span className="w-2 h-2 rounded-full bg-cyan-400 obs-pulse"></span> Abstract Input
                <span className="text-[9px] font-black text-cyan-600 dark:text-cyan-300 border border-cyan-500/30 dark:border-cyan-400/30 bg-cyan-50 dark:bg-cyan-400/10 px-1.5 py-0.5 rounded ml-2 uppercase tracking-widest transition-colors hidden sm:inline-block">Auto-Detect</span>
              </h2>
              <button
                onClick={() => setIsEditingProtocol(!isEditingProtocol)}
                className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                  isEditingProtocol
                    ? 'clay-tab-active'
                    : 'clay-button text-neutral-500 dark:text-slate-400'
                }`}
              >
                {isEditingProtocol ? 'Close Editor' : 'Edit Protocol'}
              </button>
            </div>

            {/* Protocol Editor Panel (manual fallback — starts empty) */}
            {isEditingProtocol && (
              <div className="clay-soft mb-6 p-5 rounded-2xl animate-in fade-in slide-in-from-top-2 transition-colors duration-700">
                <h3 className="text-[13px] font-bold text-neutral-700 dark:text-white mb-4 border-b border-black/5 dark:border-white/10 pb-2 transition-colors">Manual Protocol Criteria</h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                  <div>
                    <label className="block text-[11px] font-bold text-cyan-600 dark:text-cyan-300 mb-2 uppercase tracking-wide transition-colors">
                      Inclusion terms (comma separated)
                    </label>
                    <textarea
                      className="clay-field w-full h-32 p-3 text-neutral-700 dark:text-slate-300 font-mono text-[12px] rounded-xl focus:outline-none custom-scrollbar transition-colors"
                      placeholder="Empty — capture from detections or type here"
                      value={posInput}
                      onChange={(e) => setPosInput(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-rose-500 dark:text-rose-400 mb-2 uppercase tracking-wide transition-colors">
                      Exclusion terms (comma separated)
                    </label>
                    <textarea
                      className="clay-field w-full h-32 p-3 text-neutral-700 dark:text-slate-300 font-mono text-[12px] rounded-xl focus:outline-none custom-scrollbar transition-colors"
                      placeholder="Empty — populate from suggestions or type here"
                      value={negInput}
                      onChange={(e) => setNegInput(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => {
                      setPosInput('');
                      setNegInput('');
                    }}
                    className="clay-button px-4 py-2 rounded-lg text-[12px] font-bold text-neutral-500 dark:text-slate-400"
                  >
                    Clear All
                  </button>
                  <button
                    onClick={handleApplyProtocol}
                    className="clay-primary px-5 py-2 text-[12px] font-bold rounded-lg"
                  >
                    Save Protocol
                  </button>
                </div>
              </div>
            )}

            {/* Input Form */}
            <div className="space-y-4">
              <textarea
                className="clay-field w-full h-48 p-5 rounded-2xl text-[13px] font-mono text-neutral-700 dark:text-slate-200 leading-relaxed focus:outline-none transition-all resize-none custom-scrollbar"
                placeholder="Paste the abstract here. Candidate keywords appear as you type…"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
              />

              {/* AUTO-SUGGEST + CLASSIFICATION PANEL */}
              {!isEditingProtocol && inputText.trim().length > 0 && (
                <div className="clay-soft p-5 rounded-2xl transition-all space-y-5 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[13px] font-bold text-neutral-700 dark:text-white flex items-center gap-2 transition-colors">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 obs-pulse"></span>
                      Suggested Keywords
                    </h3>
                    <span className="text-[9px] font-black text-cyan-600 dark:text-cyan-300 border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 rounded uppercase tracking-widest">
                      + include · − exclude
                    </span>
                  </div>

                  {suggestions.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {suggestions.map((word) => (
                        <span
                          key={word}
                          className="clay-button group inline-flex items-center gap-1 rounded-lg pl-2.5 pr-1 py-1 text-[11px] font-semibold text-neutral-600 dark:text-slate-300"
                        >
                          <span className="truncate max-w-[180px]">{word}</span>
                          <button
                            onClick={() => classify(word, 'positive')}
                            title="Add as an inclusion term"
                            className="w-5 h-5 flex items-center justify-center rounded-md text-cyan-600 dark:text-cyan-300 hover:bg-cyan-100 dark:hover:bg-cyan-500/20 font-black transition-colors"
                          >
                            ＋
                          </button>
                          <button
                            onClick={() => classify(word, 'negative')}
                            title="Add as an exclusion term"
                            className="w-5 h-5 flex items-center justify-center rounded-md text-rose-500 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-500/20 font-black transition-colors"
                          >
                            −
                          </button>
                          <button
                            onClick={() => dismissSuggestion(word)}
                            title="Discard"
                            className="w-5 h-5 flex items-center justify-center rounded-md text-neutral-400 dark:text-slate-500 hover:bg-neutral-200 dark:hover:bg-white/10 transition-colors"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[12px] text-neutral-400 dark:text-slate-500 italic">
                      No candidates left in range — every notable term is logged or discarded.
                    </p>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2 border-t border-black/5 dark:border-white/10">
                    <div>
                      <h4 className="text-[11px] font-bold text-cyan-600 dark:text-cyan-300 mb-2 uppercase tracking-wide transition-colors">
                        Inclusion terms ({positiveKeywords.length})
                      </h4>
                      {positiveKeywords.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {positiveKeywords.map((word) => (
                            <span
                              key={word}
                              className="inline-flex items-center gap-1.5 bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-500/20 rounded-lg pl-2.5 pr-1.5 py-1 text-[11px] font-bold transition-colors"
                            >
                              {word}
                              <button
                                onClick={() => removeKeyword(word, 'positive')}
                                className="text-cyan-500/70 hover:text-cyan-700 dark:hover:text-cyan-200 transition-colors"
                                title="Remove"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[12px] text-neutral-400 dark:text-slate-500 italic">None yet.</p>
                      )}
                    </div>
                    <div>
                      <h4 className="text-[11px] font-bold text-rose-500 dark:text-rose-400 mb-2 uppercase tracking-wide transition-colors">
                        Exclusion terms ({negativeKeywords.length})
                      </h4>
                      {negativeKeywords.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {negativeKeywords.map((word) => (
                            <span
                              key={word}
                              className="inline-flex items-center gap-1.5 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-300 border border-rose-200 dark:border-rose-500/20 rounded-lg pl-2.5 pr-1.5 py-1 text-[11px] font-bold transition-colors"
                            >
                              {word}
                              <button
                                onClick={() => removeKeyword(word, 'negative')}
                                className="text-rose-500/70 hover:text-rose-700 dark:hover:text-rose-200 transition-colors"
                                title="Remove"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[12px] text-neutral-400 dark:text-slate-500 italic">None yet.</p>
                      )}
                    </div>
                  </div>

                  <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 dark:text-slate-500 flex items-center gap-1.5 pt-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 obs-pulse"></span>
                    Protocol auto-saved in this browser
                  </p>
                </div>
              )}

              <div className="flex gap-4">
                <button
                  onClick={handleClear}
                  className="clay-button px-6 py-3.5 text-neutral-600 dark:text-slate-300 text-sm font-bold rounded-xl active:scale-95"
                >
                  Reset Scanner
                </button>
                <button
                  onClick={handleScan}
                  disabled={!inputText.trim() || isEditingProtocol}
                  className="clay-primary flex-1 py-3.5 disabled:cursor-not-allowed text-sm font-bold rounded-xl active:scale-[0.98]"
                >
                  Analyze Abstract
                </button>
              </div>
            </div>

            {/* Results Dashboard — LAYERED DRILL-DOWN */}
            {isScanned && scan && (
              <div className="mt-8 pt-8 border-t border-black/5 dark:border-white/10 animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">

                {/* TIER 1 — ABSTRACT-LEVEL VERDICT */}
                <div className={`clay-inset flex flex-col items-center justify-center p-6 rounded-2xl transition-colors ${decisionBannerClass}`}>
                  <h1 className="text-2xl sm:text-3xl font-black tracking-tight flex items-center gap-3 text-center">
                    {decisionLabel}
                  </h1>
                  {decision === 'NO_CRITERIA' && (
                    <span className="text-[11px] font-mono text-yellow-600 dark:text-yellow-300/70 mt-3 block tracking-normal uppercase bg-yellow-100 dark:bg-black/20 px-3 py-1 rounded text-center">
                      Add at least one inclusion or exclusion term before screening.
                    </span>
                  )}
                  {decision === 'UNCLEAR' && scan.negatives.some((n) => n.isNegated) && (
                    <span className="text-[11px] font-mono text-yellow-600 dark:text-yellow-300/70 mt-3 block tracking-normal uppercase bg-yellow-100 dark:bg-black/20 px-3 py-1 rounded text-center">
                      Exclusion term ignored because it appeared in a negated sentence.
                    </span>
                  )}
                </div>

                {/* Abstract summary stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Inclusion hits', value: scan.positives.length, accent: 'text-cyan-600 dark:text-cyan-300' },
                    { label: 'Exclusion hits', value: scan.negatives.length, accent: 'text-rose-500 dark:text-rose-400' },
                    { label: 'Sentences', value: scan.sentenceCount, accent: 'text-indigo-600 dark:text-indigo-300' },
                    { label: 'Words', value: scan.tokenCount, accent: 'text-neutral-600 dark:text-slate-300' },
                  ].map((stat) => (
                    <div key={stat.label} className="clay-soft p-4 rounded-xl text-center transition-all hover:-translate-y-0.5">
                      <div className={`text-2xl font-black ${stat.accent}`}>{stat.value}</div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 dark:text-slate-500 mt-1">{stat.label}</div>
                    </div>
                  ))}
                </div>

                {/* TIER 2 — SENTENCE DRILL-DOWN */}
                <div className="clay-soft rounded-2xl transition-all overflow-hidden">
                  <button
                    onClick={() => setShowSentences((v) => !v)}
                    className="w-full flex items-center justify-between p-5 hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors"
                  >
                    <span className="font-bold text-[13px] text-neutral-700 dark:text-slate-200 flex items-center gap-2 tracking-tight">
                      <span className="text-cyan-500 dark:text-cyan-300">▾</span> Review sentence evidence
                      <span className="text-[10px] font-black bg-neutral-100 dark:bg-black/50 text-neutral-500 dark:text-slate-400 px-2 py-0.5 rounded">
                        {scan.sentences.length} flagged
                      </span>
                    </span>
                    <span className="text-[11px] text-neutral-400 dark:text-slate-500">{showSentences ? 'Collapse' : 'Expand'}</span>
                  </button>

                  {showSentences && (
                    <div className="px-5 pb-5 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                      {scan.sentences.length > 0 ? (
                        scan.sentences.map((s) => (
                          <div
                            key={s.index}
                            className={`p-4 rounded-xl border text-[13px] transition-colors ${
                              s.negatives.length > 0 && !s.isNegated
                                ? 'bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-500/20'
                                : s.negatives.length > 0 && s.isNegated
                                ? 'bg-yellow-50/50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-500/20'
                                : 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-500/20'
                            }`}
                          >
                            <div className="flex flex-wrap gap-1.5 mb-2">
                              <span className="text-[10px] font-black uppercase tracking-widest text-neutral-400 dark:text-slate-500">
                                Sentence #{s.index + 1}
                              </span>
                              {s.isNegated && (
                                <span className="text-[10px] font-bold uppercase text-yellow-600 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-500/10 px-1.5 rounded">
                                  Negated Context
                                </span>
                              )}
                              {s.positives.map((p) => (
                                <span key={`p-${p}`} className="text-[10px] font-bold uppercase bg-cyan-100 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 px-1.5 rounded">
                                  +{p}
                                </span>
                              ))}
                              {s.negatives.map((n) => (
                                <span key={`n-${n}`} className="text-[10px] font-bold uppercase bg-rose-100 dark:bg-rose-500/10 text-rose-600 dark:text-rose-300 px-1.5 rounded">
                                  −{n}
                                </span>
                              ))}
                            </div>
                            <p className="text-neutral-700 dark:text-slate-300 leading-relaxed font-serif">
                              {getHighlightedText(s.text)}
                            </p>
                          </div>
                        ))
                      ) : (
                        <p className="text-[12px] text-neutral-400 dark:text-slate-500 italic px-1">
                          No sentence-level matches were found for the current criteria.
                        </p>
                      )}

                      {/* TIER 3 — WORD DRILL-DOWN (nested inside sentences) */}
                      <div className="mt-4 bg-neutral-50/60 dark:bg-black/30 border border-black/5 dark:border-white/10 rounded-xl overflow-hidden">
                        <button
                          onClick={() => setShowWords((v) => !v)}
                          className="w-full flex items-center justify-between p-4 hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors"
                        >
                          <span className="font-bold text-[12px] text-neutral-600 dark:text-slate-300 flex items-center gap-2 tracking-tight">
                            <span className="text-cyan-500 dark:text-cyan-300">▾</span> Review keyword evidence
                            <span className="text-[10px] font-black bg-white dark:bg-black/50 text-neutral-500 dark:text-slate-400 px-2 py-0.5 rounded border border-black/5 dark:border-white/10">
                              {scan.wordCounts.length} tokens
                            </span>
                          </span>
                          <span className="text-[11px] text-neutral-400 dark:text-slate-500">{showWords ? 'Collapse' : 'Expand'}</span>
                        </button>

                        {showWords && (
                          <div className="px-4 pb-4 space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                            {scan.wordCounts.length > 0 ? (
                              scan.wordCounts.map((w) => {
                                const max = Math.max(...scan.wordCounts.map((x) => x.count), 1);
                                const pct = Math.round((w.count / max) * 100);
                                return (
                                  <div key={`${w.polarity}-${w.word}`} className="flex items-center gap-3">
                                    <span
                                      className={`text-[11px] font-bold uppercase w-40 truncate ${
                                        w.polarity === 'positive'
                                          ? 'text-cyan-600 dark:text-cyan-300'
                                          : 'text-rose-500 dark:text-rose-400'
                                      }`}
                                    >
                                      {w.word}
                                    </span>
                                    <div className="flex-1 h-3 bg-neutral-200/60 dark:bg-white/5 rounded-full overflow-hidden">
                                      <div
                                        className={`h-full rounded-full transition-all ${
                                          w.polarity === 'positive' ? 'bg-cyan-500' : 'bg-rose-500'
                                        }`}
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                    <span className="text-[11px] font-black text-neutral-500 dark:text-slate-400 w-6 text-right">
                                      {w.count}
                                    </span>
                                  </div>
                                );
                              })
                            ) : (
                              <p className="text-[12px] text-neutral-400 dark:text-slate-500 italic">
                                No keyword tokens detected.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Full Context Viewer */}
                <div className="clay-soft p-5 rounded-2xl transition-all">
                  <h4 className="font-bold text-[13px] text-neutral-600 dark:text-slate-300 mb-3 flex justify-between items-center tracking-tight transition-colors">
                    Full Context Viewer
                    <span className="text-[9px] bg-neutral-100 dark:bg-black/50 px-2 py-1 rounded border border-black/5 dark:border-white/5 uppercase tracking-widest text-neutral-500 dark:text-slate-500">Telemetry Feed</span>
                  </h4>
                  <div className="text-[13px] text-neutral-700 dark:text-slate-300 leading-relaxed bg-neutral-50/50 dark:bg-black/40 p-4 rounded-xl overflow-y-auto font-serif border border-black/5 dark:border-black custom-scrollbar max-h-48 transition-colors">
                    {getHighlightedText(inputText)}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <MobileTabBar />
    </div>
  );
}
