import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { getFocusable, useDismiss } from '@/hooks/overlay';

export interface PopoverTriggerProps {
  'aria-expanded': boolean;
  'aria-controls': string;
  'aria-haspopup': 'dialog';
  onClick: () => void;
  ref: React.RefObject<HTMLButtonElement | null>;
}

interface PopoverProps {
  trigger: (props: PopoverTriggerProps) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  label: string;
  align?: 'start' | 'end';
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Non-modal dialog anchored to a trigger. Focus moves in on open and back on close. */
export function Popover({
  trigger,
  children,
  label,
  align = 'start',
  className,
  open: controlled,
  onOpenChange,
}: PopoverProps) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlled ?? uncontrolled;
  const setOpen = (value: boolean) => {
    if (controlled === undefined) setUncontrolled(value);
    onOpenChange?.(value);
  };
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  // Escape returns focus to the trigger; an outside click leaves focus where the user clicked.
  useDismiss([panelRef, triggerRef], close, open, { outside: false });
  useDismiss([panelRef, triggerRef], () => setOpen(false), open, { escape: false });
  useEffect(() => {
    if (open && panelRef.current) (getFocusable(panelRef.current)[0] ?? panelRef.current).focus();
  }, [open]);

  return (
    <div className="relative">
      {trigger({
        'aria-expanded': open,
        'aria-controls': id,
        'aria-haspopup': 'dialog',
        onClick: () => setOpen(!open),
        ref: triggerRef,
      })}
      {open && (
        <div
          ref={panelRef}
          id={id}
          role="dialog"
          aria-label={label}
          tabIndex={-1}
          className={cn(
            'absolute top-full z-40 mt-2 w-72 animate-scale-in rounded-xl border border-border bg-surface p-4 shadow-lg',
            align === 'end' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}
