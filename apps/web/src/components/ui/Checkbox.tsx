import { useId, type ComponentProps, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface CheckboxProps extends Omit<ComponentProps<'input'>, 'type' | 'id'> {
  label: ReactNode;
  description?: ReactNode;
  error?: string | undefined;
  id?: string;
}

export function Checkbox({ label, description, error, id, className, ...props }: CheckboxProps) {
  const generated = useId();
  const inputId = id ?? `cb-${generated}`;
  const descriptionId = description ? `${inputId}-desc` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-start gap-3">
        <span className="relative mt-0.5 inline-flex size-5 shrink-0">
          <input
            id={inputId}
            type="checkbox"
            aria-invalid={error ? true : undefined}
            aria-describedby={[errorId, descriptionId].filter(Boolean).join(' ') || undefined}
            className="peer size-5 cursor-pointer appearance-none rounded-[6px] border border-border-strong bg-surface transition-colors checked:border-primary checked:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger"
            {...props}
          />
          <Check
            className="pointer-events-none absolute inset-0 m-auto size-3.5 text-primary-fg opacity-0 peer-checked:opacity-100"
            strokeWidth={3}
            aria-hidden="true"
          />
        </span>
        <span className="flex flex-col">
          <label htmlFor={inputId} className="cursor-pointer text-sm font-medium text-fg">
            {label}
          </label>
          {description && (
            <span id={descriptionId} className="text-xs text-fg-subtle">
              {description}
            </span>
          )}
        </span>
      </div>
      {error && (
        <p id={errorId} className="pl-8 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export interface RadioOption<T extends string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps<T extends string> {
  legend: ReactNode;
  name: string;
  options: ReadonlyArray<RadioOption<T>>;
  value: T | undefined;
  onChange: (value: T) => void;
  orientation?: 'vertical' | 'horizontal';
  error?: string | undefined;
  hint?: ReactNode;
}

/** Native radios inside a fieldset: arrow-key navigation comes from the browser. */
export function RadioGroup<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  orientation = 'vertical',
  error,
  hint,
}: RadioGroupProps<T>) {
  const baseId = useId();
  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-describedby={error ? `${baseId}-error` : undefined}
    >
      <legend className="mb-1 text-sm font-medium text-fg">{legend}</legend>
      {hint && <p className="-mt-1 mb-1 text-xs text-fg-subtle">{hint}</p>}
      <div className={cn('flex gap-2', orientation === 'vertical' ? 'flex-col' : 'flex-wrap')}>
        {options.map((option) => {
          const id = `${baseId}-${option.value}`;
          const checked = value === option.value;
          return (
            <label
              key={option.value}
              htmlFor={id}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors',
                checked
                  ? 'border-primary bg-primary-soft'
                  : 'border-border hover:border-border-strong',
                option.disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                disabled={option.disabled}
                onChange={() => onChange(option.value)}
                className="mt-0.5 size-4 shrink-0 cursor-pointer appearance-none rounded-full border border-border-strong bg-surface checked:border-[5px] checked:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
              <span className="flex flex-col">
                <span className="text-sm font-medium text-fg">{option.label}</span>
                {option.description && (
                  <span className="text-xs text-fg-subtle">{option.description}</span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      {error && (
        <p id={`${baseId}-error`} className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}
