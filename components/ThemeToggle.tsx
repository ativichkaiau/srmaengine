'use client';

import React, { useState, useEffect } from 'react';

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  // 1. Hydration & Local Storage Sync
  useEffect(() => {
    setMounted(true);
    // Check local storage or system preference on load
    const savedTheme = localStorage.getItem('vestrippn-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
      setIsDark(true);
      document.documentElement.classList.add('dark');
    } else {
      setIsDark(false);
      document.documentElement.classList.remove('dark');
    }
  }, []);

  // 2. The Switch Mechanism
  const toggleTheme = () => {
    if (isDark) {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('vestrippn-theme', 'light');
      setIsDark(false);
    } else {
      document.documentElement.classList.add('dark');
      localStorage.setItem('vestrippn-theme', 'dark');
      setIsDark(true);
    }
  };

  // Prevent rendering mismatched UI during SSR
  if (!mounted) {
    return (
      <div className="w-[72px] h-[38px] rounded-full bg-black/5 dark:bg-white/5 animate-pulse"></div>
    );
  }

  return (
    <button
      onClick={toggleTheme}
      className="relative px-4 py-1.5 bg-black/5 dark:bg-white/[0.03] border border-black/10 dark:border-white/10 rounded-full flex flex-col items-center justify-center leading-none cursor-pointer hover:bg-black/10 dark:hover:bg-white/[0.06] transition-all duration-500 overflow-hidden group active:scale-95 shadow-sm"
      aria-label="Toggle Theme"
    >
      {/* Ambient background glow that shifts with the theme */}
      <div 
        className={`absolute inset-0 opacity-20 transition-all duration-700 ease-in-out ${
          isDark 
            ? 'bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-500/50 via-transparent to-transparent translate-x-4' 
            : 'bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-amber-500/50 via-transparent to-transparent -translate-x-4'
        }`}
      />

      {/* Static Label */}
      <span className="text-[8px] text-neutral-500 dark:text-slate-500 font-black uppercase tracking-widest mb-0.5 relative z-10 transition-colors duration-500">
        Mode
      </span>

      {/* Animated Text & Icon Track */}
      <div className="relative h-[16px] w-[50px] overflow-hidden">
        <div 
          className={`absolute top-0 left-0 w-full h-full flex flex-col transition-transform duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
            isDark ? '-translate-y-[16px]' : 'translate-y-0'
          }`}
        >
          {/* Day State */}
          <div className="h-[16px] w-full flex items-center justify-center gap-1.5 shrink-0">
            <span className="text-neutral-800 font-bold text-xs">Day</span>
            <span className="text-[10px] transform group-hover:rotate-45 transition-transform duration-500">☀️</span>
          </div>

          {/* Night State */}
          <div className="h-[16px] w-full flex items-center justify-center gap-1.5 shrink-0">
            <span className="text-white font-bold text-xs">Night</span>
            <span className="text-[10px] transform group-hover:-rotate-12 transition-transform duration-500">🌙</span>
          </div>
        </div>
      </div>
    </button>
  );
}