import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useDismiss } from '@/hooks/overlay';

export interface DropdownItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface DropdownTriggerProps {
  id: string;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls': string;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  ref: React.RefObject<HTMLButtonElement | null>;
}

export interface DropdownProps {
  trigger: (props: DropdownTriggerProps) => ReactNode;
  items: DropdownItem[];
  align?: 'start' | 'end';
  header?: ReactNode;
  className?: string;
}

/** WAI-ARIA menu button: arrow keys, Home/End, type-to-close with Escape, focus return. */
export function Dropdown({ trigger, items, align = 'end', header, className }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const baseId = useId();
  const menuId = `${baseId}-menu`;

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };
  useDismiss([menuRef, triggerRef], () => close(false), open);

  const enabledIndexes = items.map((item, i) => (item.disabled ? -1 : i)).filter((i) => i >= 0);
  const focusItem = (index: number | undefined) => {
    if (index !== undefined) itemRefs.current[index]?.focus();
  };
  const openMenu = (focus: 'first' | 'last' = 'first') => {
    setOpen(true);
    requestAnimationFrame(() =>
      focusItem(focus === 'first' ? enabledIndexes[0] : enabledIndexes[enabledIndexes.length - 1]),
    );
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    const pos = enabledIndexes.indexOf(current);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusItem(enabledIndexes[(pos + 1) % enabledIndexes.length]);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusItem(enabledIndexes[(pos - 1 + enabledIndexes.length) % enabledIndexes.length]);
        break;
      case 'Home':
        event.preventDefault();
        focusItem(enabledIndexes[0]);
        break;
      case 'End':
        event.preventDefault();
        focusItem(enabledIndexes[enabledIndexes.length - 1]);
        break;
      case 'Escape':
        event.preventDefault();
        close();
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  return (
    <div className={cn('relative inline-flex', className)}>
      {trigger({
        id: `${baseId}-trigger`,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': menuId,
        ref: triggerRef,
        onClick: () => (open ? close(false) : openMenu()),
        onKeyDown: (event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            openMenu('first');
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu('last');
          }
        },
      })}
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          tabIndex={-1}
          aria-labelledby={`${baseId}-trigger`}
          onKeyDown={onMenuKeyDown}
          className={cn(
            'absolute top-full z-40 mt-2 min-w-56 origin-top animate-scale-in rounded-xl border border-border bg-surface p-1.5 shadow-lg',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {header && (
            <div className="border-b border-border px-3 pt-2 pb-2.5" role="presentation">
              {header}
            </div>
          )}
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled}
              onClick={() => {
                close();
                item.onSelect();
              }}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                'focus:bg-surface-muted focus:outline-none hover:bg-surface-muted disabled:opacity-50 [&_svg]:size-4',
                item.danger ? 'text-danger' : 'text-fg',
              )}
            >
              {item.icon && (
                <span aria-hidden="true" className="text-fg-subtle">
                  {item.icon}
                </span>
              )}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
