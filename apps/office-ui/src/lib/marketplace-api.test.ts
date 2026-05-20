import { describe, it, expect } from "vitest";
import { extractWidgetManifest, type MarketplacePackage } from "./marketplace-api";

const validWidget = {
  id: "vendor:tasks-overview",
  name: "Tasks",
  version: "0.1.0",
  description: "d",
  author: "a",
  mountPoints: ["sidebar"],
  entryType: "external",
  entryUrl: "https://x/widget.html",
  permissions: [],
  defaultConfig: {},
};

const mkPkg = (manifest: unknown): MarketplacePackage => ({
  id: "p",
  name: "p",
  type: "widget",
  description: "",
  author: "",
  repository: null,
  homepage: null,
  license: null,
  verified: false,
  downloads: 0,
  tags: [],
  publisherPubkey: null,
  pubkeyKind: "",
  licenseTier: "free",
  priceCents: null,
  paymentProvider: null,
  paymentLink: null,
  createdAt: "",
  updatedAt: "",
  latestVersion: { version: "0.1.0", manifest: manifest as Record<string, unknown> },
});

describe("extractWidgetManifest", () => {
  it("returns the embedded manifest for a well-formed package", () => {
    const pkg = mkPkg({ widget: validWidget });
    expect(extractWidgetManifest(pkg)).toEqual(validWidget);
  });

  it("returns null when latestVersion is missing", () => {
    const pkg = mkPkg({ widget: validWidget });
    pkg.latestVersion = undefined;
    expect(extractWidgetManifest(pkg)).toBeNull();
  });

  it("returns null when latestVersion.manifest is null", () => {
    const pkg = mkPkg(null);
    expect(extractWidgetManifest(pkg)).toBeNull();
  });

  it("returns null when widget field is missing", () => {
    const pkg = mkPkg({});
    expect(extractWidgetManifest(pkg)).toBeNull();
  });

  it("returns null when id is missing", () => {
    const { id: _id, ...rest } = validWidget;
    const pkg = mkPkg({ widget: rest });
    expect(extractWidgetManifest(pkg)).toBeNull();
  });

  it("returns null when id is non-string", () => {
    const pkg = mkPkg({ widget: { ...validWidget, id: 123 } });
    expect(extractWidgetManifest(pkg)).toBeNull();
  });

  it("returns null when entryType=external and entryUrl is missing", () => {
    const { entryUrl: _entryUrl, ...rest } = validWidget;
    const pkg = mkPkg({ widget: rest });
    expect(extractWidgetManifest(pkg)).toBeNull();
  });

  it.each([
    ["mountPoints missing", (() => { const { mountPoints: _m, ...r } = validWidget; return r; })()],
    ["mountPoints empty", { ...validWidget, mountPoints: [] }],
    ["permissions missing", (() => { const { permissions: _p, ...r } = validWidget; return r; })()],
    ["defaultConfig missing", (() => { const { defaultConfig: _d, ...r } = validWidget; return r; })()],
  ])("returns null when %s", (_label, widget) => {
    const pkg = mkPkg({ widget });
    expect(extractWidgetManifest(pkg)).toBeNull();
  });
});
