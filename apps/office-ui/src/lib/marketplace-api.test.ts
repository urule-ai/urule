import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock axios so the module's clients are stubs whose `.get` we can assert
// against (the existing extractWidgetManifest tests never touch the network,
// so the stub doesn't affect them). `create()` returns one shared instance.
const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock("axios", () => {
  const instance = {
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    get: getMock,
    post: vi.fn(),
    delete: vi.fn(),
  };
  return { default: { create: vi.fn(() => instance) } };
});

import {
  extractWidgetManifest,
  widgetInstallTarget,
  verifyWidgetVersion,
  installWidgetFromPackage,
  type MarketplacePackage,
  type WidgetInstallDeps,
} from "./marketplace-api";

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

describe("widgetInstallTarget (#39 — verify/install version binding)", () => {
  it("returns the manifest and the version from the same pkg.latestVersion", () => {
    const pkg = mkPkg({ widget: validWidget });
    const target = widgetInstallTarget(pkg);
    expect(target).not.toBeNull();
    // The version handed to the caller (to verify) must be exactly the version
    // whose manifest we extracted/install — never a separately-computed one.
    expect(target?.version).toBe(pkg.latestVersion?.version);
    expect(target?.manifest).toEqual(extractWidgetManifest(pkg));
  });

  it("binds version to the manifest's source even when latestVersion differs from the version field inside the manifest", () => {
    // pkg.latestVersion.version (the version packagehub serves + signs) is the
    // authoritative one; the manifest's own embedded `version` is publisher
    // metadata. The target must verify the served version, not the embedded one.
    const pkg = mkPkg({ widget: { ...validWidget, version: "9.9.9" } });
    pkg.latestVersion!.version = "3.0.0";
    expect(widgetInstallTarget(pkg)?.version).toBe("3.0.0");
  });

  it("returns null when there is no manifest (so the install path can't proceed unbound)", () => {
    const pkg = mkPkg({});
    expect(widgetInstallTarget(pkg)).toBeNull();
  });

  it("returns null when latestVersion (hence the version) is missing", () => {
    const pkg = mkPkg({ widget: validWidget });
    pkg.latestVersion = undefined;
    expect(widgetInstallTarget(pkg)).toBeNull();
  });
});

describe("verifyWidgetVersion (#39)", () => {
  beforeEach(() => getMock.mockReset());

  it("hits the packagehub verify endpoint with URL-encoded name + version", async () => {
    getMock.mockResolvedValue({ data: { verified: true, kind: "ed25519", publisher: "pubB64" } });
    const res = await verifyWidgetVersion("vendor/tasks", "1.2.0");
    expect(getMock).toHaveBeenCalledWith("/packages/vendor%2Ftasks/versions/1.2.0/verify");
    expect(res).toEqual({ verified: true, publisher: "pubB64", reason: undefined });
  });

  it("coerces verified to a strict boolean and surfaces the failure reason", async () => {
    getMock.mockResolvedValue({
      data: { verified: false, kind: null, publisher: null, reason: "signature_invalid" },
    });
    const res = await verifyWidgetVersion("w", "0.1.0");
    expect(res.verified).toBe(false);
    expect(res.publisher).toBeNull();
    expect(res.reason).toBe("signature_invalid");
  });

  it("treats a non-true `verified` value as unverified", async () => {
    getMock.mockResolvedValue({ data: { verified: "yes", kind: null, publisher: null } });
    const res = await verifyWidgetVersion("w", "0.1.0");
    expect(res.verified).toBe(false);
  });
});

describe("installWidgetFromPackage (#39 — gate + version binding)", () => {
  const mkDeps = (): WidgetInstallDeps & {
    verify: ReturnType<typeof vi.fn>;
    install: ReturnType<typeof vi.fn>;
    register: ReturnType<typeof vi.fn>;
    onSuccess: ReturnType<typeof vi.fn>;
    onError: ReturnType<typeof vi.fn>;
  } => ({
    verify: vi.fn(),
    install: vi.fn(),
    register: vi.fn(),
    onSuccess: vi.fn(),
    onError: vi.fn(),
  });

  const nativeWidget = {
    ...validWidget,
    entryType: "native",
    componentPath: "builtin/Foo",
    entryUrl: undefined,
  };

  it("verifies the SAME version the manifest came from, then installs + registers", async () => {
    const pkg = mkPkg({ widget: validWidget });
    pkg.latestVersion!.version = "3.0.0"; // served version differs from anything else
    const deps = mkDeps();
    deps.verify.mockResolvedValue({ verified: true, publisher: "pubB64" });

    await installWidgetFromPackage(pkg, "ws-1", deps);

    // Binding regression: verify MUST be called with pkg.latestVersion.version,
    // not a separately-computed "latest". This fails if the call site diverges.
    expect(deps.verify).toHaveBeenCalledWith("p", "3.0.0");
    expect(deps.install).toHaveBeenCalledWith("ws-1", validWidget, {
      verified: true,
      publisher: "pubB64",
    });
    expect(deps.register).toHaveBeenCalledWith(validWidget);
    expect(deps.onSuccess).toHaveBeenCalledOnce();
    expect(deps.onError).not.toHaveBeenCalled();
  });

  it("does NOT install or register an external widget that fails verification (fail-closed)", async () => {
    const pkg = mkPkg({ widget: validWidget });
    const deps = mkDeps();
    deps.verify.mockResolvedValue({ verified: false, publisher: null, reason: "signature_invalid" });

    await installWidgetFromPackage(pkg, "ws-1", deps);

    expect(deps.install).not.toHaveBeenCalled();
    expect(deps.register).not.toHaveBeenCalled();
    expect(deps.onSuccess).not.toHaveBeenCalled();
    expect(deps.onError).toHaveBeenCalledOnce();
  });

  it("treats a thrown verify as unverified (fail-closed)", async () => {
    const pkg = mkPkg({ widget: validWidget });
    const deps = mkDeps();
    deps.verify.mockRejectedValue(new Error("network"));

    await installWidgetFromPackage(pkg, "ws-1", deps);

    expect(deps.install).not.toHaveBeenCalled();
    expect(deps.register).not.toHaveBeenCalled();
    expect(deps.onError).toHaveBeenCalledOnce();
  });

  it("installs a native widget WITHOUT calling verify", async () => {
    const pkg = mkPkg({ widget: nativeWidget });
    const deps = mkDeps();

    await installWidgetFromPackage(pkg, "ws-1", deps);

    expect(deps.verify).not.toHaveBeenCalled();
    expect(deps.install).toHaveBeenCalledWith("ws-1", nativeWidget, {
      verified: true,
      publisher: null,
    });
    expect(deps.register).toHaveBeenCalledWith(nativeWidget);
  });

  it("errors and installs nothing when there is no embedded manifest", async () => {
    const pkg = mkPkg({});
    const deps = mkDeps();

    await installWidgetFromPackage(pkg, "ws-1", deps);

    expect(deps.verify).not.toHaveBeenCalled();
    expect(deps.install).not.toHaveBeenCalled();
    expect(deps.register).not.toHaveBeenCalled();
    expect(deps.onError).toHaveBeenCalledOnce();
  });
});
