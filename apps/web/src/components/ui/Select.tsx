import {
  useId,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useDismiss } from '@/hooks/overlay';
import { Field, controlClasses } from './Field';
import { tr } from '@/lib/tr';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<ComponentProps<'select'>, 'id' | 'children'> {
  label: ReactNode;
  options: ReadonlyArray<SelectOption>;
  placeholder?: string;
  hint?: ReactNode;
  error?: string | undefined;
  hideLabel?: boolean;
  id?: string;
  containerClassName?: string;
}

/** Native select: best-in-class keyboard, screen-reader and mobile support. */
export function Select({
  label,
  options,
  placeholder,
  hint,
  error,
  hideLabel,
  id,
  required,
  className,
  containerClassName,
  ...props
}: SelectProps) {
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
          <select
            {...field}
            required={required}
            className={cn(controlClasses, 'appearance-none pr-10', className)}
            {...props}
          >
            {placeholder && <option value="">{placeholder}</option>}
            {options.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-fg-subtle"
            aria-hidden="true"
          />
        </div>
      )}
    </Field>
  );
}

export interface MultiSelectProps<T extends string> {
  label: string;
  options: ReadonlyArray<SelectOption<T>>;
  value: T[];
  onChange: (value: T[]) => void;
  placeholder?: string;
  hint?: string;
  error?: string | undefined;
  disabled?: boolean;
}

/** Accessible multi-select listbox (WAI-ARIA listbox pattern with aria-activedescendant). */
export function MultiSelect<T extends string>({
  label,
  options,
  value,
  onChange,
  placeholder = 'Select…',
  hint,
  error,
  disabled,
}: MultiSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const listId = `${baseId}-list`;
  useDismiss([rootRef], () => setOpen(false), open);

  const toggle = (optionValue: T) => {
    onChange(
      value.includes(optionValue)
        ? value.filter((v) => v !== optionValue)
        : [...value, optionValue],
    );
  };

  const openList = () => {
    if (disabled) return;
    setOpen(true);
    requestAnimationFrame(() => listRef.current?.focus());
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
    const pos = enabled.indexOf(active);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(enabled[Math.min(pos + 1, enabled.length - 1)] ?? active);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(enabled[Math.max(pos - 1, 0)] ?? active);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(enabled[0] ?? 0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(enabled[enabled.length - 1] ?? 0);
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      const option = options[active];
      if (option && !option.disabled) toggle(option.value);
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      setOpen(false);
    }
  };

  const selectedLabels = options.filter((o) => value.includes(o.value));

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1.5">
      <span id={labelId} className="text-sm font-medium text-fg">
        {label}
      </span>
      <button
        type="button"
        className={cn(
          controlClasses,
          'flex h-auto min-h-11 flex-wrap items-center gap-1.5 py-1.5 pr-10 text-left',
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={`${labelId} ${baseId}-value`}
        aria-describedby={error ? `${baseId}-error` : hint ? `${baseId}-hint` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            openList();
          }
        }}
      >
        <span id={`${baseId}-value`} className="flex flex-wrap gap-1.5">
          {selectedLabels.length === 0 ? (
            <span className="text-fg-subtle">{placeholder}</span>
          ) : (
            selectedLabels.map((option) => (
              <span
                key={option.value}
                className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary"
              >
                {option.label}
              </span>
            ))
          )}
        </span>
        <ChevronDown
          className="pointer-events-none absolute right-3.5 size-4 text-fg-subtle"
          aria-hidden="true"
        />
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          aria-labelledby={labelId}
          aria-activedescendant={`${baseId}-opt-${active}`}
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          className="absolute top-full z-30 mt-1 max-h-64 w-full animate-scale-in overflow-auto rounded-lg border border-border bg-surface p-1 shadow-lg focus:outline-none"
        >
          {options.map((option, index) => {
            const selected = value.includes(option.value);
            return (
              // Keyboard interaction is handled on the listbox via aria-activedescendant.
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events
              <li
                key={option.value}
                id={`${baseId}-opt-${index}`}
                role="option"
                aria-selected={selected}
                aria-disabled={option.disabled || undefined}
                onMouseEnter={() => setActive(index)}
                onClick={() => !option.disabled && toggle(option.value)}
                className={cn(
                  'flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm',
                  index === active && 'bg-surface-muted',
                  option.disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                {option.label}
                {selected && <Check className="size-4 text-primary" aria-hidden="true" />}
              </li>
            );
          })}
        </ul>
      )}
      {selectedLabels.length > 0 && !disabled && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="inline-flex w-fit items-center gap-1 text-xs text-fg-subtle hover:text-fg"
        >
          <X className="size-3" aria-hidden="true" /> {tr('Clear selection')}
        </button>
      )}
      {hint && !error && (
        <p id={`${baseId}-hint`} className="text-xs text-fg-subtle">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${baseId}-error`} className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
