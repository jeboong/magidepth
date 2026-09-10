import {clsx, type ClassValue} from 'clsx';
import {twMerge} from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
export function formatTime(seconds: number, decimals = false) {
  if (!Number.isFinite(seconds)) return '00:00';
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60).toString().padStart(2, '0');
  const secs = Math.floor(safe % 60).toString().padStart(2, '0');
  return `${minutes}:${secs}${decimals ? `.${Math.floor((safe % 1) * 100).toString().padStart(2, '0')}` : ''}`;
}
export function baseName(path: string) { return path.split(/[\\/]/).pop() ?? path; }
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
