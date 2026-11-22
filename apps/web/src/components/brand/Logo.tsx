import { Link } from 'react-router';
import { cn } from '@/lib/cn';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn('size-9', className)} aria-hidden="true">
      <rect width="40" height="40" rx="12" className="fill-forest-800 dark:fill-forest-700" />
      <path
        d="M10 26c4.5-9.5 15.5-9.5 20 0"
        fill="none"
        stroke="#C6A66B"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="20" cy="14" r="3.4" fill="#F8F6F1" />
      <path
        d="M8 30h24"
        stroke="#F8F6F1"
        strokeOpacity="0.35"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({
  tone = 'default',
  className,
  to = '/',
}: {
  tone?: 'default' | 'inverse';
  className?: string;
  to?: string;
}) {
  return (
    <Link
      to={to}
      className={cn('inline-flex items-center gap-2.5 rounded-lg', className)}
      aria-label="STAYSCAPE home"
    >
      <LogoMark />
      <span
        className={cn(
          'font-display text-lg font-semibold tracking-[0.22em]',
          tone === 'inverse' ? 'text-ivory' : 'text-fg',
        )}
      >
        STAYSCAPE
      </span>
    </Link>
  );
}
