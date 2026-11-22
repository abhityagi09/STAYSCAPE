import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** ms; 0 keeps the toast until dismissed. Errors default to 8s, others 5s. */
  duration?: number;
}

interface ToastRecord extends Required<Omit<ToastOptions, 'description'>> {
  id: number;
  description?: string | undefined;
}

interface ToastApi {
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const icons = { info: Info, success: CircleCheck, warning: TriangleAlert, error: CircleAlert };
const tones = {
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-danger',
};

function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.duration);
  const started = useRef(Date.now());

  useEffect(() => {
    if (toast.duration === 0 || paused) return;
    started.current = Date.now();
    const timer = setTimeout(onDismiss, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - started.current;
    };
  }, [paused, toast.duration, onDismiss]);

  const Icon = icons[toast.variant];
  return (
    <li
      role={toast.variant === 'error' ? 'alert' : 'status'}
      aria-atomic="true"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto flex w-full animate-rise-in items-start gap-3 rounded-xl border border-border bg-surface p-4 shadow-lg"
    >
      <Icon className={cn('mt-0.5 size-5 shrink-0', tones[toast.variant])} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">{toast.title}</p>
        {toast.description && <p className="mt-0.5 text-sm text-fg-muted">{toast.description}</p>}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-md p-1 text-fg-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        aria-label="Dismiss notification"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </li>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback(
    (id: number) => setToasts((list) => list.filter((t) => t.id !== id)),
    [],
  );
  const toast = useCallback((options: ToastOptions) => {
    const id = nextId.current++;
    const variant = options.variant ?? 'info';
    const record: ToastRecord = {
      id,
      title: options.title,
      description: options.description,
      variant,
      duration: options.duration ?? (variant === 'error' ? 8000 : 5000),
    };
    setToasts((list) => [...list.slice(-3), record]);
    return id;
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <section
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center p-4 sm:inset-x-auto sm:right-0 sm:justify-end"
      >
        <ol className="flex w-full max-w-sm flex-col gap-2">
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </ol>
      </section>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
}
