/* ------------------------------------------------------------------ *
 * Phase P — H-06: WidgetFrame postMessage / sandbox hardening
 *
 * Pure helpers for WidgetFrame.tsx so we can unit-test the security
 * decisions without a React renderer. Three protections, all flagged
 * by the 2026-05-08 audit:
 *
 *  (a) `postMessage(msg, '*')` sent widget-init (which carries
 *      `permissions`, `config`, `workspaceId`) to **any** origin loaded
 *      in the iframe. Replaced by `widgetTargetOrigin()`, which binds
 *      target origin to the parsed entry URL.
 *
 *  (b) The receive-side filter was `data.widgetId === context.widgetId`
 *      only — no `event.origin` check. Any other window (a popup, a
 *      third-party script, another iframe) could postMessage with the
 *      right widgetId and trigger handlers. Replaced by
 *      `isAllowedFromWidget()`, which compares event.origin to the
 *      expected origin for that entry URL.
 *
 *  (c) `sandbox="allow-scripts allow-same-origin"` lets a same-origin
 *      iframe escape its sandbox per HTML spec. `widgetSandbox()`
 *      drops `allow-same-origin` when the entry resolves to the host
 *      origin; cross-origin widgets keep it (they need their own
 *      storage and can't escape into our origin).
 * ------------------------------------------------------------------ */

/** Resolve entry URL against the host origin and return the parsed origin, or `null` if unparseable. */
export function computeEntryOrigin(entryUrl: string, hostOrigin: string): string | null {
  try {
    return new URL(entryUrl, hostOrigin).origin;
  } catch {
    return null;
  }
}

/** Does the entry URL resolve to the same origin as the host page? */
export function isSameOriginEntry(entryUrl: string, hostOrigin: string): boolean {
  return computeEntryOrigin(entryUrl, hostOrigin) === hostOrigin;
}

/**
 * The `sandbox=` attribute for the iframe. Drops `allow-same-origin`
 * when the embedded document is same-origin to the host — the HTML
 * spec explicitly warns that this combination lets the iframe escape
 * its sandbox (it can `parent.location.reload()` itself out of the
 * sandbox and read parent's localStorage including auth tokens, H-05).
 */
export function widgetSandbox(entryUrl: string, hostOrigin: string): string {
  return isSameOriginEntry(entryUrl, hostOrigin)
    ? "allow-scripts allow-forms"
    : "allow-scripts allow-same-origin allow-forms";
}

/**
 * The string to pass as the second arg to `iframe.contentWindow.postMessage(msg, targetOrigin)`.
 * When the iframe has `allow-same-origin` (cross-origin entries), targetOrigin is its parsed
 * origin. When it doesn't (same-origin entries — see widgetSandbox), the iframe's effective
 * origin is the opaque string `"null"` per HTML spec.
 */
export function widgetTargetOrigin(entryUrl: string, hostOrigin: string): string {
  if (isSameOriginEntry(entryUrl, hostOrigin)) return "null";
  return computeEntryOrigin(entryUrl, hostOrigin) ?? "null";
}

/**
 * Receive-side filter — accept the inbound message only if it came from
 * the origin we expect for this widget. Mirrors `widgetTargetOrigin`.
 */
export function isAllowedFromWidget(
  eventOrigin: string,
  entryUrl: string,
  hostOrigin: string,
): boolean {
  return eventOrigin === widgetTargetOrigin(entryUrl, hostOrigin);
}

/* ------------------------------------------------------------------ *
 * #39 (Q-M-13) — manifest signature gate.
 *
 * `external` widgets load a remote `entryUrl` into an iframe, so the host
 * must confirm the manifest carries a verified publisher signature (checked
 * server-side via packagehub's /verify at install) before instantiating it —
 * otherwise a malicious/tampered manifest could point `entryUrl` at attacker
 * infrastructure. `native` widgets are in-bundle React components (no remote
 * URL) and are always allowed. Fail-closed: an external widget with
 * `verified !== true` is blocked.
 * ------------------------------------------------------------------ */
export type WidgetLoadDecision = { allowed: true } | { allowed: false; reason: "unverified" };

export function widgetLoadDecision(entryType: string, verified: boolean): WidgetLoadDecision {
  if (entryType !== "external") return { allowed: true };
  return verified ? { allowed: true } : { allowed: false, reason: "unverified" };
}
