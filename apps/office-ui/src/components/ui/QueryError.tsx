"use client";

import { cn } from "@/lib/utils";

/*
 * Drop-in error UI for React Query failures.
 *
 *   const { data, isError, error, refetch } = useQuery(...)
 *   if (isError) return <QueryError error={error} onRetry={refetch} />
 *
 * Two layouts:
 *   - default: full-card with icon, title, description, big retry button.
 *     Use for primary list / data surfaces that occupy the page.
 *   - compact: tight inline strip. Use for sidebar widgets or supporting
 *     panels where a full card would dominate.
 *
 * The wired-up ErrorBoundary covers render-time exceptions; this covers
 * the much more common case of a fetch that 4xx/5xx'd. Both render the
 * same retry-and-stay UX so users see a consistent recovery action.
 */

interface QueryErrorProps {
  /** The error from a useQuery / useMutation result. */
  error?: unknown;
  /** Retry handler — typically `refetch` from useQuery. */
  onRetry: () => void;
  /** Override the title; defaults to "Couldn't load data". */
  label?: string;
  /** Compact inline variant (single row) instead of the full card. */
  compact?: boolean;
  className?: string;
}

function getMessage(error: unknown): string | undefined {
  if (!error) return undefined;
  // Axios error shape — server message wins when present.
  const e = error as { response?: { data?: { error?: { message?: string } | string } }; message?: string };
  const data = e.response?.data?.error;
  if (typeof data === "string") return data;
  if (data?.message) return data.message;
  return e.message;
}

export function QueryError({ error, onRetry, label, compact, className }: QueryErrorProps) {
  const message = getMessage(error);

  if (compact) {
    return (
      <div
        role="alert"
        className={cn(
          "flex items-center gap-3 rounded-lg border border-accent-warning/40 bg-accent-warning/5 px-3 py-2",
          className,
        )}
      >
        <span className="icon text-accent-warning text-lg shrink-0">error_outline</span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold">{label ?? "Couldn't load data"}</div>
          {message && <div className="text-[11px] text-text-muted truncate">{message}</div>}
        </div>
        <button
          onClick={onRetry}
          className="text-xs font-bold text-primary hover:text-primary/80 px-2 py-1 rounded transition-colors"
          data-inline
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className={cn(
        "flex items-center justify-center p-8",
        className,
      )}
    >
      <div className="glass-panel rounded-xl p-6 max-w-md w-full text-center space-y-3">
        <div className="inline-flex items-center justify-center size-12 rounded-full bg-accent-warning/10 border border-accent-warning/30">
          <span className="icon text-accent-warning text-2xl">error_outline</span>
        </div>
        <h3 className="text-base font-bold">{label ?? "Couldn't load data"}</h3>
        {message && (
          <p className="text-xs text-text-muted break-words">{message}</p>
        )}
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-background-dark font-bold text-sm px-5 py-2 rounded-xl transition-colors"
        >
          <span className="icon text-[16px]">refresh</span>
          Try again
        </button>
      </div>
    </div>
  );
}
