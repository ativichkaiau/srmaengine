'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import ThemeToggle from '../components/ThemeToggle'; // Adjust path if necessary

export default function SRMATelemetryPage() {
  // --- ENGINE STATE ---
  const [inputText, setInputText] = useState('');
  const [decision, setDecision] = useState<string | null>(null);
  const [foundPositives, setFoundPositives] = useState<string[]>([]);
  const [foundNegatives, setFoundNegatives] = useState<string[]>([]);
  const [isScanned, setIsScanned] = useState(false);

  // --- CONFIGURATION STATE ---
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

  const [posInput, setPosInput] = useState(defaultPositives.join(', '));
  const [negInput, setNegInput] = useState(defaultNegatives.join(', '));

  // --- PROTOCOL HANDLER ---
  const handleApplyProtocol = () => {
    const parseKeywords = (raw: string) => 
      raw.split(',')
         .map(w => w.trim().toLowerCase())
         .filter(w => w.length > 0);

    setPositiveKeywords(parseKeywords(posInput));
    setNegativeKeywords(parseKeywords(negInput));
    setIsEditingProtocol(false);
    setDecision(null); 
    setIsScanned(false);
  };

  // --- ENGINE LOGIC ---
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
    setIsScanned(true);

    if (currentNegatives.size > 0) {
      setDecision('EXCLUDE');
    } else if (currentPositives.size > 0) {
      setDecision('INCLUDE / MAYBE');
    } else {
      setDecision('UNCLEAR');
    }
  };

  const handleClear = () => {
    setInputText('');
    setDecision(null);
    setFoundPositives([]);
    setFoundNegatives([]);
    setIsScanned(false);
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
        return <span key={i} className="bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-400 font-bold px-1 rounded border border-emerald-200 dark:border-emerald-500/30 transition-colors">{part}</span>;
      } else if (negativeKeywords.includes(lowerPart)) {
        return <span key={i} className="bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-400 font-bold px-1 rounded border border-red-200 dark:border-red-500/30 transition-colors">{part}</span>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  // --- UI RENDER ---
  return (
    <div className="min-h-screen flex flex-col bg-[#FAFAFA] dark:bg-[#050505] text-neutral-900 dark:text-neutral-100 relative overflow-hidden font-sans selection:bg-[#00A598]/30 transition-colors duration-700">
      
      {/* CUSTOM ANIMATION STYLES */}
      <style dangerouslySetInnerHTML={{__html: `
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
      `}} />

      {/* DAY/NIGHT ATMOSPHERE */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden transition-opacity duration-1000">
        <div className="absolute top-[-10%] right-[10%] w-[60%] h-[60%] bg-gradient-to-br from-blue-400/20 to-purple-400/20 dark:from-blue-600/15 dark:to-[#00A598]/10 rounded-full blur-[120px] mix-blend-multiply dark:mix-blend-screen opacity-70 dark:opacity-60 transition-all duration-1000"></div>
        <div className="absolute bottom-[-10%] left-[5%] w-[50%] h-[50%] bg-gradient-to-tr from-pink-400/20 to-teal-300/20 dark:from-purple-600/10 dark:to-teal-600/10 rounded-full blur-[120px] mix-blend-multiply dark:mix-blend-screen opacity-70 dark:opacity-50 transition-all duration-1000"></div>
      </div>

      {/* MINIMALIST HEADER */}
      <header className="h-[64px] lg:h-[72px] flex items-center justify-between px-4 lg:px-8 shrink-0 bg-white/60 dark:bg-black/40 backdrop-blur-2xl z-50 border-b border-black/5 dark:border-white/5 transition-colors duration-700">
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
          
          {/* Top-Notch Theme Toggle Integration */}
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

            <h1 className="font-black tracking-tighter leading-none mb-4 flex flex-col items-center justify-center gap-2 sm:gap-3 xl:gap-4 relative z-10">
              <div className="flex items-center gap-3 text-[24px] sm:text-[32px] lg:text-[40px]">
                <span className="italic text-white dark:text-black bg-neutral-900 dark:bg-white px-3 py-1.5 rounded-[12px] shadow-sm border border-black/5 dark:border-white/5 leading-none transition-colors duration-700">
                  ///SRMA
                </span>
                <span className="text-transparent bg-clip-text bg-gradient-to-br from-neutral-900 to-neutral-500 dark:from-white dark:to-neutral-500 transition-colors duration-700">
                  Abstract Telemetry
                </span>
              </div>
            </h1>

            <p className="max-w-2xl font-mono text-[10px] sm:text-[11px] text-neutral-500 dark:text-neutral-400 uppercase tracking-[0.3em] leading-relaxed px-4 relative z-10 transition-colors duration-700">
              <span className="dark:hidden">DAY_CYCLE</span><span className="hidden dark:inline">NIGHT_CYCLE</span> // <span className="text-[#00A598] font-bold">PICO PROTOCOL ENGAGED</span>
            </p>
          </section>

          {/* THE ENGINE (Bento Box Wrapper) */}
          <div className="flex flex-col rounded-[24px] lg:rounded-[32px] bg-white/60 dark:bg-white/5 backdrop-blur-xl border border-black/5 dark:border-white/5 p-5 lg:p-8 shadow-[0_4px_30px_rgb(0,0,0,0.04)] transition-all duration-700">
            
            {/* Dynamic Protocol Editor Header */}
            <div className="flex justify-between items-center mb-6 px-1">
              <h2 className="font-bold text-[16px] tracking-tight flex items-center gap-2 text-neutral-900 dark:text-white transition-colors duration-700">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span> Input Stream
              </h2>
              <button 
                onClick={() => setIsEditingProtocol(!isEditingProtocol)}
                className={`px-3 py-1.5 text-[11px] font-bold rounded-lg border transition-all ${
                  isEditingProtocol 
                  ? 'bg-[#00A598]/10 dark:bg-[#00A598]/20 text-[#00A598] border-[#00A598]/30 dark:border-[#00A598]/50' 
                  : 'bg-white dark:bg-white/5 text-neutral-500 dark:text-slate-400 border-black/10 dark:border-white/10 hover:bg-neutral-50 dark:hover:bg-white/10 hover:text-neutral-800 dark:hover:text-white'
                }`}
              >
                {isEditingProtocol ? 'Close Editor' : '⚙ Edit PICO Dictionary'}
              </button>
            </div>

            {/* Protocol Editor Panel */}
            {isEditingProtocol && (
              <div className="mb-6 p-5 bg-white dark:bg-black/50 border border-black/5 dark:border-white/10 rounded-2xl shadow-sm dark:shadow-none animate-in fade-in slide-in-from-top-2 transition-colors duration-700">
                <h3 className="text-[13px] font-bold text-neutral-700 dark:text-white mb-4 border-b border-black/5 dark:border-white/10 pb-2 transition-colors">Protocol Configuration</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                  <div>
                    <label className="block text-[11px] font-bold text-emerald-600 dark:text-emerald-400 mb-2 uppercase tracking-wide transition-colors">
                      Inclusion Keywords (Comma Separated)
                    </label>
                    <textarea
                      className="w-full h-32 p-3 bg-neutral-50 dark:bg-white/5 text-neutral-700 dark:text-slate-300 font-mono text-[12px] border border-black/5 dark:border-white/10 rounded-xl focus:border-emerald-500 focus:outline-none custom-scrollbar transition-colors"
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
                    className="px-4 py-2 text-[12px] font-bold text-neutral-500 dark:text-slate-400 hover:text-neutral-800 dark:hover:text-white transition-colors"
                  >
                    Reset Defaults
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
                placeholder="Paste the target abstract here for PICO analysis..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
              />

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
                  className="flex-1 py-3.5 bg-[#00A598] hover:bg-[#008f83] disabled:bg-neutral-200 dark:disabled:bg-white/5 disabled:text-neutral-400 dark:disabled:text-slate-500 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-all shadow-[0_4px_15px_rgba(0,165,152,0.3)] dark:shadow-[0_0_15px_rgba(0,165,152,0.3)] disabled:shadow-none active:scale-95"
                >
                  Execute Screening Protocol
                </button>
              </div>
            </div>

            {/* Results Dashboard */}
            {isScanned && (
              <div className="mt-8 pt-8 border-t border-black/5 dark:border-white/10 animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
                
                {/* Decision Banner */}
                <div className={`flex items-center justify-center p-6 rounded-2xl border transition-colors ${
                  decision === 'EXCLUDE' ? 'bg-red-50/80 dark:bg-red-950/30 border-red-200 dark:border-red-500/50 text-red-600 dark:text-red-500 shadow-[0_4px_20px_rgba(220,38,38,0.05)] dark:shadow-[0_0_20px_rgba(239,68,68,0.15)]' :
                  decision === 'INCLUDE / MAYBE' ? 'bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-500/50 text-emerald-600 dark:text-emerald-400 shadow-[0_4px_20px_rgba(16,185,129,0.05)] dark:shadow-[0_0_20px_rgba(16,185,129,0.15)]' :
                  'bg-yellow-50/80 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-500/50 text-yellow-600 dark:text-yellow-500'
                }`}>
                  <h1 className="text-2xl sm:text-3xl font-black tracking-tight flex items-center gap-3">
                    {decision === 'EXCLUDE' ? '🚩 EXCLUDE (Criteria Violation)' : 
                     decision === 'INCLUDE / MAYBE' ? '🟩 INCLUDE (Passes Initial Screen)' : 
                     '⚠️ MANUAL REVIEW REQUIRED'}
                  </h1>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  
                  {/* Positives Card */}
                  <div className="p-5 bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-2xl shadow-sm dark:shadow-none transition-colors">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-[13px] font-bold text-neutral-600 dark:text-emerald-400 tracking-tight transition-colors">Inclusion Hits</h3>
                      <span className="bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400 text-[11px] font-black px-2.5 py-1 rounded-md transition-colors">{foundPositives.length}</span>
                    </div>
                    {foundPositives.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {foundPositives.map((word, idx) => (
                          <span key={idx} className="bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 text-[11px] font-bold px-2 py-1 rounded border border-emerald-100 dark:border-emerald-500/20 uppercase transition-colors">{word}</span>
                        ))}
                      </div>
                    ) : <p className="text-[12px] text-neutral-400 dark:text-slate-500 transition-colors">No inclusion triggers found.</p>}
                  </div>

                  {/* Negatives Card */}
                  <div className="p-5 bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-2xl shadow-sm dark:shadow-none transition-colors">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-[13px] font-bold text-neutral-600 dark:text-red-400 tracking-tight transition-colors">Exclusion Triggers</h3>
                      <span className="bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400 text-[11px] font-black px-2.5 py-1 rounded-md transition-colors">{foundNegatives.length}</span>
                    </div>
                    {foundNegatives.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {foundNegatives.map((word, idx) => (
                          <span key={idx} className="bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-300 text-[11px] font-bold px-2 py-1 rounded border border-red-100 dark:border-red-500/20 uppercase transition-colors">{word}</span>
                        ))}
                      </div>
                    ) : <p className="text-[12px] text-neutral-400 dark:text-slate-500 transition-colors">No exclusion triggers found.</p>}
                  </div>
                </div>

                {/* Context Viewer */}
                <div className="p-5 bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-2xl shadow-sm dark:shadow-none transition-colors">
                   <h3 className="text-[13px] font-bold text-neutral-600 dark:text-slate-300 tracking-tight mb-3 flex items-center gap-2 transition-colors">
                     Context Viewer
                   </h3>
                   <div className="text-[13px] text-neutral-700 dark:text-slate-300 leading-relaxed font-serif bg-neutral-50/50 dark:bg-black/40 p-4 rounded-xl border border-black/5 dark:border-black max-h-64 overflow-y-auto custom-scrollbar transition-colors">
                      {getHighlightedText()}
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