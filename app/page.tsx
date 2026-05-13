'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import ThemeToggle from '../components/ThemeToggle'; 

type SmartMatch = {
  word: string;
  sentence: string;
  isNegated: boolean; 
};

export default function SRMATelemetryPage() {
  // --- ENGINE STATE ---
  const [inputText, setInputText] = useState('');
  const [decision, setDecision] = useState<string | null>(null);
  const [isScanned, setIsScanned] = useState(false);
  
  const [smartPositives, setSmartPositives] = useState<SmartMatch[]>([]);
  const [smartNegatives, setSmartNegatives] = useState<SmartMatch[]>([]);

  // --- CONFIGURATION STATE ---
  const [isEditingProtocol, setIsEditingProtocol] = useState(false);

  // THE EXPANDED PICO INCLUSION DICTIONARY
  const defaultPositives = [
    'women', 'woman', 'female', 'females', 'postmenopausal', 'post-menopausal', 'postmenopause', 
    'post-menopause', 'perimenopausal', 'peri-menopausal', 'perimenopause', 'climacteric', 
    'menopausal transition', 'local estrogen', 'local oestrogen', 'local vaginal let', 
    'topical let', 'intravaginal estrogen', 'vaginal oestrogen', 'vaginal delivery system', 
    'vaginal administration', 'estradiol', 'oestradiol', 'estriol', 'oestriol', 
    'conjugated equine estrogen', 'cee', 'conjugated estrogen', 'conjugated estrogens', 
    'conjugated oestrogen', 'conjugated oestrogens', 'promestriene', 'estrone', 'cream', 
    'creams', 'ring', 'rings', 'tablet', 'tablets', 'capsule', 'capsules', 'ovule', 'ovules', 
    'pessary', 'pessaries', 'insert', 'inserts', 'gel', 'gels', 'recurrent', 'recurrence', 
    'recurring', 'repeat', 'repeated', 'repeating', 'persistent', 'chronic', 'relapse', 
    'relapsing', 'reinfection', 'urinary tract infection', 'urinary tract infections', 
    'uti', 'utis', 'ruti', 'rutis', 'cystitis', 'bacteriuria', 'bladder infection', 
    'bladder infections', 'luti', 'lutis', 'ruluti', 'rulutis'
  ];

  // THE INTERFERENCE FILTER (Strict Exclusions based on PICO)
  const defaultNegatives = [
    'oral', 'systemic', 'transdermal', 'patch', 'patches', 'diabetes', 'diabetic', 'dm', 
    'type 2 dm', 't2dm', 'hba1c', 'glucose', 'catheter', 'catheters', 'indwelling', 'prolapse', 
    'pelvic organ prolapse', 'cystocele', 'rectocele', 'urogenital abnormalities', 
    'structural abnormalities', 'surgery', 'post-operative', 'oncology', 'cancer', 
    'breast cancer', 'endometrial cancer', 'male', 'men', 'man', 'pediatric', 'children', 
    'adolescent', 'girls', 'pregnancy', 'pregnant', 'lactation', 'breastfeeding', 'animal', 
    'animals', 'rat', 'rats', 'mouse', 'mice', 'murine', 'rabbit', 'in vitro', 'in-vitro', 
    'lab', 'laboratory', 'cell line', 'review', 'systematic review', 'meta-analysis', 
    'meta analysis', 'case report', 'case series', 'editorial', 'letter', 'comment', 
    'abstract only', 'antibiotic', 'antibiotics', 'nitrofurantoin', 'fosfomycin', 
    'trimethoprim', 'prophylaxis'
  ];

  // Heuristic Negation Dictionary
  const negationTriggers = [
    'exclud', 'without', 'no ', 'exception', 'ruled out', 'history of', 'omitted'
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

  // --- SMART ENGINE LOGIC ---
  const handleScan = () => {
    if (!inputText.trim()) return;

    const normalizedText = inputText.replace(/\s+/g, ' ');
    const sentences = normalizedText.match(/[^.!?]+[.!?]+/g) || [normalizedText];

    const currentPositives: Map<string, SmartMatch> = new Map();
    const currentNegatives: Map<string, SmartMatch> = new Map();

    const isSentenceNegated = (sentence: string) => {
      const lowerSentence = sentence.toLowerCase();
      return negationTriggers.some(trigger => lowerSentence.includes(trigger));
    };

    sentences.forEach(sentence => {
      const isNegatedContext = isSentenceNegated(sentence);

      positiveKeywords.forEach(word => {
        const safeWord = word.replace(/\s+/g, '\\s+');
        const regex = new RegExp(`\\b${safeWord}\\b`, 'gi');
        if (regex.test(sentence) && !currentPositives.has(word)) {
          currentPositives.set(word, { word, sentence: sentence.trim(), isNegated: false });
        }
      });

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
    setIsScanned(true);

    const hardExclusions = negArray.filter(n => !n.isNegated).length;
    const negatedExclusions = negArray.filter(n => n.isNegated).length;

    if (hardExclusions > 0) {
      setDecision('EXCLUDE');
    } else if (negatedExclusions > 0) {
      setDecision('UNCLEAR'); 
    } else if (posArray.length > 0) {
      setDecision('INCLUDE / MAYBE');
    } else {
      setDecision('UNCLEAR');
    }
  };

  const handleClear = () => {
    setInputText('');
    setDecision(null);
    setSmartPositives([]);
    setSmartNegatives([]);
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
        const isNegated = smartNegatives.some(n => n.word === lowerPart && n.isNegated);
        if (isNegated) {
          return <span key={i} className="bg-yellow-100 dark:bg-yellow-500/20 text-yellow-800 dark:text-yellow-400 font-bold px-1 rounded border border-yellow-200 dark:border-yellow-500/30 cursor-help transition-colors" title="Context implies this exclusion was controlled for.">{part}</span>;
        }
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
                <span className="text-[9px] font-black text-blue-600 dark:text-blue-400 border border-blue-600/30 dark:border-blue-400/30 bg-blue-50 dark:bg-blue-400/10 px-1.5 py-0.5 rounded ml-2 uppercase tracking-widest transition-colors hidden sm:inline-block">Smart Context</span>
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
                  className="flex-1 py-3.5 bg-[#00A598] hover:bg-[#009085] disabled:bg-neutral-200 dark:disabled:bg-white/5 disabled:text-neutral-400 dark:disabled:text-slate-500 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-all shadow-[0_4px_15px_rgba(0,165,152,0.3)] dark:shadow-[0_0_15px_rgba(0,165,152,0.3)] disabled:shadow-none active:scale-95"
                >
                  Execute Smart Scan
                </button>
              </div>
            </div>

            {/* Results Dashboard */}
            {isScanned && (
              <div className="mt-8 pt-8 border-t border-black/5 dark:border-white/10 animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
                
                {/* Decision Banner */}
                <div className={`flex flex-col items-center justify-center p-6 rounded-2xl border transition-colors ${
                  decision === 'EXCLUDE' ? 'bg-red-50/80 dark:bg-red-950/30 border-red-200 dark:border-red-500/50 text-red-600 dark:text-red-500 shadow-[0_4px_20px_rgba(220,38,38,0.05)] dark:shadow-[0_0_20px_rgba(239,68,68,0.15)]' :
                  decision === 'INCLUDE / MAYBE' ? 'bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-500/50 text-emerald-600 dark:text-emerald-400 shadow-[0_4px_20px_rgba(16,185,129,0.05)] dark:shadow-[0_0_20px_rgba(16,185,129,0.15)]' :
                  'bg-yellow-50/80 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-500/50 text-yellow-600 dark:text-yellow-500 shadow-[0_4px_20px_rgba(234,179,8,0.05)] dark:shadow-[0_0_20px_rgba(234,179,8,0.15)]'
                }`}>
                  <h1 className="text-2xl sm:text-3xl font-black tracking-tight flex items-center gap-3">
                    {decision === 'EXCLUDE' ? '🚩 EXCLUDE (Criteria Violation)' : 
                     decision === 'INCLUDE / MAYBE' ? '🟩 INCLUDE / MAYBE (Passes Screen)' : 
                     '⚠️ MANUAL REVIEW REQUIRED'}
                  </h1>
                  {decision === 'UNCLEAR' && smartNegatives.some(n => n.isNegated) && (
                     <span className="text-[11px] font-mono text-yellow-600 dark:text-yellow-300/70 mt-3 block tracking-normal uppercase bg-yellow-100 dark:bg-black/20 px-3 py-1 rounded">
                       Heuristic Engine overrode exclusion because triggers were found in a negated sentence.
                     </span>
                   )}
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  
                  {/* SMARTER KEYWORDS PANEL */}
                  <div className="md:col-span-1 space-y-4">
                    <div className="p-5 bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-2xl shadow-sm dark:shadow-none transition-colors">
                      <h4 className="font-bold text-[13px] text-neutral-600 dark:text-emerald-400 mb-4 flex justify-between tracking-tight transition-colors">
                        Inclusion Hits <span className="bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded text-[11px] font-black">{smartPositives.length}</span>
                      </h4>
                      {smartPositives.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {smartPositives.map((match, i) => <span key={i} className="text-[11px] font-bold uppercase bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-500/20 px-2 py-1 rounded transition-colors">{match.word}</span>)}
                        </div>
                      ) : <p className="text-[12px] text-neutral-400 dark:text-slate-500 transition-colors">None detected.</p>}
                    </div>

                    <div className="p-5 bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-2xl shadow-sm dark:shadow-none transition-colors">
                      <h4 className="font-bold text-[13px] text-neutral-600 dark:text-red-400 mb-4 flex justify-between tracking-tight transition-colors">
                        Exclusion Triggers <span className="bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400 px-2 py-0.5 rounded text-[11px] font-black">{smartNegatives.length}</span>
                      </h4>
                      {smartNegatives.length > 0 ? (
                        <div className="flex flex-col gap-2">
                          {smartNegatives.map((match, i) => (
                            <div key={i} className={`text-[11px] p-2 rounded border transition-colors ${match.isNegated ? 'bg-yellow-50 dark:bg-yellow-500/10 border-yellow-200 dark:border-yellow-500/30' : 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20'}`}>
                              <span className={`font-bold uppercase ${match.isNegated ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-300'}`}>{match.word}</span>
                              {match.isNegated && <span className="ml-2 italic text-[10px] text-yellow-600/70 dark:text-yellow-500/70">Context Overridden</span>}
                            </div>
                          ))}
                        </div>
                      ) : <p className="text-[12px] text-neutral-400 dark:text-slate-500 transition-colors">None detected.</p>}
                    </div>
                  </div>

                  {/* UPGRADED CONTEXT VIEWER */}
                  <div className="md:col-span-2 p-5 bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-2xl shadow-sm dark:shadow-none flex flex-col transition-colors">
                     <h4 className="font-bold text-[13px] text-neutral-600 dark:text-slate-300 mb-4 flex justify-between items-center tracking-tight transition-colors">
                       Sentence Isolation
                       <span className="text-[9px] bg-neutral-100 dark:bg-black/50 px-2 py-1 rounded border border-black/5 dark:border-white/5 uppercase tracking-widest text-neutral-500 dark:text-slate-500">Telemetry Feed</span>
                     </h4>
                     
                     {/* Smart Isolation Cards */}
                     <div className="flex flex-col gap-3 mb-4">
                       {smartNegatives.map((match, i) => (
                         <div key={i} className={`p-4 rounded-xl border text-[13px] transition-colors ${match.isNegated ? 'bg-yellow-50/50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-500/20' : 'bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-500/20'}`}>
                           <div className="text-[11px] font-bold mb-1.5 flex items-center gap-2">
                             {match.isNegated ? '⚠️ OVERRIDDEN TRIGGER:' : '🚩 HARD EXCLUSION:'} <span className="uppercase tracking-widest">{match.word}</span>
                           </div>
                           <span className="italic text-neutral-600 dark:text-slate-400">"...{match.sentence}..."</span>
                         </div>
                       ))}
                       {smartNegatives.length === 0 && (
                         <div className="text-[12px] text-neutral-400 dark:text-slate-500 italic px-2 transition-colors">No exclusion sentences detected in feed.</div>
                       )}
                     </div>

                     <h4 className="font-bold text-[13px] text-neutral-600 dark:text-slate-300 mb-3 mt-4 transition-colors">Full Context Viewer</h4>
                     <div className="text-[13px] text-neutral-700 dark:text-slate-300 leading-relaxed bg-neutral-50/50 dark:bg-black/40 p-4 rounded-xl flex-1 overflow-y-auto font-serif border border-black/5 dark:border-black custom-scrollbar max-h-48 transition-colors">
                        {getHighlightedText()}
                     </div>
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