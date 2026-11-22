import { cn } from '@/lib/cn';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  /** Accessible label. Pass `null` when the spinner is decorative (e.g. inside a busy button). */
  label?: string | null;
  className?: string;
}

const sizes = { sm: 'size-4', md: 'size-6', lg: 'size-10' };

export function Spinner({ size = 'md', label = 'Loading', className }: SpinnerProps) {
  const svg = (
    <svg
      className={cn('animate-spin', sizes[size], className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
  if (label === null) return svg;
  return (
    <span role="status" className="inline-flex items-center">
      {svg}
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function PageSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-primary">
      <Spinner size="lg" label={label} />
    </div>
  );
}
