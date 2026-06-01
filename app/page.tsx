'use client';

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import ThemeToggle from '../components/ThemeToggle';

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
    phase: 'INGEST',
    title: 'Load the abstract',
    copy: 'Paste a study abstract into the matrix. The scanner reads the full text before it starts narrowing the evidence.',
  },
  {
    index: '02',
    phase: 'SEGMENT',
    title: 'Split the evidence',
    copy: 'The matrix drops from abstract-level context into sentences, then down into candidate terms and recurring phrases.',
  },
  {
    index: '03',
    phase: 'CLASSIFY',
    title: 'Build the protocol',
    copy: 'Suggested keywords become inclusion or exclusion criteria. Your saved protocol drives the SRMA verdict.',
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
        // Re-run the matrix intro on back/forward (bfcache) restores.
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
      new RegExp(`\\b${word.replace(/\s+/g, '\\s+')}\\b`, 'gi');

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

    const regexPattern = allKeywords
      .map((kw) => kw.replace(/\s+/g, '\\s+'))
      .join('|');
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
      ? '🚩 EXCLUDE (Criteria Violation)'
      : decision === 'INCLUDE / MAYBE'
      ? '🟩 INCLUDE / MAYBE (Passes Screen)'
      : decision === 'NO_CRITERIA'
      ? '⚙ NO CRITERIA DEFINED'
      : '⚠️ MANUAL REVIEW REQUIRED';

  const introScene = INTRO_SCENES[introStep];
  const isLastIntroStep = introStep === INTRO_SCENES.length - 1;

  // Operator-dashboard derived values.
  const heroDateLabel = new Date()
    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    .toUpperCase();
  const totalCriteria = positiveKeywords.length + negativeKeywords.length;
  const protocolStatusLine =
    totalCriteria === 0
      ? 'Protocol uninitialized. Classify keywords below to deploy.'
      : `Tracking ${positiveKeywords.length} inclusion / ${negativeKeywords.length} exclusion criteria · Auto-saved.`;

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
    <div className="min-h-screen flex flex-col bg-[#FAFAFA] dark:bg-[#050505] text-neutral-900 dark:text-neutral-100 relative overflow-hidden font-sans selection:bg-[#00A598]/30 transition-colors duration-700">

      {/* CUSTOM ANIMATION STYLES */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes floatSlow {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-12px) rotate(-1deg); }
        }
        @keyframes floatFast {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-8px) rotate(2deg); }
        }
        .animate-float-slow { animation: floatSlow 6s ease-in-out infinite; }
        .animate-float-fast { animation: floatFast 4s ease-in-out infinite; }

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

        /* --- SRMA Matrix intro screen --- */
        @keyframes matrixCardIn {
          from { opacity: 0; transform: translateY(24px) scale(0.975); filter: blur(10px); }
          to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }
        @keyframes matrixPanelIn {
          from { opacity: 0; transform: translateY(18px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes matrixPulse {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.06); }
        }
        @keyframes matrixBeam {
          from { stroke-dashoffset: 360; }
          to { stroke-dashoffset: 0; }
        }
        @keyframes matrixGlow {
          0%, 100% { opacity: 0.55; filter: drop-shadow(0 0 6px rgba(0,165,152,0.25)); }
          50% { opacity: 1; filter: drop-shadow(0 0 18px rgba(0,165,152,0.55)); }
        }
        @keyframes matrixScanLine {
          from { transform: translateY(-16%); opacity: 0; }
          15%, 85% { opacity: 1; }
          to { transform: translateY(116%); opacity: 0; }
        }
        @keyframes progressIgnite {
          from { width: 0; opacity: 0.35; }
          to { width: 100%; opacity: 1; }
        }
        .matrix-card { animation: matrixCardIn 0.75s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .matrix-panel { animation: matrixPanelIn 0.55s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .matrix-pulse { animation: matrixPulse 1.8s ease-in-out infinite; }
        .matrix-beam { stroke-dasharray: 9 10; animation: matrixBeam 2.7s linear infinite; }
        .matrix-glow { animation: matrixGlow 2s ease-in-out infinite; }
        .matrix-scan-line { animation: matrixScanLine 2.9s cubic-bezier(0.5, 0, 0.2, 1) infinite; }
        .progress-ignite { animation: progressIgnite 0.55s cubic-bezier(0.22, 1, 0.36, 1) both; }

        /* --- Premium glass surface --- */
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
        /* Subtle top sheen highlight for the hero engine box */
        .glass-sheen::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 1px;
          background: linear-gradient(140deg, rgba(255,255,255,0.9), transparent 38%);
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          pointer-events: none;
          opacity: 0.7;
        }
        .dark .glass-sheen::before {
          background: linear-gradient(140deg, rgba(255,255,255,0.22), transparent 38%);
          opacity: 0.6;
        }

        /* --- Richer drifting atmosphere blobs --- */
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

        @media (prefers-reduced-motion: reduce) {
          .intro, .intro-atmosphere, .matrix-card, .matrix-panel, .progress-ignite {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
          }
          .matrix-pulse, .matrix-beam, .matrix-glow, .matrix-scan-line, .blob-a, .blob-b, .blob-c { animation: none !important; }
          .progress-ignite { width: 100% !important; }
        }
      `}} />

      {/* INTRO MATRIX SCREEN */}
      {introVisible && (
        <div
          key={`srma-matrix-${introTick}`}
          className={`fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[#FAFAFA] dark:bg-[#050505] transition-opacity duration-700 ${
            introLeaving ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
        >
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="blob-a absolute top-[-15%] right-[5%] w-[55%] h-[55%] bg-gradient-to-br from-blue-400/30 to-purple-400/25 dark:from-blue-600/25 dark:to-[#00A598]/15 rounded-full blur-[120px]"></div>
            <div className="blob-b absolute bottom-[-15%] left-[0%] w-[50%] h-[50%] bg-gradient-to-tr from-pink-400/25 to-teal-300/25 dark:from-purple-600/15 dark:to-teal-600/15 rounded-full blur-[120px]"></div>
            <div className="blob-c absolute top-1/2 left-1/2 w-[40%] h-[40%] bg-gradient-to-br from-[#00A598]/25 to-blue-300/20 dark:from-[#00A598]/15 dark:to-blue-500/10 rounded-full blur-[110px]"></div>
          </div>

          <div className="absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.045)_1px,transparent_1px)] dark:bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:86px_86px] opacity-80"></div>

          <button
            onClick={closeIntro}
            className="absolute right-4 top-4 sm:right-8 sm:top-7 z-20 rounded-full border border-black/10 dark:border-white/10 bg-white/50 dark:bg-white/5 px-4 py-2 text-[10px] sm:text-[11px] font-black uppercase tracking-[0.18em] text-neutral-500 dark:text-slate-300 backdrop-blur-xl transition-all hover:border-[#00A598]/50 hover:text-[#00A598] active:scale-95"
          >
            Skip Intro
          </button>

          <div className="matrix-card custom-scrollbar relative z-10 mx-4 max-h-[calc(100vh-28px)] w-full max-w-[980px] overflow-y-auto rounded-[28px] border border-white/55 bg-white/[0.72] p-4 shadow-[0_28px_90px_-40px_rgba(15,23,42,0.55)] backdrop-blur-3xl dark:border-white/10 dark:bg-[#090d10]/80 dark:shadow-[0_32px_100px_-42px_rgba(0,0,0,0.85)] sm:p-6 lg:p-8">
            <div className="text-center">
              <p className="mb-2 font-mono text-[10px] font-black uppercase tracking-[0.34em] text-[#00A598]">
                SRMA Matrix Console
              </p>
              <h2 className="text-[30px] font-black leading-none tracking-tighter text-neutral-950 dark:text-white sm:text-[46px] lg:text-[52px]">
                Abstract <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#00A598] via-blue-500 to-violet-500">Screening Matrix</span>
              </h2>
              <p className="mt-3 text-[13px] font-semibold text-neutral-500 dark:text-slate-400 sm:text-[15px]">
                Whole abstract. Sentence evidence. Keyword protocol.
              </p>
            </div>

            <div className="matrix-panel relative mt-5 overflow-hidden rounded-[22px] border border-black/10 bg-neutral-950/[0.035] p-3 shadow-inner dark:border-white/10 dark:bg-black/30 sm:p-5">
              <div className="absolute inset-0 bg-[linear-gradient(rgba(0,165,152,0.09)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.07)_1px,transparent_1px)] bg-[size:92px_70px]"></div>
              <div className="matrix-scan-line absolute left-0 right-0 h-16 bg-gradient-to-b from-transparent via-[#00A598]/16 to-transparent"></div>

              <svg
                viewBox="0 0 820 300"
                className="relative z-10 h-[185px] w-full sm:h-[220px] lg:h-[240px]"
                role="img"
                aria-label="SRMA matrix intro diagram"
              >
                <defs>
                  <linearGradient id="matrixPath" x1="0" x2="1" y1="0" y2="0">
                    <stop stopColor="#00A598" />
                    <stop offset="0.52" stopColor="#3B82F6" />
                    <stop offset="1" stopColor="#A855F7" />
                  </linearGradient>
                  <filter id="matrixShadow" x="-40%" y="-40%" width="180%" height="180%">
                    <feGaussianBlur stdDeviation="10" result="blur" />
                    <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0 0 0 0 0 0.65 0 0 0 0 0.60 0 0 0 0.45 0" />
                    <feMerge>
                      <feMergeNode />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                <path
                  d="M96 152 C 210 70, 310 82, 410 150 S 606 232, 724 120"
                  fill="none"
                  stroke="rgba(148,163,184,0.22)"
                  strokeWidth="6"
                  strokeLinecap="round"
                />
                <path
                  d="M96 152 C 210 70, 310 82, 410 150 S 606 232, 724 120"
                  fill="none"
                  stroke="url(#matrixPath)"
                  strokeWidth="6"
                  strokeLinecap="round"
                  className="matrix-beam"
                  style={{
                    opacity: introStep === 0 ? 0.85 : introStep === 1 ? 0.55 : 0.35,
                  }}
                />

                {introStep === 1 && (
                  <>
                    {[210, 335, 472, 610].map((x, i) => (
                      <g key={x} className="matrix-glow">
                        <rect x={x - 40} y={70 + i * 28} width="94" height="30" rx="12" fill="rgba(0,165,152,0.12)" stroke="rgba(0,165,152,0.45)" />
                        <text x={x + 7} y={90 + i * 28} textAnchor="middle" fill="currentColor" className="text-[12px] font-black text-[#00A598]">
                          SENT {i + 1}
                        </text>
                      </g>
                    ))}
                  </>
                )}

                {introStep === 2 && (
                  <>
                    <path d="M402 150 L402 244" stroke="rgba(0,165,152,0.45)" strokeWidth="2" strokeDasharray="6 7" />
                    <rect x="310" y="230" width="184" height="42" rx="18" fill="rgba(16,185,129,0.14)" stroke="rgba(16,185,129,0.45)" />
                    <text x="402" y="257" textAnchor="middle" fill="#34D399" className="text-[13px] font-black tracking-[0.12em]">
                      INCLUDE
                    </text>
                    <rect x="520" y="214" width="170" height="42" rx="18" fill="rgba(239,68,68,0.12)" stroke="rgba(239,68,68,0.42)" />
                    <text x="605" y="241" textAnchor="middle" fill="#F87171" className="text-[13px] font-black tracking-[0.12em]">
                      EXCLUDE
                    </text>
                  </>
                )}

                <g className="matrix-pulse" filter="url(#matrixShadow)">
                  <circle cx="96" cy="152" r="34" fill="rgba(0,165,152,0.16)" stroke="rgba(0,165,152,0.65)" strokeWidth="3" />
                  <circle cx="96" cy="152" r="13" fill="#00A598" />
                </g>
                <g filter="url(#matrixShadow)">
                  <circle cx="402" cy="150" r="34" fill="rgba(59,130,246,0.16)" stroke="rgba(59,130,246,0.62)" strokeWidth="3" />
                  <circle cx="402" cy="150" r="13" fill="#3B82F6" />
                </g>
                <g className={introStep === 2 ? 'matrix-pulse' : ''} filter="url(#matrixShadow)">
                  <circle cx="724" cy="120" r="34" fill="rgba(168,85,247,0.16)" stroke="rgba(168,85,247,0.62)" strokeWidth="3" />
                  <circle cx="724" cy="120" r="13" fill="#A855F7" />
                </g>

                <text x="96" y="217" textAnchor="middle" fill="currentColor" className="text-[14px] font-black tracking-[0.16em] text-neutral-500 dark:text-slate-500">
                  ABSTRACT
                </text>
                <text x="402" y="217" textAnchor="middle" fill="currentColor" className="text-[14px] font-black tracking-[0.16em] text-neutral-500 dark:text-slate-500">
                  SENTENCES
                </text>
                <text x="724" y="185" textAnchor="middle" fill="currentColor" className="text-[14px] font-black tracking-[0.16em] text-neutral-500 dark:text-slate-500">
                  KEYWORDS
                </text>
              </svg>
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
                    className="rounded-full border border-black/10 bg-white/40 px-6 py-3 text-[13px] font-black text-neutral-600 backdrop-blur-xl transition-all hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-35 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
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
                    className="rounded-full bg-gradient-to-r from-[#00A598] via-blue-500 to-violet-500 px-7 py-3 text-[13px] font-black text-white shadow-[0_10px_30px_-12px_rgba(0,165,152,0.75)] transition-all hover:translate-y-[-1px] hover:shadow-[0_16px_38px_-14px_rgba(59,130,246,0.85)] active:scale-95"
                  >
                    {isLastIntroStep ? 'Begin' : 'Next'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DAY/NIGHT ATMOSPHERE — richer 3-blob drift */}
      <div className="intro-atmosphere absolute inset-0 pointer-events-none z-0 overflow-hidden transition-opacity duration-1000">
        <div className="blob-a absolute top-[-12%] right-[6%] w-[60%] h-[60%] bg-gradient-to-br from-blue-400/25 to-purple-400/25 dark:from-blue-600/18 dark:to-[#00A598]/12 rounded-full blur-[130px] mix-blend-multiply dark:mix-blend-screen opacity-80 dark:opacity-70 transition-all duration-1000"></div>
        <div className="blob-b absolute bottom-[-12%] left-[2%] w-[52%] h-[52%] bg-gradient-to-tr from-pink-400/25 to-teal-300/25 dark:from-purple-600/14 dark:to-teal-600/14 rounded-full blur-[130px] mix-blend-multiply dark:mix-blend-screen opacity-80 dark:opacity-55 transition-all duration-1000"></div>
        <div className="blob-c absolute top-1/2 left-1/2 w-[46%] h-[46%] bg-gradient-to-br from-[#00A598]/22 to-blue-300/20 dark:from-[#00A598]/14 dark:to-blue-500/10 rounded-full blur-[120px] mix-blend-multiply dark:mix-blend-screen opacity-70 dark:opacity-50 transition-all duration-1000"></div>
      </div>

      {/* MINIMALIST HEADER */}
      <header className="intro intro-delay-1 h-[64px] lg:h-[72px] flex items-center justify-between px-4 lg:px-8 shrink-0 bg-white/60 dark:bg-black/40 backdrop-blur-2xl z-50 border-b border-black/5 dark:border-white/5 transition-colors duration-700">
        <div className="flex items-center gap-4 lg:gap-8">
          <Link href="/" className="font-black text-[18px] lg:text-[20px] tracking-tighter flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="w-7 h-7 bg-neutral-900 dark:bg-white text-white dark:text-black rounded-lg flex items-center justify-center text-[14px] transition-colors duration-700">V</div>
            <div className="flex items-baseline">
              <span>VESTRIPPN</span>
              <span className="text-blue-600 dark:text-blue-400 transition-colors duration-700">3.0</span>
            </div>
          </Link>
          <nav className="hidden sm:flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest">
            <span className="px-3 py-1.5 rounded-lg bg-[#00A598]/10 text-[#00A598] border border-[#00A598]/30">Scanner</span>
            <Link href="/research" className="px-3 py-1.5 rounded-lg text-neutral-500 dark:text-slate-400 hover:text-neutral-900 dark:hover:text-white transition-colors">Research</Link>
          </nav>
        </div>

        <div className="flex gap-4 lg:gap-6 items-center">
          <div className="hidden md:block font-medium text-[11px] tracking-tight text-neutral-400 dark:text-neutral-500 transition-colors duration-700">
             Covidence Bypass
          </div>
          <div className="h-4 w-[1px] bg-black/10 dark:bg-white/10 hidden md:block transition-colors duration-700"></div>
          <ThemeToggle />
        </div>
      </header>

      {/* MAIN WORKSPACE */}
      <main className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-5 lg:p-8 pb-32 lg:pb-8 relative z-10 transition-all duration-500">
        <div className="max-w-[1120px] mx-auto space-y-6 lg:space-y-8">

          {/* HERO SECTION — split: copy on the left, operator dashboard on the right */}
          <section className="grid grid-cols-1 lg:grid-cols-5 gap-6 lg:gap-10 items-center pt-6 sm:pt-8 pb-2 relative">

            {/* LEFT: hero copy + CTAs */}
            <div className="lg:col-span-3 flex flex-col gap-5 relative z-10">

              <div className="intro intro-delay-1 inline-flex items-center gap-2 self-start glass-soft rounded-full px-3 py-1.5 text-[10px] sm:text-[11px] font-black tracking-[0.25em] uppercase text-[#00A598]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#00A598] animate-pulse"></span>
                PICO Telemetry Engine
              </div>

              <h1 className="intro intro-delay-2 font-black tracking-tighter leading-[0.95] relative z-10">
                <div className="flex items-center gap-3 flex-wrap mb-3">
                  <span className="text-neutral-900 dark:text-white leading-none text-[24px] sm:text-[30px] lg:text-[36px]">
                    SRMA
                  </span>
                  <span className="text-transparent bg-clip-text bg-gradient-to-br from-neutral-900 to-neutral-500 dark:from-white dark:to-neutral-500 text-[24px] sm:text-[30px] lg:text-[36px]">
                    Abstract Telemetry
                  </span>
                </div>
                <div className="text-[34px] sm:text-[44px] lg:text-[54px] text-neutral-900 dark:text-white">
                  Screen literature at the pace of your{' '}
                  <span className="text-transparent bg-clip-text bg-gradient-to-br from-[#00A598] via-[#0098b8] to-blue-500">
                    protocol
                  </span>
                  .
                </div>
              </h1>

              <p className="intro intro-delay-3 max-w-xl text-[13px] sm:text-[14px] leading-relaxed text-neutral-600 dark:text-slate-400">
                A multi-source PICO engine that auto-extracts keywords from any pasted abstract,
                classifies hits at three tiers, and pulls live evidence from Europe PMC and OpenAlex —
                all in your browser, instantly.
              </p>

              <div className="intro intro-delay-4 flex flex-wrap items-center gap-3 pt-1">
                <button
                  onClick={focusScanner}
                  className="group inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-neutral-900 dark:bg-white text-white dark:text-black text-[11px] font-black uppercase tracking-[0.2em] hover:opacity-90 active:scale-95 transition-all shadow-[0_8px_30px_-8px_rgba(0,0,0,0.35)] dark:shadow-[0_8px_30px_-8px_rgba(255,255,255,0.25)]"
                >
                  Start Scanning
                </button>
                <Link
                  href="/research"
                  className="group inline-flex items-center gap-2 px-5 py-2.5 rounded-full glass-soft text-neutral-700 dark:text-slate-200 text-[11px] font-black uppercase tracking-[0.2em] hover:text-[#00A598] active:scale-95 transition-all"
                >
                  Research Hub
                  <span className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5">↗</span>
                </Link>
              </div>

              <ul className="intro intro-delay-4 flex flex-wrap gap-x-5 gap-y-1 mt-1 text-[10px] sm:text-[11px] font-black uppercase tracking-[0.25em] text-neutral-500 dark:text-slate-500">
                {['Auto-Extract', 'Multi-Source', 'Auto-Classify', 'PICO Protocol'].map((f) => (
                  <li key={f} className="flex items-center gap-1.5">
                    <span className="text-[#00A598]">•</span> {f}
                  </li>
                ))}
              </ul>
            </div>

            {/* RIGHT: operator dashboard info card */}
            <div className="intro intro-delay-3 lg:col-span-2 relative glass glass-sheen rounded-[24px] p-5 lg:p-6 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.25em] text-neutral-500 dark:text-slate-500">
                    Live Operations
                  </div>
                  <div className="text-[14px] font-bold text-neutral-900 dark:text-white">
                    Operator Dashboard
                  </div>
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md border border-[#00A598]/30 bg-[#00A598]/10 text-[#00A598]">
                  <span className="dark:hidden">DAY_CYCLE</span>
                  <span className="hidden dark:inline">NIGHT_CYCLE</span>
                </span>
              </div>

              {/* Inner protocol card */}
              <div className="glass-soft rounded-2xl p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[13px] font-bold text-neutral-900 dark:text-white">
                    <span className="text-base">🎯</span> Active Protocol
                  </div>
                  <time
                    suppressHydrationWarning
                    className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 dark:text-slate-500"
                  >
                    {heroDateLabel}
                  </time>
                </div>
                <div className="text-[12px] italic text-neutral-500 dark:text-slate-400 leading-relaxed">
                  {protocolStatusLine}
                </div>
                <button
                  onClick={focusScanner}
                  className="group flex items-center gap-2 px-3 py-2 rounded-lg bg-white/40 dark:bg-black/25 border border-black/5 dark:border-white/10 text-[12px] text-neutral-500 dark:text-slate-400 hover:text-neutral-800 dark:hover:text-white hover:border-[#00A598]/40 transition-all text-left"
                >
                  <span className="truncate">Deploy new abstract…</span>
                  <span className="ml-auto text-[#00A598] font-black group-hover:translate-x-0.5 transition-transform">＋</span>
                </button>
              </div>

              {/* Stat tiles */}
              <div className="grid grid-cols-3 gap-2">
                <div className="glass-soft rounded-xl p-3">
                  <div className="text-[9px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-500">
                    Sources
                  </div>
                  <div className="text-[18px] font-black text-neutral-900 dark:text-white mt-1 leading-none">2</div>
                </div>
                <div className="glass-soft rounded-xl p-3">
                  <div className="text-[9px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-500">
                    Mode
                  </div>
                  <div className="text-[14px] font-bold text-neutral-900 dark:text-white mt-1 leading-none">
                    <span className="dark:hidden">Day</span>
                    <span className="hidden dark:inline">Night</span>
                  </div>
                </div>
                <div className="glass-soft rounded-xl p-3">
                  <div className="text-[9px] font-black uppercase tracking-widest text-neutral-500 dark:text-slate-500">
                    Status
                  </div>
                  <div className="text-[14px] font-bold text-emerald-600 dark:text-emerald-400 mt-1 leading-none flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    Nominal
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* THE ENGINE (Bento Box Wrapper) */}
          <div id="engine" className="intro intro-delay-4 relative glass glass-sheen flex flex-col rounded-[24px] lg:rounded-[32px] p-5 lg:p-8 transition-all duration-700 scroll-mt-24">

            {/* Dynamic Protocol Editor Header */}
            <div className="flex justify-between items-center mb-6 px-1">
              <h2 className="font-bold text-[16px] tracking-tight flex items-center gap-2 text-neutral-900 dark:text-white transition-colors duration-700">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span> Input Stream
                <span className="text-[9px] font-black text-blue-600 dark:text-blue-400 border border-blue-600/30 dark:border-blue-400/30 bg-blue-50 dark:bg-blue-400/10 px-1.5 py-0.5 rounded ml-2 uppercase tracking-widest transition-colors hidden sm:inline-block">Auto-Extract</span>
              </h2>
              <button
                onClick={() => setIsEditingProtocol(!isEditingProtocol)}
                className={`px-3 py-1.5 text-[11px] font-bold rounded-lg border transition-all ${
                  isEditingProtocol
                    ? 'bg-[#00A598]/10 dark:bg-[#00A598]/20 text-[#00A598] border-[#00A598]/30 dark:border-[#00A598]/50'
                    : 'bg-white dark:bg-white/5 text-neutral-500 dark:text-slate-400 border-black/10 dark:border-white/10 hover:bg-neutral-50 dark:hover:bg-white/10 hover:text-neutral-800 dark:hover:text-white'
                }`}
              >
                {isEditingProtocol ? 'Close Editor' : '⚙ Manual Protocol'}
              </button>
            </div>

            {/* Protocol Editor Panel (manual fallback — starts empty) */}
            {isEditingProtocol && (
              <div className="mb-6 p-5 bg-white dark:bg-black/50 border border-black/5 dark:border-white/10 rounded-2xl shadow-sm dark:shadow-none animate-in fade-in slide-in-from-top-2 transition-colors duration-700">
                <h3 className="text-[13px] font-bold text-neutral-700 dark:text-white mb-4 border-b border-black/5 dark:border-white/10 pb-2 transition-colors">Manual Protocol Override</h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                  <div>
                    <label className="block text-[11px] font-bold text-emerald-600 dark:text-emerald-400 mb-2 uppercase tracking-wide transition-colors">
                      Inclusion Keywords (Comma Separated)
                    </label>
                    <textarea
                      className="w-full h-32 p-3 bg-neutral-50 dark:bg-white/5 text-neutral-700 dark:text-slate-300 font-mono text-[12px] border border-black/5 dark:border-white/10 rounded-xl focus:border-emerald-500 focus:outline-none custom-scrollbar transition-colors"
                      placeholder="Empty — populate from suggestions or type here"
                      value={posInput}
                      onChange={(e) => setPosInput(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-red-600 dark:text-red-400 mb-2 uppercase tracking-wide transition-colors">
                      Exclusion Keywords (Comma Separated)
                    </label>
                    <textarea
                      className="w-full h-32 p-3 bg-neutral-50 dark:bg-white/5 text-neutral-700 dark:text-slate-300 font-mono text-[12px] border border-black/5 dark:border-white/10 rounded-xl focus:border-red-500 focus:outline-none custom-scrollbar transition-colors"
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
                    className="px-4 py-2 text-[12px] font-bold text-neutral-500 dark:text-slate-400 hover:text-neutral-800 dark:hover:text-white transition-colors"
                  >
                    Clear All
                  </button>
                  <button
                    onClick={handleApplyProtocol}
                    className="px-5 py-2 bg-[#00A598] hover:bg-[#008f83] text-white text-[12px] font-bold rounded-lg transition-all shadow-sm dark:shadow-[0_0_10px_rgba(0,165,152,0.3)]"
                  >
                    Save Protocol
                  </button>
                </div>
              </div>
            )}

            {/* Input Form */}
            <div className="space-y-4">
              <textarea
                className="w-full h-48 p-5 bg-white/70 dark:bg-black/30 backdrop-blur-md border border-black/10 dark:border-white/10 rounded-2xl text-[13px] font-mono text-neutral-700 dark:text-slate-200 leading-relaxed focus:border-[#00A598] focus:ring-2 focus:ring-[#00A598]/25 focus:outline-none transition-all resize-none shadow-[inset_0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-none custom-scrollbar"
                placeholder="Paste the target abstract here — keywords are auto-extracted as you type..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
              />

              {/* AUTO-SUGGEST + CLASSIFICATION PANEL */}
              {!isEditingProtocol && inputText.trim().length > 0 && (
                <div className="glass-soft p-5 rounded-2xl transition-all space-y-5 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[13px] font-bold text-neutral-700 dark:text-white flex items-center gap-2 transition-colors">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#00A598]"></span>
                      Auto-Extracted Suggestions
                    </h3>
                    <span className="text-[9px] font-black text-[#00A598] border border-[#00A598]/30 bg-[#00A598]/10 px-1.5 py-0.5 rounded uppercase tracking-widest">
                      Tap ＋ to include · − to exclude
                    </span>
                  </div>

                  {suggestions.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {suggestions.map((word) => (
                        <span
                          key={word}
                          className="group inline-flex items-center gap-1 bg-neutral-50 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg pl-2.5 pr-1 py-1 text-[11px] font-semibold text-neutral-600 dark:text-slate-300 transition-colors"
                        >
                          <span className="truncate max-w-[180px]">{word}</span>
                          <button
                            onClick={() => classify(word, 'positive')}
                            title="Add to Inclusion"
                            className="w-5 h-5 flex items-center justify-center rounded-md text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 font-black transition-colors"
                          >
                            ＋
                          </button>
                          <button
                            onClick={() => classify(word, 'negative')}
                            title="Add to Exclusion"
                            className="w-5 h-5 flex items-center justify-center rounded-md text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 font-black transition-colors"
                          >
                            −
                          </button>
                          <button
                            onClick={() => dismissSuggestion(word)}
                            title="Dismiss"
                            className="w-5 h-5 flex items-center justify-center rounded-md text-neutral-400 dark:text-slate-500 hover:bg-neutral-200 dark:hover:bg-white/10 transition-colors"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[12px] text-neutral-400 dark:text-slate-500 italic">
                      No further candidates — all significant terms have been classified or dismissed.
                    </p>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2 border-t border-black/5 dark:border-white/10">
                    <div>
                      <h4 className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 mb-2 uppercase tracking-wide transition-colors">
                        Inclusion Criteria ({positiveKeywords.length})
                      </h4>
                      {positiveKeywords.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {positiveKeywords.map((word) => (
                            <span
                              key={word}
                              className="inline-flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/20 rounded-lg pl-2.5 pr-1.5 py-1 text-[11px] font-bold transition-colors"
                            >
                              {word}
                              <button
                                onClick={() => removeKeyword(word, 'positive')}
                                className="text-emerald-500/70 hover:text-emerald-700 dark:hover:text-emerald-200 transition-colors"
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
                      <h4 className="text-[11px] font-bold text-red-600 dark:text-red-400 mb-2 uppercase tracking-wide transition-colors">
                        Exclusion Criteria ({negativeKeywords.length})
                      </h4>
                      {negativeKeywords.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {negativeKeywords.map((word) => (
                            <span
                              key={word}
                              className="inline-flex items-center gap-1.5 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-500/20 rounded-lg pl-2.5 pr-1.5 py-1 text-[11px] font-bold transition-colors"
                            >
                              {word}
                              <button
                                onClick={() => removeKeyword(word, 'negative')}
                                className="text-red-500/70 hover:text-red-700 dark:hover:text-red-200 transition-colors"
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
                    <span className="w-1.5 h-1.5 rounded-full bg-[#00A598]"></span>
                    Protocol auto-saved to this browser
                  </p>
                </div>
              )}

              <div className="flex gap-4">
                <button
                  onClick={handleClear}
                  className="px-6 py-3.5 glass-soft hover:bg-white/90 dark:hover:bg-white/10 text-neutral-600 dark:text-slate-300 text-sm font-bold rounded-xl transition-all active:scale-95"
                >
                  Clear Cache
                </button>
                <button
                  onClick={handleScan}
                  disabled={!inputText.trim() || isEditingProtocol}
                  className="group relative flex-1 py-3.5 overflow-hidden bg-gradient-to-r from-[#00A598] via-[#00b3a5] to-[#0098b8] hover:from-[#009085] hover:to-[#0087a5] disabled:from-neutral-200 disabled:via-neutral-200 disabled:to-neutral-200 dark:disabled:from-white/5 dark:disabled:via-white/5 dark:disabled:to-white/5 disabled:text-neutral-400 dark:disabled:text-slate-500 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-all shadow-[0_6px_22px_-4px_rgba(0,165,152,0.5)] dark:shadow-[0_0_22px_rgba(0,165,152,0.35)] disabled:shadow-none active:scale-[0.98]"
                >
                  <span className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out bg-gradient-to-r from-transparent via-white/25 to-transparent disabled:hidden"></span>
                  <span className="relative">Execute Smart Scan</span>
                </button>
              </div>
            </div>

            {/* Results Dashboard — LAYERED DRILL-DOWN */}
            {isScanned && scan && (
              <div className="mt-8 pt-8 border-t border-black/5 dark:border-white/10 animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">

                {/* TIER 1 — ABSTRACT-LEVEL VERDICT */}
                <div className={`flex flex-col items-center justify-center p-6 rounded-2xl border transition-colors ${decisionBannerClass}`}>
                  <h1 className="text-2xl sm:text-3xl font-black tracking-tight flex items-center gap-3 text-center">
                    {decisionLabel}
                  </h1>
                  {decision === 'NO_CRITERIA' && (
                    <span className="text-[11px] font-mono text-yellow-600 dark:text-yellow-300/70 mt-3 block tracking-normal uppercase bg-yellow-100 dark:bg-black/20 px-3 py-1 rounded text-center">
                      Classify at least one suggested keyword above before scanning.
                    </span>
                  )}
                  {decision === 'UNCLEAR' && scan.negatives.some((n) => n.isNegated) && (
                    <span className="text-[11px] font-mono text-yellow-600 dark:text-yellow-300/70 mt-3 block tracking-normal uppercase bg-yellow-100 dark:bg-black/20 px-3 py-1 rounded text-center">
                      Heuristic Engine overrode exclusion because triggers were found in a negated sentence.
                    </span>
                  )}
                </div>

                {/* Abstract summary stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Inclusion Hits', value: scan.positives.length, accent: 'text-emerald-600 dark:text-emerald-400' },
                    { label: 'Exclusion Triggers', value: scan.negatives.length, accent: 'text-red-600 dark:text-red-400' },
                    { label: 'Sentences', value: scan.sentenceCount, accent: 'text-blue-600 dark:text-blue-400' },
                    { label: 'Words', value: scan.tokenCount, accent: 'text-neutral-600 dark:text-slate-300' },
                  ].map((stat) => (
                    <div key={stat.label} className="glass-soft p-4 rounded-xl text-center transition-all hover:-translate-y-0.5">
                      <div className={`text-2xl font-black ${stat.accent}`}>{stat.value}</div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 dark:text-slate-500 mt-1">{stat.label}</div>
                    </div>
                  ))}
                </div>

                {/* TIER 2 — SENTENCE DRILL-DOWN */}
                <div className="glass-soft rounded-2xl transition-all overflow-hidden">
                  <button
                    onClick={() => setShowSentences((v) => !v)}
                    className="w-full flex items-center justify-between p-5 hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors"
                  >
                    <span className="font-bold text-[13px] text-neutral-700 dark:text-slate-200 flex items-center gap-2 tracking-tight">
                      <span className="text-[#00A598]">▾</span> Drill down to Sentences
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
                                <span key={`p-${p}`} className="text-[10px] font-bold uppercase bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-1.5 rounded">
                                  +{p}
                                </span>
                              ))}
                              {s.negatives.map((n) => (
                                <span key={`n-${n}`} className="text-[10px] font-bold uppercase bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-300 px-1.5 rounded">
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
                          No sentences matched the active criteria.
                        </p>
                      )}

                      {/* TIER 3 — WORD DRILL-DOWN (nested inside sentences) */}
                      <div className="mt-4 bg-neutral-50/60 dark:bg-black/30 border border-black/5 dark:border-white/10 rounded-xl overflow-hidden">
                        <button
                          onClick={() => setShowWords((v) => !v)}
                          className="w-full flex items-center justify-between p-4 hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors"
                        >
                          <span className="font-bold text-[12px] text-neutral-600 dark:text-slate-300 flex items-center gap-2 tracking-tight">
                            <span className="text-[#00A598]">▾</span> Drill down to Words
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
                                          ? 'text-emerald-600 dark:text-emerald-400'
                                          : 'text-red-600 dark:text-red-400'
                                      }`}
                                    >
                                      {w.word}
                                    </span>
                                    <div className="flex-1 h-3 bg-neutral-200/60 dark:bg-white/5 rounded-full overflow-hidden">
                                      <div
                                        className={`h-full rounded-full transition-all ${
                                          w.polarity === 'positive' ? 'bg-emerald-500' : 'bg-red-500'
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
                <div className="glass-soft p-5 rounded-2xl transition-all">
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
    </div>
  );
}
