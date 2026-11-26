import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { tr } from '@/lib/tr';

export interface FieldRenderProps {
  id: string;
  'aria-invalid': boolean | undefined;
  'aria-describedby': string | undefined;
  'aria-required': boolean | undefined;
}

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  required?: boolean;
  optionalLabel?: boolean;
  hideLabel?: boolean;
  id?: string | undefined;
  className?: string;
  children: (props: FieldRenderProps) => ReactNode;
}

/** Associates a label, hint and error message with a control via ids and ARIA attributes. */
export function Field({
  label,
  hint,
  error,
  required,
  optionalLabel,
  hideLabel,
  id: providedId,
  className,
  children,
}: FieldProps) {
  const generated = useId();
  const id = providedId ?? `field-${generated}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className={cn('text-sm font-medium text-fg', hideLabel && 'sr-only')}>
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
        {optionalLabel && !required && (
          <span className="ml-1.5 text-xs font-normal text-fg-subtle">{tr('(optional)')}</span>
        )}
      </label>
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
        'aria-required': required || undefined,
      })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-fg-subtle">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="flex items-start gap-1 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export const controlClasses =
  'h-11 w-full rounded-lg border border-border-strong bg-surface px-3.5 text-sm text-fg shadow-xs ' +
  'placeholder:text-fg-subtle transition-[border-color,box-shadow] duration-200 ' +
  'hover:border-fg-subtle focus:border-ring focus:ring-3 focus:ring-ring/20 focus:outline-none ' +
  'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70 ' +
  'aria-invalid:border-danger aria-invalid:focus:ring-danger/20';
