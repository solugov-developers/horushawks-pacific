import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtNum(n: number | string | null | undefined, opts?: Intl.NumberFormatOptions): string {
  if (n == null || n === '') return '—';
  const v = typeof n === 'string' ? Number(n) : n;
  if (!Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('en-US', opts).format(v);
}

export function fmtSigned(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  return (n > 0 ? '+' : '') + new Intl.NumberFormat('en-US').format(n);
}

export function fmtPct(n: number | null | undefined, fractionDigits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(n);
}
