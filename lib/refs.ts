// Reference-file parsers for the screening library: RIS and PubMed MEDLINE
// (.nbib) formats — the two exports researchers most commonly have on hand.

import type { RecordBase } from './library';

const cleanDoi = (s: string): string =>
  s.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').trim();

// ---- RIS ----------------------------------------------------------------
// Tag lines look like `TY  - JOUR`; a record ends at `ER  -`.
export function parseRIS(text: string): RecordBase[] {
  const out: RecordBase[] = [];
  const lines = text.split(/\r?\n/);
  let cur: {
    title?: string;
    authors: string[];
    year?: string;
    doi?: string;
    pmid?: string;
    url?: string;
    inRecord: boolean;
  } = { authors: [], inRecord: false };

  const flush = () => {
    if (cur.inRecord && (cur.title || cur.doi || cur.pmid)) {
      out.push({
        id: '',
        title: cur.title ?? '',
        authors: cur.authors.slice(0, 8).join(', ') || undefined,
        year: cur.year,
        doi: cur.doi,
        pmid: cur.pmid,
        url: cur.doi ? `https://doi.org/${cur.doi}` : cur.url,
        source: 'RIS import',
      });
    }
    cur = { authors: [], inRecord: false };
  };

  for (const raw of lines) {
    const m = raw.match(/^([A-Z][A-Z0-9])\s{2}-\s?(.*)$/);
    if (!m) continue;
    const tag = m[1];
    const val = m[2].trim();
    switch (tag) {
      case 'TY':
        flush();
        cur.inRecord = true;
        break;
      case 'TI':
      case 'T1':
        cur.title = (cur.title ? cur.title + ' ' : '') + val;
        break;
      case 'AU':
      case 'A1':
        if (val) cur.authors.push(val);
        break;
      case 'PY':
      case 'Y1':
        cur.year = (val.match(/\d{4}/) || [val])[0];
        break;
      case 'DO':
        cur.doi = cleanDoi(val);
        break;
      case 'UR':
        if (!cur.url) cur.url = val;
        break;
      case 'ER':
        flush();
        break;
      default:
        // PMID sometimes travels in a generic tag (ID / AN / M1).
        if (['ID', 'AN', 'M1'].includes(tag) && /^\d{5,9}$/.test(val))
          cur.pmid = val;
        break;
    }
  }
  flush();
  return out;
}

// ---- PubMed MEDLINE / .nbib --------------------------------------------
// Tags like `PMID- 12345`; continuation lines are indented. `AID` / `LID`
// may carry the DOI (`10.xxx [doi]`). Records are blank-line separated.
export function parsePubMed(text: string): RecordBase[] {
  const out: RecordBase[] = [];
  const blocks = text.split(/\r?\n\r?\n+/);
  for (const block of blocks) {
    if (!/^PMID-/m.test(block) && !/^TI\s*-/m.test(block)) continue;
    // Fold continuation lines (leading whitespace) into the previous tag.
    const folded: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (/^\s{4,}\S/.test(line) && folded.length) {
        folded[folded.length - 1] += ' ' + line.trim();
      } else {
        folded.push(line);
      }
    }
    const rec: {
      title?: string;
      authors: string[];
      year?: string;
      doi?: string;
      pmid?: string;
    } = { authors: [] };
    for (const line of folded) {
      const m = line.match(/^([A-Z]{2,4})\s*-\s?(.*)$/);
      if (!m) continue;
      const tag = m[1];
      const val = m[2].trim();
      switch (tag) {
        case 'PMID':
          rec.pmid = val;
          break;
        case 'TI':
          rec.title = (rec.title ? rec.title + ' ' : '') + val;
          break;
        case 'FAU':
        case 'AU':
          if (val && rec.authors.length < 8 && tag === 'AU') rec.authors.push(val);
          break;
        case 'DP':
          rec.year = (val.match(/\d{4}/) || [])[0];
          break;
        case 'AID':
        case 'LID':
          if (/\[doi\]/i.test(val)) rec.doi = cleanDoi(val.replace(/\s*\[doi\]/i, ''));
          break;
        default:
          break;
      }
    }
    if (rec.title || rec.pmid || rec.doi) {
      out.push({
        id: '',
        title: rec.title ?? '',
        authors: rec.authors.join(', ') || undefined,
        year: rec.year,
        doi: rec.doi,
        pmid: rec.pmid,
        url: rec.doi
          ? `https://doi.org/${rec.doi}`
          : rec.pmid
          ? `https://pubmed.ncbi.nlm.nih.gov/${rec.pmid}/`
          : undefined,
        source: 'PubMed import',
      });
    }
  }
  return out;
}

// Auto-detect format and parse. RIS starts records with `TY  - `; PubMed uses
// `PMID-` / two-to-four-letter tags.
export function parseReferences(text: string): RecordBase[] {
  const t = text.trim();
  if (!t) return [];
  if (/^TY\s{2}-/m.test(t) || /\nER\s{2}-/m.test(t)) return parseRIS(t);
  if (/^PMID\s*-/m.test(t) || /^TI\s*-/m.test(t)) return parsePubMed(t);
  // Fall back to RIS (more permissive tag shape).
  return parseRIS(t);
}
