"use client";

import { useState, useRef, useEffect } from "react";
import { exportRows, type ExportFormat } from "@/lib/exportData";

interface ExportButtonProps<T extends Record<string, unknown>> {
  /** Rows to export. Pass [] to disable. */
  rows: ReadonlyArray<T>;
  /** Filename prefix (timestamp + extension appended automatically). */
  filenameBase: string;
  /** Optional column ordering / projection. */
  columns?: ReadonlyArray<string>;
  /** Restrict offered formats; default: both CSV and JSON. */
  formats?: ReadonlyArray<ExportFormat>;
  /** Custom button label. */
  label?: string;
  /** Override container className for layout integration. */
  className?: string;
}

/**
 * Drop-in export dropdown for any list view. Renders a small button that
 * opens a one-shot menu with format choices; on click it serializes the
 * given rows and triggers a download.
 *
 * Usage:
 *   <ExportButton rows={agents} filenameBase="agents" />
 */
export function ExportButton<T extends Record<string, unknown>>({
  rows,
  filenameBase,
  columns,
  formats = ['csv', 'json'],
  label = 'Export',
  className,
}: ExportButtonProps<T>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const disabled = rows.length === 0;

  return (
    <div ref={containerRef} className={`relative inline-block ${className ?? ''}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        data-testid="export-button"
        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span>{label}</span>
        <span aria-hidden className="opacity-60">▾</span>
      </button>
      {open && (
        <div
          role="menu"
          data-testid="export-menu"
          className="absolute right-0 mt-1 z-50 min-w-[140px] rounded-md border border-white/10 bg-neutral-900 shadow-lg"
        >
          {formats.map((fmt) => (
            <button
              key={fmt}
              type="button"
              role="menuitem"
              data-testid={`export-format-${fmt}`}
              onClick={() => {
                exportRows(rows as ReadonlyArray<Record<string, unknown>>, fmt, filenameBase, columns);
                setOpen(false);
              }}
              className="block w-full text-left px-3 py-1.5 text-sm hover:bg-white/10 first:rounded-t-md last:rounded-b-md"
            >
              {fmt.toUpperCase()}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
