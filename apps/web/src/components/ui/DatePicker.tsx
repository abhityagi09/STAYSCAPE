import type { ComponentProps, ReactNode } from 'react';
import { CalendarDays } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Field, controlClasses } from './Field';

export interface DatePickerProps extends Omit<ComponentProps<'input'>, 'type' | 'id'> {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  hideLabel?: boolean;
  id?: string;
  containerClassName?: string;
}

/**
 * Calendar-date input (YYYY-MM-DD, no time zone). Built on the native date control, which
 * provides localised, keyboard- and screen-reader-accessible calendars on every platform.
 * Values are property-local calendar dates, never timestamps.
 */
export function DatePicker({
  label,
  hint,
  error,
  hideLabel,
  id,
  required,
  className,
  containerClassName,
  ...props
}: DatePickerProps) {
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      required={required}
      hideLabel={hideLabel}
      id={id}
      className={containerClassName}
    >
      {(field) => (
        <div className="relative">
          <CalendarDays
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-fg-subtle"
            aria-hidden="true"
          />
          <input
            type="date"
            {...field}
            required={required}
            className={cn(controlClasses, 'pl-10 [color-scheme:inherit]', className)}
            {...props}
          />
        </div>
      )}
    </Field>
  );
}

/** Today's date as YYYY-MM-DD in the browser's local calendar. */
export function todayIsoDate(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
