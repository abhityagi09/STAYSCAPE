import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';

interface TooltipProps {
  content: ReactNode;
  /** A single focusable element (button, link...). */
  children: ReactElement<Record<string, unknown>>;
  side?: 'top' | 'bottom';
  delayMs?: number;
}

/** Shows on hover (after a delay) and on keyboard focus; Escape hides. Linked via aria-describedby. */
export function Tooltip({ content, children, side = 'top', delayMs = 300 }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  const show = (delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && hide();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => show(delayMs)}
      onMouseLeave={hide}
      onFocus={() => show(0)}
      onBlur={hide}
    >
      {cloneElement(children, { 'aria-describedby': open ? id : undefined })}
      <span
        id={id}
        role="tooltip"
        hidden={!open}
        className={cn(
          'pointer-events-none absolute left-1/2 z-50 w-max max-w-60 -translate-x-1/2 animate-fade-in rounded-md bg-surface-inverse px-2.5 py-1.5 text-xs text-fg-inverse shadow-md',
          side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
        )}
      >
        {content}
      </span>
    </span>
  );
}
