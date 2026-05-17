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
      if (e.persisted) replay();
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

        @media (prefers-reduced-motion: reduce) {
          .intro, .intro-atmosphere {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
          }
        }
      `}} />

      {/* DAY/NIGHT ATMOSPHERE */}
      <div className="intro-atmosphere absolute inset-0 pointer-events-none z-0 overflow-hidden transition-opacity duration-1000">
        <div className="absolute top-[-10%] right-[10%] w-[60%] h-[60%] bg-gradient-to-br from-blue-400/20 to-purple-400/20 dark:from-blue-600/15 dark:to-[#00A598]/10 rounded-full blur-[120px] mix-blend-multiply dark:mix-blend-screen opacity-70 dark:opacity-60 transition-all duration-1000"></div>
        <div className="absolute bottom-[-10%] left-[5%] w-[50%] h-[50%] bg-gradient-to-tr from-pink-400/20 to-teal-300/20 dark:from-purple-600/10 dark:to-teal-600/10 rounded-full blur-[120px] mix-blend-multiply dark:mix-blend-screen opacity-70 dark:opacity-50 transition-all duration-1000"></div>
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
        </div>

        <div className="flex gap-4 lg:gap-6 items-center">
          <div className="hidden sm:block font-medium text-[11px] tracking-tight text-neutral-400 dark:text-neutral-500 transition-colors duration-700">
             Covidence Bypass
          </div>
          <div className="h-4 w-[1px] bg-black/10 dark:bg-white/10 hidden sm:block transition-colors duration-700"></div>
          <ThemeToggle />
        </div>
      </header>

      {/* MAIN WORKSPACE */}
      <main className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-5 lg:p-8 pb-32 lg:pb-8 relative z-10 transition-all duration-500">
        <div className="max-w-[1000px] mx-auto space-y-6 lg:space-y-8">

          {/* HERO SECTION */}
          <section className="flex flex-col items-center justify-center text-center pt-8 sm:pt-10 pb-4 relative">

            <div className="absolute left-[5%] top-2 hidden lg:flex items-center gap-2 bg-white/90 dark:bg-white/5 backdrop-blur-md px-4 py-2 rounded-full shadow-sm dark:shadow-none border border-black/5 dark:border-white/10 transition-colors duration-700 animate-float-slow">
              <span className="text-sm">🔬</span>
              <span className="text-[11px] font-bold tracking-tight text-neutral-700 dark:text-neutral-200">Data Extraction</span>
            </div>

            <div className="absolute right-[5%] bottom-2 hidden lg:flex items-center gap-2 bg-white/90 dark:bg-white/5 backdrop-blur-md px-4 py-2 rounded-full shadow-sm dark:shadow-none border border-black/5 dark:border-white/10 transition-colors duration-700 animate-float-fast">
              <span className="text-sm">⚡</span>
              <span className="text-[11px] font-bold tracking-tight text-[#00A598]">Engine Nominal</span>
            </div>

            <h1 className="intro intro-delay-2 font-black tracking-tighter leading-none mb-4 flex flex-col items-center justify-center gap-2 sm:gap-3 xl:gap-4 relative z-10">
              <div className="flex items-center gap-3 text-[24px] sm:text-[32px] lg:text-[40px]">
                <span className="italic text-white dark:text-black bg-neutral-900 dark:bg-white px-3 py-1.5 rounded-[12px] shadow-sm border border-black/5 dark:border-white/5 leading-none transition-colors duration-700">
                  ///SRMA
                </span>
                <span className="text-transparent bg-clip-text bg-gradient-to-br from-neutral-900 to-neutral-500 dark:from-white dark:to-neutral-500 transition-colors duration-700">
                  Abstract Telemetry
                </span>
              </div>
            </h1>

            <p className="intro intro-delay-3 max-w-2xl font-mono text-[10px] sm:text-[11px] text-neutral-500 dark:text-neutral-400 uppercase tracking-[0.3em] leading-relaxed px-4 relative z-10 transition-colors duration-700">
              <span className="dark:hidden">DAY_CYCLE</span><span className="hidden dark:inline">NIGHT_CYCLE</span> // <span className="text-[#00A598] font-bold">AUTO-EXTRACT ENGAGED</span>
            </p>
          </section>

          {/* THE ENGINE (Bento Box Wrapper) */}
          <div className="intro intro-delay-4 flex flex-col rounded-[24px] lg:rounded-[32px] bg-white/60 dark:bg-white/5 backdrop-blur-xl border border-black/5 dark:border-white/5 p-5 lg:p-8 shadow-[0_4px_30px_rgb(0,0,0,0.04)] transition-all duration-700">

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
                className="w-full h-48 p-5 bg-white dark:bg-black/40 border border-black/10 dark:border-white/10 rounded-2xl text-[13px] font-mono text-neutral-700 dark:text-slate-200 leading-relaxed focus:border-[#00A598] focus:ring-2 focus:ring-[#00A598]/20 focus:outline-none transition-colors resize-none shadow-inner dark:shadow-none custom-scrollbar"
                placeholder="Paste the target abstract here — keywords are auto-extracted as you type..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
              />

              {/* AUTO-SUGGEST + CLASSIFICATION PANEL */}
              {!isEditingProtocol && inputText.trim().length > 0 && (
                <div className="p-5 bg-white dark:bg-black/40 border border-black/5 dark:border-white/10 rounded-2xl shadow-sm dark:shadow-none transition-colors space-y-5">
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
                  className="px-6 py-3.5 bg-white dark:bg-white/5 hover:bg-neutral-50 dark:hover:bg-white/10 text-neutral-600 dark:text-slate-300 text-sm font-bold rounded-xl transition-colors border border-black/10 dark:border-white/10 active:scale-95 shadow-sm dark:shadow-none"
                >
                  Clear Cache
                </button>
                <button
                  onClick={handleScan}
                  disabled={!inputText.trim() || isEditingProtocol}
                  className="flex-1 py-3.5 bg-[#00A598] hover:bg-[#009085] disabled:bg-neutral-200 dark:disabled:bg-white/5 disabled:text-neutral-400 dark:disabled:text-slate-500 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-all shadow-[0_4px_15px_rgba(0,165,152,0.3)] dark:shadow-[0_0_15px_rgba(0,165,152,0.3)] disabled:shadow-none active:scale-95"
                >
                  Execute Smart Scan
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
                    <div key={stat.label} className="p-4 bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-xl text-center shadow-sm dark:shadow-none transition-colors">
                      <div className={`text-2xl font-black ${stat.accent}`}>{stat.value}</div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 dark:text-slate-500 mt-1">{stat.label}</div>
                    </div>
                  ))}
                </div>

                {/* TIER 2 — SENTENCE DRILL-DOWN */}
                <div className="bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-2xl shadow-sm dark:shadow-none transition-colors overflow-hidden">
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
                <div className="p-5 bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-2xl shadow-sm dark:shadow-none transition-colors">
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
