import { useState, type ComponentProps, type ReactNode } from 'react';
import { useDocumentTitle } from '@/lib/use-document-title';
import { Link } from 'react-router';
import { ChevronRight, CircleAlert, CircleCheck, Info, Star, TriangleAlert, X } from 'lucide-react';
import { formatMinorUnits, type CurrencyCode } from '@stayscape/shared';
import { cn } from '@/lib/cn';
import { tr, trf } from '@/lib/tr';

/* ---------------------------------------------------------------- Badge */
export type BadgeTone =
  'neutral' | 'primary' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'outline';
const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-fg-muted',
  primary: 'bg-primary-soft text-primary',
  accent: 'bg-accent-soft text-gold-700 dark:text-gold-300',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  outline: 'border border-border-strong text-fg-muted',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
  ...props
}: ComponentProps<'span'> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3',
        badgeTones[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------- Card */
export function Card({
  className,
  variant = 'elevated',
  interactive,
  ...props
}: ComponentProps<'div'> & { variant?: 'elevated' | 'outline' | 'muted'; interactive?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-2xl',
        variant === 'elevated' && 'border border-border bg-surface shadow-sm',
        variant === 'outline' && 'border border-border bg-transparent',
        variant === 'muted' && 'bg-surface-muted',
        interactive &&
          'transition-[box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:shadow-md',
        className,
      )}
      {...props}
    />
  );
}
export const CardHeader = ({ className, ...props }: ComponentProps<'div'>) => (
  <div className={cn('flex flex-col gap-1 p-6 pb-3', className)} {...props} />
);
export const CardTitle = ({
  className,
  as: Tag = 'h3',
  ...props
}: ComponentProps<'h3'> & { as?: 'h2' | 'h3' | 'h4' }) => (
  <Tag className={cn('font-display text-lg font-semibold text-fg', className)} {...props} />
);
export const CardDescription = ({ className, ...props }: ComponentProps<'p'>) => (
  <p className={cn('text-sm text-fg-muted', className)} {...props} />
);
export const CardContent = ({ className, ...props }: ComponentProps<'div'>) => (
  <div className={cn('px-6 pb-6', className)} {...props} />
);
export const CardFooter = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    className={cn('flex items-center gap-3 border-t border-border px-6 py-4', className)}
    {...props}
  />
);

/* ---------------------------------------------------------------- Skeleton */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-surface-sunken', className)}
      {...props}
    />
  );
}
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3.5', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- Alert */
export type AlertTone = 'info' | 'success' | 'warning' | 'danger';
const alertStyles: Record<AlertTone, { box: string; icon: typeof Info }> = {
  info: { box: 'border-info/25 bg-info-soft text-info', icon: Info },
  success: { box: 'border-success/25 bg-success-soft text-success', icon: CircleCheck },
  warning: { box: 'border-warning/25 bg-warning-soft text-warning', icon: TriangleAlert },
  danger: { box: 'border-danger/25 bg-danger-soft text-danger', icon: CircleAlert },
};

export function Alert({
  tone = 'info',
  title,
  children,
  action,
  onDismiss,
  className,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const { box, icon: Icon } = alertStyles[tone];
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-xl border px-4 py-3.5 text-sm', box, className)}
    >
      <Icon className="mt-0.5 size-4.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn('text-fg-muted', title && 'mt-0.5')}>{children}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={tr('Dismiss')}
          className="self-start rounded p-0.5 opacity-70 hover:opacity-100"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Breadcrumb */
export interface BreadcrumbItem {
  label: string;
  to?: string;
}
export function Breadcrumb({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  return (
    <nav aria-label={tr('Breadcrumb')} className={className}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-fg-subtle">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
              {item.to && !last ? (
                <Link to={item.to} className="hover:text-fg hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? 'page' : undefined}
                  className={cn(last && 'font-medium text-fg')}
                >
                  {item.label}
                </span>
              )}
              {!last && <ChevronRight className="size-3.5" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ---------------------------------------------------------------- PageHeader */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  breadcrumb,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: BreadcrumbItem[];
  className?: string;
}) {
  useDocumentTitle(typeof title === 'string' ? title : null);
  return (
    <header
      className={cn(
        'flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="flex flex-col gap-2">
        {breadcrumb && <Breadcrumb items={breadcrumb} />}
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          {title}
        </h1>
        {description && <p className="max-w-2xl text-base text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/* ---------------------------------------------------------------- Empty / Error states */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-strong text-center',
        compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-14',
        className,
      )}
    >
      {icon && (
        <div
          className="mb-1 flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary [&_svg]:size-6"
          aria-hidden="true"
        >
          {icon}
        </div>
      )}
      <h3 className="font-display text-lg font-semibold text-fg">{title}</h3>
      {description && <p className="max-w-md text-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  description = 'We could not load this content. Check your connection and try again.',
  onRetry,
  requestId,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  onRetry?: () => void;
  requestId?: string | undefined;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center gap-3 rounded-2xl border border-danger/20 bg-danger-soft/50 px-6 py-12 text-center',
        className,
      )}
    >
      <div
        className="flex size-12 items-center justify-center rounded-full bg-danger-soft text-danger"
        aria-hidden="true"
      >
        <CircleAlert className="size-6" />
      </div>
      <h3 className="font-display text-lg font-semibold text-fg">{title}</h3>
      <p className="max-w-md text-sm text-fg-muted">{description}</p>
      {requestId && (
        <p className="font-mono text-xs text-fg-subtle">
          {tr('Reference:')} {requestId}
        </p>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 rounded-full border border-border-strong bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-muted"
        >
          {tr('Try again')}
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Avatar */
const avatarSizes = {
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-16 text-lg',
  xl: 'size-24 text-2xl',
};
export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}
export function Avatar({
  src,
  name,
  size = 'md',
  className,
  decorative = false,
}: {
  src?: string | null;
  name: string;
  size?: keyof typeof avatarSizes;
  className?: string;
  /** The surrounding control already names the person (e.g. an account menu button). */
  decorative?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = src && !failed;
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-forest-800 font-semibold text-ivory ring-2 ring-surface',
        avatarSizes[size],
        className,
      )}
    >
      {showImage ? (
        <img
          src={src}
          alt={decorative ? '' : name}
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span {...(decorative ? {} : { role: 'img', 'aria-label': name })}>
          {initials(name) || '?'}
        </span>
      )}
    </span>
  );
}

/* ---------------------------------------------------------------- Price & rating */
export function PriceDisplay({
  amountMinor,
  currency,
  locale = 'en-IN',
  period,
  originalAmountMinor,
  size = 'md',
  className,
}: {
  /** Integer minor units (paise/cents) — never floating-point major units. */
  amountMinor: number;
  currency: CurrencyCode;
  locale?: string;
  period?: string;
  originalAmountMinor?: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const amount = formatMinorUnits(amountMinor, currency, locale);
  const original =
    originalAmountMinor !== undefined && originalAmountMinor > amountMinor
      ? formatMinorUnits(originalAmountMinor, currency, locale)
      : null;
  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-1.5', className)}>
      {original && (
        <s className="text-sm text-fg-subtle">
          <span className="sr-only">{tr('Original price')} </span>
          {original}
        </s>
      )}
      <span
        className={cn(
          'font-semibold text-fg tabular-nums',
          size === 'sm' && 'text-sm',
          size === 'md' && 'text-lg',
          size === 'lg' && 'text-2xl',
        )}
      >
        {original && <span className="sr-only">{tr('Current price')} </span>}
        {amount}
      </span>
      {period && <span className="text-sm text-fg-subtle">{period}</span>}
    </span>
  );
}

export function RatingDisplay({
  value,
  max = 5,
  count,
  size = 'md',
  className,
}: {
  value: number;
  max?: number;
  count?: number;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(max, value));
  const star = size === 'sm' ? 'size-3.5' : 'size-4';
  return (
    <span
      className={cn('inline-flex items-center gap-1.5', className)}
      role="img"
      aria-label={trf('Rated {0} out of {1}{2}', [
        clamped.toFixed(1),
        max,
        count !== undefined ? ` from ${count} reviews` : '',
      ])}
    >
      <span className="relative inline-flex" aria-hidden="true">
        <span className="flex text-border-strong">
          {Array.from({ length: max }, (_, i) => (
            <Star key={i} className={cn(star, 'fill-current')} />
          ))}
        </span>
        <span
          className="absolute inset-0 flex overflow-hidden text-gold-500"
          style={{ width: `${(clamped / max) * 100}%` }}
        >
          {Array.from({ length: max }, (_, i) => (
            <Star key={i} className={cn(star, 'shrink-0 fill-current')} />
          ))}
        </span>
      </span>
      <span aria-hidden="true" className="text-sm font-medium text-fg tabular-nums">
        {clamped.toFixed(1)}
        {count !== undefined && <span className="ml-1 font-normal text-fg-subtle">({count})</span>}
      </span>
    </span>
  );
}
