'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Phone-only bottom navigation. The header nav is hidden below the `sm`
// breakpoint, which previously left phones with no way to switch sections.
// Shown only under `sm` (tablets/desktop keep the header nav).
const TABS = [
  { href: '/', label: 'Scanner', icon: '🔬' },
  { href: '/research', label: 'Research', icon: '📚' },
  { href: '/stats', label: 'Statistics', icon: '📊' },
];

export default function MobileTabBar() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <nav
      aria-label="Primary"
      className="sm:hidden fixed inset-x-0 bottom-0 z-40 border-t border-black/10 dark:border-white/10 bg-white/80 dark:bg-black/70 backdrop-blur-2xl pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="grid grid-cols-3">
        {TABS.map((tab) => {
          const active = isActive(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-black uppercase tracking-[0.12em] transition-colors ${
                  active
                    ? 'text-[#00A598]'
                    : 'text-neutral-500 dark:text-slate-400 active:text-neutral-900 dark:active:text-white'
                }`}
              >
                <span className="text-[17px] leading-none">{tab.icon}</span>
                <span>{tab.label}</span>
                <span
                  className={`mt-0.5 h-0.5 w-6 rounded-full transition-colors ${
                    active ? 'bg-[#00A598]' : 'bg-transparent'
                  }`}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
