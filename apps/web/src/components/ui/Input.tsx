import { useState, type ComponentProps, type ReactNode } from 'react';
import { Check, Eye, EyeOff, X } from 'lucide-react';
import { PASSWORD_RULES } from '@stayscape/shared';
import { cn } from '@/lib/cn';
import { Field, controlClasses } from './Field';

export interface InputProps extends Omit<ComponentProps<'input'>, 'id'> {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  hideLabel?: boolean;
  optionalLabel?: boolean;
  leadingIcon?: ReactNode;
  trailing?: ReactNode;
  id?: string;
  containerClassName?: string;
}

export function Input({
  label,
  hint,
  error,
  hideLabel,
  optionalLabel,
  leadingIcon,
  trailing,
  id,
  required,
  className,
  containerClassName,
  ...props
}: InputProps) {
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      required={required}
      hideLabel={hideLabel}
      optionalLabel={optionalLabel}
      id={id}
      className={containerClassName}
    >
      {(field) => (
        <div className="relative">
          {leadingIcon && (
            <span
              className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-fg-subtle [&_svg]:size-4"
              aria-hidden="true"
            >
              {leadingIcon}
            </span>
          )}
          <input
            {...field}
            required={required}
            className={cn(
              controlClasses,
              leadingIcon ? 'pl-10' : undefined,
              trailing ? 'pr-11' : undefined,
              className,
            )}
            {...props}
          />
          {trailing && (
            <span className="absolute inset-y-0 right-1 flex items-center">{trailing}</span>
          )}
        </div>
      )}
    </Field>
  );
}

export interface PasswordInputProps extends Omit<InputProps, 'type' | 'trailing'> {
  /** Show the live password-policy checklist (registration / reset). */
  showRequirements?: boolean;
}

export function PasswordInput({
  showRequirements,
  hint,
  value,
  onChange,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState('');
  const text = typeof value === 'string' ? value : current;

  return (
    <div className="flex flex-col gap-2">
      <Input
        {...props}
        value={value}
        onChange={(event) => {
          setCurrent(event.target.value);
          onChange?.(event);
        }}
        type={visible ? 'text' : 'password'}
        hint={hint}
        trailing={
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="inline-flex size-9 items-center justify-center rounded-md text-fg-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
          >
            {visible ? (
              <EyeOff className="size-4" aria-hidden="true" />
            ) : (
              <Eye className="size-4" aria-hidden="true" />
            )}
          </button>
        }
      />
      {showRequirements && (
        <ul
          className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2"
          aria-label="Password requirements"
        >
          {PASSWORD_RULES.map((rule) => {
            const met = rule.test(text);
            return (
              <li
                key={rule.id}
                className={cn('flex items-center gap-1.5', met ? 'text-success' : 'text-fg-subtle')}
              >
                {met ? (
                  <Check className="size-3.5" aria-hidden="true" />
                ) : (
                  <X className="size-3.5" aria-hidden="true" />
                )}
                <span>
                  {rule.label}
                  <span className="sr-only">{met ? ' (met)' : ' (not met)'}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export interface TextareaProps extends Omit<ComponentProps<'textarea'>, 'id'> {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  id?: string;
}

export function Textarea({ label, hint, error, id, required, className, ...props }: TextareaProps) {
  return (
    <Field label={label} hint={hint} error={error} required={required} id={id}>
      {(field) => (
        <textarea
          {...field}
          required={required}
          className={cn(controlClasses, 'h-auto min-h-28 py-2.5', className)}
          {...props}
        />
      )}
    </Field>
  );
}
