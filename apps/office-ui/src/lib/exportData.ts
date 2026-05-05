/**
 * Client-side data export utilities. Pure functions + a `triggerDownload`
 * helper so React components don't need to know about Blob/URL APIs.
 */

/** Convert a record's value into a CSV-safe cell string. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // RFC 4180: quote if the value contains comma, quote, or newline.
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serialize an array of records to CSV. Column set is the union of keys
 * across all rows (so heterogeneous shapes don't drop fields), order
 * preserved by first-occurrence. Pass `columns` to override.
 */
export function toCsv(rows: ReadonlyArray<Record<string, unknown>>, columns?: ReadonlyArray<string>): string {
  if (rows.length === 0) return '';
  const cols = columns ?? Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const header = cols.map(csvCell).join(',');
  const body = rows.map((r) => cols.map((c) => csvCell(r[c])).join(',')).join('\n');
  return `${header}\n${body}`;
}

/** Pretty-printed JSON suitable for download. */
export function toJson(rows: unknown): string {
  return JSON.stringify(rows, null, 2);
}

/**
 * Trigger a browser download of `content` as `filename`. SSR-safe (no-op
 * on server). The blob URL is revoked on the next event-loop tick to free
 * memory; this is reliable because the download is synchronous from the
 * `<a>` click.
 */
export function triggerDownload(content: string, filename: string, mimeType: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export type ExportFormat = 'csv' | 'json';

/**
 * One-call export: serialize + download. Returns the generated content
 * so callers can also push it to clipboard / preview if they want.
 */
export function exportRows(
  rows: ReadonlyArray<Record<string, unknown>>,
  format: ExportFormat,
  filenameBase: string,
  columns?: ReadonlyArray<string>,
): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  if (format === 'csv') {
    const content = toCsv(rows, columns);
    triggerDownload(content, `${filenameBase}-${stamp}.csv`, 'text/csv;charset=utf-8');
    return content;
  }
  const content = toJson(rows);
  triggerDownload(content, `${filenameBase}-${stamp}.json`, 'application/json');
  return content;
}
