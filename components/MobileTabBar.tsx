'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Phone-only bottom navigation. The header nav is hidden below the `sm`
// breakpoint, which previously left phones with no way to switch sections.
// Shown only under `sm` (tablets/desktop keep the header nav).
const TABS = [
  { href: '/', label: 'Scanner', icon: '⌕' },
  { href: '/research', label: 'Research', icon: '▤' },
  { href: '/stats', label: 'Stats', icon: 'Σ' },
  { href: '/library', label: 'Library', icon: '❒' },
  { href: '/appraisal', label: 'Appraise', icon: '⚖' },
];

export default function MobileTabBar() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <nav
      aria-label="Primary"
      className="clay-header clay-bottom-nav sm:hidden fixed inset-x-0 bottom-0 z-40 pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="grid grid-cols-5 gap-1 px-2 py-1.5">
        {TABS.map((tab) => {
          const active = isActive(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`clay-tab flex flex-col items-center justify-center gap-0.5 rounded-xl py-2 text-[10px] font-black uppercase tracking-[0.12em] ${
                  active
                    ? 'clay-tab-active'
                    : ''
                }`}
              >
                <span className="text-[17px] leading-none font-black">{tab.icon}</span>
                <span>{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
