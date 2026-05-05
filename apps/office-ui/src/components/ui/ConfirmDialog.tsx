"use client";

import { useEffect, useRef } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Visual emphasis — `destructive` paints the confirm button red. */
  variant?: 'default' | 'destructive';
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Modal confirmation dialog. Keyboard:
 *   Escape    cancel
 *   Enter     confirm (when the confirm button is focused; default focus
 *             goes to confirm so a user who hits Enter immediately
 *             accepts the default action — typically Yes/Confirm).
 *
 * Click on the backdrop also cancels.
 *
 * Focus management:
 *   - Confirm button gets focus on open.
 *   - Tab cycles between Cancel ↔ Confirm only (focus trap).
 *   - Focus returns to the previously-focused element on close (caller
 *     usually triggers from a button; restoring is the browser default
 *     after this DOM is removed).
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Autofocus confirm on open.
  useEffect(() => {
    if (open) {
      // Defer to next tick so the DOM has mounted.
      setTimeout(() => confirmRef.current?.focus(), 0);
    }
  }, [open]);

  // Escape closes; Tab cycles between confirm + cancel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === 'Tab') {
        // Two-button focus trap: bounce between cancel and confirm.
        e.preventDefault();
        const next = document.activeElement === confirmRef.current ? cancelRef.current : confirmRef.current;
        next?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby={description ? 'confirm-dialog-desc' : undefined}
      data-testid="confirm-dialog"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm mx-4 rounded-lg border border-white/10 bg-neutral-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5">
          <h2 id="confirm-dialog-title" className="text-base font-semibold text-white">{title}</h2>
          {description && (
            <p id="confirm-dialog-desc" className="mt-2 text-sm text-white/70">{description}</p>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-white/10">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            data-testid="confirm-cancel"
            className="px-4 py-2 text-sm rounded-md border border-white/10 hover:bg-white/5"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            data-testid="confirm-confirm"
            className={`px-4 py-2 text-sm rounded-md font-medium ${
              variant === 'destructive'
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-white text-black hover:bg-white/90'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
