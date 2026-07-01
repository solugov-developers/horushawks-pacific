'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

const links = [
  { href: '/',           label: 'Overview' },
  { href: '/inventory',  label: 'Inventory' },
  { href: '/sales',      label: 'Sales' },
  { href: '/movements',  label: 'Movements' },
  { href: '/reports',    label: 'Reports' },
  { href: '/data',       label: 'Data' },
  { href: '/scrapers',   label: 'Scrapers' },
  { href: '/sql',        label: 'SQL' },
];

export function TopNav({ userSlot }: { userSlot?: ReactNode }) {
  const pathname = usePathname();
  // Esconder a nav nas páginas públicas (login)
  if (pathname === '/login' || pathname.startsWith('/login/')) return null;
  return (
    <nav className="border-b border-border bg-bg/85 backdrop-blur-xl backdrop-saturate-150 sticky top-0 z-30">
      <div className="mx-auto max-w-[1280px] px-6 md:px-10">
        <div className="flex items-center justify-between h-14 gap-6">
          <Link href="/" aria-label="HorusHawks" className="text-text-strong shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/horushawks-mark.png"
              alt=""
              width={32}
              height={32}
              className="opacity-90"
            />
          </Link>

          <ul className="flex items-center gap-1 text-sm overflow-x-auto flex-1 justify-center">
            {links.map(l => {
              const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className={cn(
                      'relative inline-block whitespace-nowrap px-3 py-1.5 transition-colors',
                      active
                        ? 'text-text-strong font-medium'
                        : 'text-text-muted hover:text-text'
                    )}
                  >
                    {l.label}
                    {active && (
                      <span
                        aria-hidden
                        className="absolute left-3 right-3 -bottom-[7px] h-[2px] bg-accent-700 dark:bg-white rounded-full"
                      />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="shrink-0">{userSlot}</div>
        </div>
      </div>
    </nav>
  );
}
