import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface TabItem {
  id: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (id: string) => void;
  label: string;
  className?: string;
}

/** WAI-ARIA tabs with roving tabindex and automatic activation. */
export function Tabs({ items, value, defaultValue, onValueChange, label, className }: TabsProps) {
  const [internal, setInternal] = useState(defaultValue ?? items[0]?.id);
  const selected = value ?? internal;
  const baseId = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const select = (id: string) => {
    if (value === undefined) setInternal(id);
    onValueChange?.(id);
    refs.current[id]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const enabled = items.filter((i) => !i.disabled);
    const index = enabled.findIndex((i) => i.id === selected);
    let next: TabItem | undefined;
    if (event.key === 'ArrowRight') next = enabled[(index + 1) % enabled.length];
    else if (event.key === 'ArrowLeft')
      next = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (event.key === 'Home') next = enabled[0];
    else if (event.key === 'End') next = enabled[enabled.length - 1];
    if (next) {
      event.preventDefault();
      select(next.id);
    }
  };

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        className="relative flex gap-1 overflow-x-auto border-b border-border"
      >
        {items.map((item) => {
          const isSelected = item.id === selected;
          return (
            <button
              key={item.id}
              ref={(el) => {
                refs.current[item.id] = el;
              }}
              id={`${baseId}-tab-${item.id}`}
              role="tab"
              type="button"
              aria-selected={isSelected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={isSelected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => select(item.id)}
              onKeyDown={onKeyDown}
              className={cn(
                '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors disabled:opacity-50',
                isSelected
                  ? 'border-primary text-fg'
                  : 'border-transparent text-fg-muted hover:text-fg',
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          id={`${baseId}-panel-${item.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${item.id}`}
          hidden={item.id !== selected}
          tabIndex={0}
          className="pt-6 focus-visible:outline-none"
        >
          {item.id === selected && item.content}
        </div>
      ))}
    </div>
  );
}

export interface AccordionItem {
  id: string;
  title: ReactNode;
  content: ReactNode;
}

interface AccordionProps {
  items: AccordionItem[];
  allowMultiple?: boolean;
  defaultOpen?: string[];
  className?: string;
  headingLevel?: 'h2' | 'h3' | 'h4';
}

export function Accordion({
  items,
  allowMultiple = false,
  defaultOpen = [],
  className,
  headingLevel: Heading = 'h3',
}: AccordionProps) {
  const [open, setOpen] = useState<string[]>(defaultOpen);
  const baseId = useId();
  const toggle = (id: string) =>
    setOpen((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : allowMultiple
          ? [...current, id]
          : [id],
    );

  return (
    <div
      className={cn('divide-y divide-border rounded-xl border border-border bg-surface', className)}
    >
      {items.map((item) => {
        const expanded = open.includes(item.id);
        return (
          <div key={item.id}>
            <Heading className="m-0">
              <button
                type="button"
                id={`${baseId}-h-${item.id}`}
                aria-expanded={expanded}
                aria-controls={`${baseId}-p-${item.id}`}
                onClick={() => toggle(item.id)}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm font-semibold text-fg hover:bg-surface-muted/60"
              >
                {item.title}
                <ChevronDown
                  className={cn(
                    'size-4 shrink-0 text-fg-subtle transition-transform duration-200',
                    expanded && 'rotate-180',
                  )}
                  aria-hidden="true"
                />
              </button>
            </Heading>
            <div
              id={`${baseId}-p-${item.id}`}
              role="region"
              aria-labelledby={`${baseId}-h-${item.id}`}
              hidden={!expanded}
              className="px-5 pb-5 text-sm text-fg-muted"
            >
              {item.content}
            </div>
          </div>
        );
      })}
    </div>
  );
}
