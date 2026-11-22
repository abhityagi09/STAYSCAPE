import { useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useDismiss, useFocusTrap, useScrollLock } from '@/hooks/overlay';
import { IconButton } from './IconButton';

interface OverlayBaseProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Set false for flows that must not be dismissed accidentally (e.g. while saving). */
  dismissible?: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
}

function useOverlay(
  open: boolean,
  onClose: () => void,
  dismissible: boolean,
  initialFocus?: RefObject<HTMLElement | null>,
) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useFocusTrap(panelRef, open, initialFocus);
  useScrollLock(open);
  useDismiss([panelRef], onClose, open && dismissible, { outside: false });
  return { panelRef, titleId, descriptionId };
}

export interface ModalProps extends OverlayBaseProps {
  size?: 'sm' | 'md' | 'lg';
}

const modalSizes = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' };

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  dismissible = true,
  initialFocus,
  size = 'md',
  className,
}: ModalProps) {
  const { panelRef, titleId, descriptionId } = useOverlay(open, onClose, dismissible, initialFocus);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div
        className="absolute inset-0 animate-fade-in bg-overlay backdrop-blur-[2px]"
        aria-hidden="true"
        onClick={dismissible ? onClose : undefined}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[92dvh] w-full animate-rise-in flex-col overflow-hidden rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl',
          modalSizes[size],
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 pt-5 pb-4">
          <div>
            <h2 id={titleId} className="font-display text-xl font-semibold text-fg">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-sm text-fg-muted">
                {description}
              </p>
            )}
          </div>
          {dismissible && (
            <IconButton label="Close dialog" icon={<X />} size="sm" onClick={onClose} />
          )}
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-border bg-surface-muted/50 px-6 py-4 sm:flex-row sm:justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export interface DrawerProps extends OverlayBaseProps {
  side?: 'left' | 'right';
}

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  dismissible = true,
  initialFocus,
  side = 'right',
  className,
}: DrawerProps) {
  const { panelRef, titleId, descriptionId } = useOverlay(open, onClose, dismissible, initialFocus);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 animate-fade-in bg-overlay"
        aria-hidden="true"
        onClick={dismissible ? onClose : undefined}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'absolute inset-y-0 flex w-[min(88vw,24rem)] flex-col bg-surface shadow-xl',
          side === 'right' ? 'right-0 animate-slide-in-right' : 'left-0 animate-slide-in-left',
          className,
        )}
      >
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 id={titleId} className="font-display text-lg font-semibold text-fg">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="text-sm text-fg-muted">
                {description}
              </p>
            )}
          </div>
          {dismissible && <IconButton label="Close" icon={<X />} size="sm" onClick={onClose} />}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-border px-5 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
