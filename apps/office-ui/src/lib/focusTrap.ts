/**
 * Lightweight focus-trap helper for modal dialogs. Returns a cleanup
 * function that detaches the trap. Useful for components that don't
 * have only-two-buttons (handled inline) and need full Tab/Shift+Tab
 * cycling within a container.
 *
 * Usage:
 *   useEffect(() => {
 *     if (!open) return;
 *     return trapFocus(containerRef.current!);
 *   }, [open]);
 *
 * The trap:
 *   - Captures Tab + Shift+Tab and bounces focus inside the container's
 *     focusable descendants in DOM order.
 *   - Does NOT auto-focus the first element — the caller is responsible
 *     for setting initial focus.
 *   - Does NOT block clicks; outside-click dismiss is the caller's job.
 */
export function trapFocus(container: HTMLElement): () => void {
  if (typeof document === 'undefined') return () => {};

  const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement as HTMLElement | null;

    if (e.shiftKey) {
      if (active === first || !container.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last || !container.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
