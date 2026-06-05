import { describe, it, expect } from "vitest";
import {
  computeEntryOrigin,
  isAllowedFromWidget,
  isSameOriginEntry,
  widgetSandbox,
  widgetTargetOrigin,
  widgetLoadDecision,
} from "./widget-frame-security";

/* ------------------------------------------------------------------ *
 * Phase P / H-06 regressions. The WidgetFrame previously called
 * `postMessage(..., "*")` (the init payload carries `permissions`,
 * `config`, `workspaceId` — any origin loaded in the iframe could
 * receive it), accepted any inbound message that carried the right
 * `widgetId` (no `event.origin` check), and used
 * `sandbox="allow-scripts allow-same-origin allow-forms"` — which the
 * HTML spec warns lets a same-origin iframe escape its sandbox and
 * read parent's localStorage (and therefore the H-05 tokens).
 * ------------------------------------------------------------------ */

const HOST = "https://urule.example";
const CROSS = "https://widgets.partner.com/widget.html";
const SAME = "https://urule.example/widgets/calendar.html";

describe("computeEntryOrigin", () => {
  it("parses an absolute URL", () => {
    expect(computeEntryOrigin(CROSS, HOST)).toBe("https://widgets.partner.com");
  });

  it("resolves a relative URL against the host origin", () => {
    expect(computeEntryOrigin("/widgets/calendar.html", HOST)).toBe(HOST);
  });

  it("returns null when host base is unusable (defense in depth)", () => {
    // `new URL(rel, host)` is forgiving with the relative part but DOES
    // throw when `host` itself is unparseable. Mirrors the runtime case
    // where `window.location.origin` is somehow blank.
    expect(computeEntryOrigin("/foo", "")).toBeNull();
  });
});

describe("isSameOriginEntry", () => {
  it("true when entry resolves to the host origin", () => {
    expect(isSameOriginEntry(SAME, HOST)).toBe(true);
    expect(isSameOriginEntry("/internal/widget.html", HOST)).toBe(true);
  });

  it("false for cross-origin entries", () => {
    expect(isSameOriginEntry(CROSS, HOST)).toBe(false);
  });
});

describe("widgetSandbox", () => {
  it("drops allow-same-origin for same-origin entries (prevents sandbox escape)", () => {
    const sandbox = widgetSandbox(SAME, HOST);
    expect(sandbox).not.toContain("allow-same-origin");
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).toContain("allow-forms");
  });

  it("keeps allow-same-origin for cross-origin entries (widget needs own storage)", () => {
    const sandbox = widgetSandbox(CROSS, HOST);
    expect(sandbox).toContain("allow-same-origin");
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).toContain("allow-forms");
  });
});

describe("widgetTargetOrigin (postMessage targetOrigin)", () => {
  it("returns the cross-origin entry's parsed origin (not '*')", () => {
    const target = widgetTargetOrigin(CROSS, HOST);
    expect(target).toBe("https://widgets.partner.com");
    expect(target).not.toBe("*");
  });

  it("returns the opaque 'null' for same-origin entries (matches null-origin sandbox)", () => {
    expect(widgetTargetOrigin(SAME, HOST)).toBe("null");
  });

  it("falls back to 'null' (deny-all) when host base is unusable — never '*'", () => {
    const target = widgetTargetOrigin("/foo", "");
    expect(target).toBe("null");
    expect(target).not.toBe("*");
  });
});

describe("isAllowedFromWidget (receive-side origin filter)", () => {
  it("accepts a message from the cross-origin widget's parsed origin", () => {
    expect(isAllowedFromWidget("https://widgets.partner.com", CROSS, HOST)).toBe(true);
  });

  it("rejects a message from any other origin even if widgetId matches downstream", () => {
    expect(isAllowedFromWidget("https://attacker.evil", CROSS, HOST)).toBe(false);
    expect(isAllowedFromWidget(HOST, CROSS, HOST)).toBe(false);
  });

  it("rejects a message from the host page itself for a cross-origin widget", () => {
    // Same-page popups / scripts run in HOST origin; they must not be
    // able to spoof widget:ready by guessing widgetId.
    expect(isAllowedFromWidget(HOST, CROSS, HOST)).toBe(false);
  });

  it("accepts 'null' from sandboxed same-origin widgets and rejects HOST", () => {
    // When the entry is same-origin we drop allow-same-origin, so the
    // iframe is in opaque 'null' origin per HTML spec.
    expect(isAllowedFromWidget("null", SAME, HOST)).toBe(true);
    expect(isAllowedFromWidget(HOST, SAME, HOST)).toBe(false);
  });

  it("defaults to accepting only 'null' when host base is unusable", () => {
    // We default to 'null'; only 'null'-origin messages pass.
    expect(isAllowedFromWidget("https://widgets.partner.com", "/foo", "")).toBe(false);
    expect(isAllowedFromWidget("null", "/foo", "")).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * #39 / Q-M-13 — manifest signature gate.
 * ------------------------------------------------------------------ */
describe("widgetLoadDecision", () => {
  it("always allows native widgets regardless of verification", () => {
    expect(widgetLoadDecision("native", false)).toEqual({ allowed: true });
    expect(widgetLoadDecision("native", true)).toEqual({ allowed: true });
  });

  it("allows an external widget only when verified", () => {
    expect(widgetLoadDecision("external", true)).toEqual({ allowed: true });
  });

  it("blocks an unverified external widget (fail-closed)", () => {
    expect(widgetLoadDecision("external", false)).toEqual({ allowed: false, reason: "unverified" });
  });
});
