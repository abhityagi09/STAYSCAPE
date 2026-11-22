import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * Traps Tab focus inside `ref` while active, moves focus in on activation and restores it
 * to the previously focused element on deactivation.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  initialFocus?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const target = initialFocus?.current ?? getFocusable(container)[0] ?? container;
    target.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = getFocusable(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused && document.contains(previouslyFocused))
        previouslyFocused.focus({ preventScroll: true });
    };
  }, [active, ref, initialFocus]);
}

/** Calls `onDismiss` on Escape or on a pointer press outside every ref. */
export function useDismiss(
  refs: Array<RefObject<HTMLElement | null>>,
  onDismiss: () => void,
  active: boolean,
  options: { escape?: boolean; outside?: boolean } = {},
) {
  const callback = useRef(onDismiss);
  useEffect(() => {
    callback.current = onDismiss;
  });

  useEffect(() => {
    if (!active) return;
    const { escape = true, outside = true } = options;
    const onKey = (event: KeyboardEvent) => {
      if (escape && event.key === 'Escape') {
        event.stopPropagation();
        callback.current();
      }
    };
    const onPointer = (event: PointerEvent | MouseEvent) => {
      if (!outside) return;
      const target = event.target as Node;
      if (refs.every((ref) => !ref.current?.contains(target))) callback.current();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
    // refs are stable ref objects
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, options.escape, options.outside]);
}

/** Prevents background scrolling while a modal surface is open. */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const { overflow, paddingRight } = document.body.style;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;
    return () => {
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
    };
  }, [active]);
}
