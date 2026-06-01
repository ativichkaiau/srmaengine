// Shared PICO classification — used by /research to auto-classify fetched
// abstracts against the same protocol the scanner page builds.

export type Verdict = 'EXCLUDE' | 'INCLUDE / MAYBE' | 'UNCLEAR' | 'NO_CRITERIA';

export type Classification = {
  verdict: Verdict;
  positives: string[];        // distinct positive keywords matched anywhere
  negatives: string[];        // matched in a non-negated sentence (hard fail)
  negatedNegatives: string[]; // matched but inside a negation context
  score: number;              // ranking helper: positives - 2 * negatives
};

const NEGATION_TRIGGERS = [
  'exclud',
  'without',
  'no ',
  'exception',
  'ruled out',
  'history of',
  'omitted',
];

const buildRegex = (word: string) =>
  new RegExp(`\\b${word.replace(/\s+/g, '\\s+')}\\b`, 'gi');

const isSentenceNegated = (sentence: string) => {
  const lower = sentence.toLowerCase();
  return NEGATION_TRIGGERS.some((t) => lower.includes(t));
};

export function classifyAbstract(
  text: string,
  positive: string[],
  negative: string[]
): Classification {
  const empty: Classification = {
    verdict: 'NO_CRITERIA',
    positives: [],
    negatives: [],
    negatedNegatives: [],
    score: 0,
  };
  if (positive.length === 0 && negative.length === 0) return empty;
  if (!text || !text.trim()) {
    return {
      verdict: 'UNCLEAR',
      positives: [],
      negatives: [],
      negatedNegatives: [],
      score: 0,
    };
  }

  const normalized = text.replace(/\s+/g, ' ').trim();
  const sentences = normalized.match(/[^.!?]+[.!?]+/g) || [normalized];

  const pos = new Set<string>();
  const hardNeg = new Set<string>();
  const negNeg = new Set<string>();

  for (const sentence of sentences) {
    const negCtx = isSentenceNegated(sentence);
    for (const w of positive) {
      if (buildRegex(w).test(sentence)) pos.add(w);
    }
    for (const w of negative) {
      if (buildRegex(w).test(sentence)) {
        (negCtx ? negNeg : hardNeg).add(w);
      }
    }
  }

  let verdict: Verdict;
  if (hardNeg.size > 0) verdict = 'EXCLUDE';
  else if (negNeg.size > 0) verdict = 'UNCLEAR';
  else if (pos.size > 0) verdict = 'INCLUDE / MAYBE';
  else verdict = 'UNCLEAR';

  return {
    verdict,
    positives: [...pos],
    negatives: [...hardNeg],
    negatedNegatives: [...negNeg],
    score: pos.size - hardNeg.size * 2,
  };
}

// Storage helper — same key the scanner page writes to.
const STORE_KEY = 'srma-protocol-v1';

export type StoredProtocol = {
  positive: string[];
  negative: string[];
  dismissed: string[];
};

export function loadProtocol(): StoredProtocol {
  const empty: StoredProtocol = { positive: [], negative: [], dismissed: [] };
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
