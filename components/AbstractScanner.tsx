'use client'; 

import React, { useState } from 'react';

// Define the shape of our smart context objects
type SmartMatch = {
  word: string;
  sentence: string;
  isNegated: boolean; // True if the word appears near "excluded", "without", etc.
};

export default function AbstractScanner() {
  const [inputText, setInputText] = useState('');
  const [decision, setDecision] = useState<string | null>(null);
  
  // Upgraded state to hold smart matches
  const [smartPositives, setSmartPositives] = useState<SmartMatch[]>([]);
  const [smartNegatives, setSmartNegatives] = useState<SmartMatch[]>([]);
  
  const [isEditingProtocol, setIsEditingProtocol] = useState(false);
  
  const defaultPositives = [
    'vaginal', 'intravaginal', 'local', 'topical', 
    'cream', 'creams', 'pessary', 'pessaries', 'ring', 'rings', 'tablet', 'tablets', 
    'postmenopausal', 'post-menopausal', 'recurrent', 'ruti', 'rutis', 
    'estrogen', 'estrogens', 'oestrogen', 'oestrogens', 
    'estradiol', 'oestradiol', 'estriol', 'oestriol'
  ];

  const defaultNegatives = [
    'oral', 'transdermal', 'patch', 'patches', 
    'diabetes', 'diabetic', 'dm', 
    'catheter', 'catheters', 'prolapse', 
    'animal', 'animals', 'rat', 'rats', 'mouse', 'mice', 'murine', 
    'in vitro', 'in-vitro', 
    'men', 'male', 'males', 'pediatric', 'children', 
    'review', 'meta-analysis', 'meta analysis', 
    'antibiotic', 'antibiotics', 'prophylactic'
  ];

  // Heuristic Negation Dictionary (Words that mean the study intentionally removed the exclusion criteria)
  const negationTriggers = [
    'exclud', 'without', 'no ', 'exception', 'ruled out', 'history of', 'omitted'
  ];

  const [positiveKeywords, setPositiveKeywords] = useState<string[]>(defaultPositives);
  const [negativeKeywords, setNegativeKeywords] = useState<string[]>(defaultNegatives);
  
  const [posInput, setPosInput] = useState(defaultPositives.join(', '));
  const [negInput, setNegInput] = useState(defaultNegatives.join(', '));

  const handleApplyProtocol = () => {
    const parseKeywords = (raw: string) => 
      raw.split(',')
         .map(w => w.trim().toLowerCase()) 
         .filter(w => w.length > 0); 

    setPositiveKeywords(parseKeywords(posInput));
    setNegativeKeywords(parseKeywords(negInput));
    setIsEditingProtocol(false);
    setDecision(null); 
  };

  // --- THE SMART ENGINE LOGIC ---
  const handleScan = () => {
    if (!inputText.trim()) return;

    // 1. Normalize and split text into sentences for context boundary analysis
    const normalizedText = inputText.replace(/\s+/g, ' ');
    const sentences = normalizedText.match(/[^.!?]+[.!?]+/g) || [normalizedText];

    const currentPositives: Map<string, SmartMatch> = new Map();
    const currentNegatives: Map<string, SmartMatch> = new Map();

    // Helper: Check if a sentence contains negation intent
    const isSentenceNegated = (sentence: string) => {
      const lowerSentence = sentence.toLowerCase();
      return negationTriggers.some(trigger => lowerSentence.includes(trigger));
    };

    // 2. Scan sentence by sentence
    sentences.forEach(sentence => {
      const isNegatedContext = isSentenceNegated(sentence);

      // Check Positives
      positiveKeywords.forEach(word => {
        const safeWord = word.replace(/\s+/g, '\\s+');
        const regex = new RegExp(`\\b${safeWord}\\b`, 'gi');
        if (regex.test(sentence) && !currentPositives.has(word)) {
          currentPositives.set(word, { word, sentence: sentence.trim(), isNegated: false });
        }
      });

      // Check Negatives
      negativeKeywords.forEach(word => {
        const safeWord = word.replace(/\s+/g, '\\s+');
        const regex = new RegExp(`\\b${safeWord}\\b`, 'gi');
        if (regex.test(sentence) && !currentNegatives.has(word)) {
          currentNegatives.set(word, { word, sentence: sentence.trim(), isNegated: isNegatedContext });
        }
      });
    });

    const posArray = Array.from(currentPositives.values());
    const negArray = Array.from(currentNegatives.values());

    setSmartPositives(posArray);
    setSmartNegatives(negArray);

    // 3. Smart Decision Logic
    const hardExclusions = negArray.filter(n => !n.isNegated).length;
    const negatedExclusions = negArray.filter(n => n.isNegated).length;

    if (hardExclusions > 0) {
      setDecision('EXCLUDE');
    } else if (negatedExclusions > 0) {
      // It found exclusion words, but they were all inside sentences like "We excluded diabetics"
      setDecision('UNCLEAR'); 
    } else if (posArray.length > 0) {
      setDecision('INCLUDE / MAYBE');
    } else {
      setDecision('UNCLEAR');
    }
  };

  const getHighlightedText = () => {
    if (!inputText) return null;
    const allKeywords = [...positiveKeywords, ...negativeKeywords].sort((a, b) => b.length - a.length); 
    if (allKeywords.length === 0) return inputText;

    const regexPattern = allKeywords.map(kw => kw.replace(/\s+/g, '\\s+')).join('|');
    const regex = new RegExp(`\\b(${regexPattern})\\b`, 'gi');
    
    const parts = inputText.split(regex);

    return parts.map((part, i) => {
      if (!part) return null;
      const lowerPart = part.toLowerCase().replace(/\s+/g, ' ');
      
      if (positiveKeywords.includes(lowerPart)) {
        return <span key={i} className="bg-emerald-500/20 text-emerald-400 font-bold px-1 rounded border border-emerald-500/30">{part}</span>;
      } else if (negativeKeywords.includes(lowerPart)) {
        // Find if this specific word hit is in a negated context to color it yellow instead of red
        const isNegated = smartNegatives.some(n => n.word === lowerPart && n.isNegated);
        if (isNegated) {
          return <span key={i} className="bg-yellow-500/20 text-yellow-400 font-bold px-1 rounded border border-yellow-500/30 cursor-help" title="Context implies this exclusion was controlled for.">{part}</span>;
        }
        return <span key={i} className="bg-red-500/20 text-red-400 font-bold px-1 rounded border border-red-500/30">{part}</span>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="max-w-5xl mx-auto p-6 bg-[#0A0A0A] text-slate-200 rounded-2xl shadow-2xl border border-white/10">
      
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-2xl font-black mb-1 text-white flex items-center gap-2">
            <span className="text-[#00A598]">///</span> Abstract Telemetry
          </h2>
          <p className="text-xs font-mono text-slate-500 uppercase tracking-widest">
            Adaptive PICO Scanner <span className="text-blue-400 border border-blue-400/30 bg-blue-400/10 px-1 rounded ml-1">SMART CONTEXT ENABLED</span>
          </p>
        </div>
        <button 
          onClick={() => setIsEditingProtocol(!isEditingProtocol)}
          className={`px-4 py-2 text-xs font-bold rounded-lg border transition-all ${
            isEditingProtocol 
            ? 'bg-[#00A598]/20 text-[#00A598] border-[#00A598]/50' 
            : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10 hover:text-white'
          }`}
        >
          {isEditingProtocol ? 'Close Protocol Settings' : '⚙ Configure Dictionary'}
        </button>
      </div>

      {isEditingProtocol && (
        <div className="mb-8 p-5 bg-black/50 border border-white/10 rounded-xl animate-in fade-in slide-in-from-top-2">
          <h3 className="text-sm font-bold text-white mb-4 border-b border-white/10 pb-2">Protocol Configuration Parameters</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
            <div>
              <label className="block text-xs font-bold text-emerald-400 mb-2 uppercase tracking-wide">
                Inclusion Keywords (Comma Separated)
              </label>
              <textarea
                className="w-full h-32 p-3 bg-white/5 text-slate-300 font-mono text-xs border border-white/10 rounded-lg focus:border-emerald-500 focus:outline-none custom-scrollbar"
                value={posInput}
                onChange={(e) => setPosInput(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-red-400 mb-2 uppercase tracking-wide">
                Exclusion Keywords (Comma Separated)
              </label>
              <textarea
                className="w-full h-32 p-3 bg-white/5 text-slate-300 font-mono text-xs border border-white/10 rounded-lg focus:border-red-500 focus:outline-none custom-scrollbar"
                value={negInput}
                onChange={(e) => setNegInput(e.target.value)}
              />
            </div>
          </div>
          
          <div className="flex justify-end gap-3">
            <button 
              onClick={() => {
                setPosInput(defaultPositives.join(', '));
                setNegInput(defaultNegatives.join(', '));
              }}
              className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-white transition-colors"
            >
              Reset to Defaults
            </button>
            <button 
              onClick={handleApplyProtocol}
              className="px-6 py-2 bg-[#00A598] hover:bg-[#008f83] text-white text-xs font-bold rounded-lg transition-all shadow-[0_0_10px_rgba(0,165,152,0.3)]"
            >
              Apply Protocol Updates
            </button>
          </div>
        </div>
      )}

      <textarea
        className="w-full h-48 p-5 mb-4 bg-white/5 text-slate-200 font-mono text-sm border border-white/10 rounded-xl focus:border-[#00A598] focus:ring-1 focus:ring-[#00A598] focus:outline-none transition-all resize-none custom-scrollbar"
        placeholder="Paste abstract text here..."
        value={inputText}
        onChange={(e) => setInputText(e.target.value)}
      />

      <div className="flex gap-4 mb-8">
        <button
          onClick={() => { setInputText(''); setDecision(null); }}
          className="px-6 py-3 bg-white/5 hover:bg-white/10 text-white font-bold rounded-xl transition-colors border border-white/10"
        >
          Clear
        </button>
        <button
          onClick={handleScan}
          disabled={!inputText.trim() || isEditingProtocol}
          className="flex-1 py-3 bg-[#00A598] hover:bg-[#008f83] disabled:bg-white/5 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all shadow-[0_0_15px_rgba(0,165,152,0.3)]"
        >
          Execute Smart Scan
        </button>
      </div>

      {decision && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6 border-t border-white/10 pt-6">
          
          <div className={`p-6 rounded-xl font-black tracking-tight text-2xl md:text-3xl border-2 flex flex-col justify-center items-center text-center ${
            decision === 'EXCLUDE' ? 'bg-red-950/30 text-red-500 border-red-500/50 shadow-[0_0_20px_rgba(239,68,68,0.15)]' :
            decision === 'INCLUDE / MAYBE' ? 'bg-emerald-950/30 text-emerald-400 border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.15)]' :
            'bg-yellow-950/30 text-yellow-500 border-yellow-500/50 shadow-[0_0_20px_rgba(234,179,8,0.15)]'
          }`}>
            {decision === 'EXCLUDE' ? '🚩 EXCLUDE (Criteria Violation)' : 
             decision === 'INCLUDE / MAYBE' ? '🟩 INCLUDE / MAYBE (Passes Screen)' : 
             '⚠️ MANUAL REVIEW (Context Override)'}
             
             {decision === 'UNCLEAR' && smartNegatives.some(n => n.isNegated) && (
               <span className="text-xs font-mono text-yellow-300/70 mt-2 block tracking-normal uppercase">
                 Heuristic Engine overrode exclusion because triggers were found in a negated sentence.
               </span>
             )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* SMARTER KEYWORDS PANEL */}
            <div className="md:col-span-1 space-y-4">
              <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
                <h4 className="font-bold text-sm text-emerald-400 mb-3 flex justify-between">
                  Inclusion Hits <span className="bg-emerald-900/50 px-2 py-0.5 rounded text-xs">{smartPositives.length}</span>
                </h4>
                {smartPositives.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {smartPositives.map((match, i) => <span key={i} className="text-xs uppercase bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 px-2 py-1 rounded">{match.word}</span>)}
                  </div>
                ) : <p className="text-xs text-slate-500">None detected.</p>}
              </div>

              <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
                <h4 className="font-bold text-sm text-red-400 mb-3 flex justify-between">
                  Exclusion Triggers <span className="bg-red-900/50 px-2 py-0.5 rounded text-xs">{smartNegatives.length}</span>
                </h4>
                {smartNegatives.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {smartNegatives.map((match, i) => (
                      <div key={i} className={`text-xs p-2 rounded border ${match.isNegated ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-red-500/10 border-red-500/20'}`}>
                        <span className={`font-bold uppercase ${match.isNegated ? 'text-yellow-400' : 'text-red-300'}`}>{match.word}</span>
                        {match.isNegated && <span className="ml-2 italic text-[10px] text-yellow-500/70">Context Overridden</span>}
                      </div>
                    ))}
                  </div>
                ) : <p className="text-xs text-slate-500">None detected.</p>}
              </div>
            </div>

            {/* UPGRADED CONTEXT VIEWER */}
            <div className="md:col-span-2 p-5 bg-white/5 border border-white/10 rounded-xl flex flex-col">
               <h4 className="font-bold text-sm text-slate-300 mb-3 flex justify-between items-center">
                 Sentence Isolation
                 <span className="text-[10px] bg-black/50 px-2 py-1 rounded border border-white/5 uppercase tracking-wider text-slate-500">Telemetry Feed</span>
               </h4>
               
               {/* Smart Isolation Cards */}
               <div className="flex flex-col gap-3 mb-4">
                 {smartNegatives.map((match, i) => (
                   <div key={i} className={`p-3 rounded-lg border text-sm ${match.isNegated ? 'bg-yellow-950/20 border-yellow-500/20' : 'bg-red-950/20 border-red-500/20'}`}>
                     <div className="text-xs font-bold mb-1 opacity-70 flex items-center gap-2">
                       {match.isNegated ? '⚠️ OVERRIDDEN TRIGGER:' : '🚩 HARD EXCLUSION:'} <span className="uppercase tracking-widest">{match.word}</span>
                     </div>
                     <span className="italic text-slate-400">"...{match.sentence}..."</span>
                   </div>
                 ))}
               </div>

               <h4 className="font-bold text-sm text-slate-300 mb-3 mt-2">Full Context Viewer</h4>
               <div className="text-sm text-slate-300 leading-relaxed bg-black/40 p-4 rounded-lg flex-1 overflow-y-auto font-serif border border-black custom-scrollbar max-h-48">
                  {getHighlightedText()}
               </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}