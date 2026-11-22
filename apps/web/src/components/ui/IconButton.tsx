import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  /** Required accessible name — icon-only buttons have no visible text. */
  label: string;
  icon: ReactNode;
  variant?: 'ghost' | 'outline' | 'primary' | 'inverse';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

const variants = {
  ghost: 'text-fg-muted hover:bg-surface-muted hover:text-fg',
  outline: 'border border-border-strong bg-surface text-fg hover:bg-surface-muted',
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover',
  inverse: 'text-ivory/90 hover:bg-white/10 hover:text-ivory',
};
const sizes = {
  sm: 'size-8 [&_svg]:size-4',
  md: 'size-10 [&_svg]:size-5',
  lg: 'size-12 [&_svg]:size-6',
};

export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size = 'md',
  loading,
  className,
  type = 'button',
  disabled,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full transition-colors duration-200',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <Spinner size="sm" label={null} />
      ) : (
        <span aria-hidden="true" className="contents">
          {icon}
        </span>
      )}
    </button>
  );
}
