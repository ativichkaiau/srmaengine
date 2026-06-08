'use client';

import React, { useState, useEffect, useSyncExternalStore } from 'react';

// Returns false during SSR + the first hydration render, true thereafter —
// the idiomatic React way to detect "mounted on the client" without a
// setState-in-effect cascade.
const emptySubscribe = () => () => {};
function useMounted() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

type Mode = 'auto' | 'light' | 'dark';

const STORAGE_KEY = 'vestrippn-theme';

// Day = 06:00–17:59, Night = 18:00–05:59 (local time).
function isNight(d: Date) {
  const h = d.getHours();
  return h < 6 || h >= 18;
}

function readSavedMode(): Mode {
  if (typeof window === 'undefined') return 'auto';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved === 'light' || saved === 'dark' || saved === 'auto'
    ? saved
    : 'auto';
}

export default function ThemeToggle() {
  // Read the saved mode in a lazy initializer rather than via setState in an
  // effect (avoids the set-state-in-effect cascade). Output is still gated on
  // `mounted` below, so first client render matches the server placeholder.
  const [mode, setMode] = useState<Mode>(readSavedMode);
  const [, setTick] = useState(0);
  const mounted = useMounted();

  const resolvedDark =
    mode === 'dark' || (mode === 'auto' && isNight(new Date()));

  // Apply the resolved theme to <html> (DOM sync — not a setState).
  useEffect(() => {
    if (!mounted) return;
    document.documentElement.classList.toggle('dark', resolvedDark);
  }, [mounted, resolvedDark]);

  // In auto mode, re-render each minute so it flips at the 06:00 / 18:00 line.
  useEffect(() => {
    if (mode !== 'auto') return;
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [mode]);

  const cycle = () => {
    const next: Mode =
      mode === 'auto' ? 'light' : mode === 'light' ? 'dark' : 'auto';
    setMode(next);
    localStorage.setItem(STORAGE_KEY, next);
  };

  // Prevent rendering mismatched UI during SSR.
  if (!mounted) {
    return (
      <div className="w-[80px] h-[40px] rounded-full bg-black/5 dark:bg-white/5 animate-pulse"></div>
    );
  }

  const trackIndex = mode === 'auto' ? 0 : mode === 'light' ? 1 : 2;

  return (
    <button
      onClick={cycle}
      className="relative px-4 py-1.5 bg-black/5 dark:bg-white/[0.03] border border-black/10 dark:border-white/10 rounded-full flex flex-col items-center justify-center leading-none cursor-pointer hover:bg-black/10 dark:hover:bg-white/[0.06] transition-all duration-500 overflow-hidden group active:scale-95 shadow-sm"
      aria-label={`Theme mode: ${mode}. Click to change.`}
      title={
        mode === 'auto'
          ? `Auto — following local time (currently ${resolvedDark ? 'Night' : 'Day'})`
          : `Manual ${mode === 'dark' ? 'Night' : 'Day'}`
      }
    >
      {/* Ambient background glow that shifts with the resolved theme */}
      <div
        className={`absolute inset-0 opacity-20 transition-all duration-700 ease-in-out ${
          resolvedDark
            ? 'bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-500/50 via-transparent to-transparent translate-x-4'
            : 'bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-amber-500/50 via-transparent to-transparent -translate-x-4'
        }`}
      />

      {/* Static Label */}
      <span className="text-[8px] text-neutral-500 dark:text-slate-500 font-black uppercase tracking-widest mb-0.5 relative z-10 transition-colors duration-500">
        Mode
      </span>

      {/* Animated Text & Icon Track (Auto / Day / Night) */}
      <div className="relative h-[16px] w-[58px] overflow-hidden">
        <div
          className="absolute top-0 left-0 w-full flex flex-col transition-transform duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          style={{ transform: `translateY(-${trackIndex * 16}px)` }}
        >
          {/* Auto State */}
          <div className="h-[16px] w-full flex items-center justify-center gap-1 shrink-0">
            <span className="text-neutral-800 dark:text-white font-bold text-xs">Auto</span>
            <span className="text-[10px]">{resolvedDark ? '🌙' : '☀️'}</span>
          </div>

          {/* Day State */}
          <div className="h-[16px] w-full flex items-center justify-center gap-1.5 shrink-0">
            <span className="text-neutral-800 dark:text-white font-bold text-xs">Day</span>
            <span className="text-[10px] transform group-hover:rotate-45 transition-transform duration-500">☀️</span>
          </div>

          {/* Night State */}
          <div className="h-[16px] w-full flex items-center justify-center gap-1.5 shrink-0">
            <span className="text-neutral-800 dark:text-white font-bold text-xs">Night</span>
            <span className="text-[10px] transform group-hover:-rotate-12 transition-transform duration-500">🌙</span>
          </div>
        </div>
      </div>
    </button>
  );
}
