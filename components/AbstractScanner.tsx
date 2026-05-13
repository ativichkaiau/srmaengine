'use client'; 

import React, { useState } from 'react';

export default function AbstractScanner() {
  const [inputText, setInputText] = useState('');
  const [decision, setDecision] = useState<string | null>(null);
  const [foundPositives, setFoundPositives] = useState<string[]>([]);
  const [foundNegatives, setFoundNegatives] = useState<string[]>([]);
  
  // NEW: Dynamic Configuration State
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

  const [positiveKeywords, setPositiveKeywords] = useState<string[]>(defaultPositives);
  const [negativeKeywords, setNegativeKeywords] = useState<string[]>(defaultNegatives);
  
  // Input states for the edit forms
  const [posInput, setPosInput] = useState(defaultPositives.join(', '));
  const [negInput, setNegInput] = useState(defaultNegatives.join(', '));

  // --- ENGINE LOGIC ---
  const handleApplyProtocol = () => {
    // Parse the comma-separated strings into clean arrays
    const parseKeywords = (raw: string) => 
      raw.split(',')
         .map(w => w.trim().toLowerCase()) // normalize to lowercase
         .filter(w => w.length > 0); // remove empty strings

    setPositiveKeywords(parseKeywords(posInput));
    setNegativeKeywords(parseKeywords(negInput));
    setIsEditingProtocol(false);
    
    // Reset any active scans so the user is forced to re-run with the new protocol
    setDecision(null); 
  };

  const handleScan = () => {
    if (!inputText.trim()) return;

    const currentPositives: Set<string> = new Set();
    const currentNegatives: Set<string> = new Set();

    const normalizedText = inputText.replace(/\s+/g, ' ');

    const findMatches = (wordList: string[], targetSet: Set<string>) => {
      wordList.forEach(word => {
        const safeWord = word.replace(/\s+/g, '\\s+');
        const regex = new RegExp(`\\b${safeWord}\\b`, 'gi');
        if (regex.test(normalizedText)) {
          targetSet.add(word);
        }
      });
    };

    findMatches(positiveKeywords, currentPositives);
    findMatches(negativeKeywords, currentNegatives);

    setFoundPositives(Array.from(currentPositives));
    setFoundNegatives(Array.from(currentNegatives));

    if (currentNegatives.size > 0) {
      setDecision('EXCLUDE');
    } else if (currentPositives.size > 0) {
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
        return <span key={i} className="bg-red-500/20 text-red-400 font-bold px-1 rounded border border-red-500/30">{part}</span>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  // --- UI RENDER ---
  return (
    <div className="max-w-5xl mx-auto p-6 bg-[#0A0A0A] text-slate-200 rounded-2xl shadow-2xl border border-white/10">
      
      {/* Header & Protocol Toggle */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-2xl font-black mb-1 text-white flex items-center gap-2">
            <span className="text-[#00A598]">///</span> Abstract Telemetry
          </h2>
          <p className="text-xs font-mono text-slate-500 uppercase tracking-widest">
            Adaptive PICO Scanner Engine
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

      {/* NEW: Dynamic Configuration Panel */}
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

      {/* Input Area */}
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
          Execute Scan Protocol
        </button>
      </div>

      {/* Results Dashboard */}
      {decision && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6 border-t border-white/10 pt-6">
          
          {/* Decision Banner */}
          <div className={`p-6 rounded-xl font-black tracking-tight text-2xl md:text-3xl border-2 flex justify-center items-center ${
            decision === 'EXCLUDE' ? 'bg-red-950/30 text-red-500 border-red-500/50 shadow-[0_0_20px_rgba(239,68,68,0.15)]' :
            decision === 'INCLUDE / MAYBE' ? 'bg-emerald-950/30 text-emerald-400 border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.15)]' :
            'bg-yellow-950/30 text-yellow-500 border-yellow-500/50'
          }`}>
            {decision === 'EXCLUDE' ? '🚩 EXCLUDE (Criteria Violation)' : 
             decision === 'INCLUDE / MAYBE' ? '🟩 INCLUDE / MAYBE (Passes Screen)' : 
             '⚠️ MANUAL REVIEW REQUIRED'}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Keywords Panel */}
            <div className="md:col-span-1 space-y-4">
              <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
                <h4 className="font-bold text-sm text-emerald-400 mb-3 flex justify-between">
                  Inclusion Hits <span className="bg-emerald-900/50 px-2 py-0.5 rounded text-xs">{foundPositives.length}</span>
                </h4>
                {foundPositives.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {foundPositives.map((w, i) => <span key={i} className="text-xs uppercase bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 px-2 py-1 rounded">{w}</span>)}
                  </div>
                ) : <p className="text-xs text-slate-500">None detected.</p>}
              </div>

              <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
                <h4 className="font-bold text-sm text-red-400 mb-3 flex justify-between">
                  Exclusion Triggers <span className="bg-red-900/50 px-2 py-0.5 rounded text-xs">{foundNegatives.length}</span>
                </h4>
                {foundNegatives.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {foundNegatives.map((w, i) => <span key={i} className="text-xs uppercase bg-red-500/10 text-red-300 border border-red-500/20 px-2 py-1 rounded">{w}</span>)}
                  </div>
                ) : <p className="text-xs text-slate-500">None detected.</p>}
              </div>
            </div>

            {/* Context Viewer */}
            <div className="md:col-span-2 p-5 bg-white/5 border border-white/10 rounded-xl">
               <h4 className="font-bold text-sm text-slate-300 mb-3">Context Viewer</h4>
               <div className="text-sm text-slate-300 leading-relaxed bg-black/40 p-4 rounded-lg max-h-64 overflow-y-auto font-serif border border-black custom-scrollbar">
                  {getHighlightedText()}
               </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}