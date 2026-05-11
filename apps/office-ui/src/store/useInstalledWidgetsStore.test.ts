import { beforeEach, describe, it, expect } from "vitest";
import { useInstalledWidgetsStore } from "./useInstalledWidgetsStore";
import type { WidgetManifest } from "@/widgets/types";

const mkManifest = (id: string, version = "0.1.0"): WidgetManifest => ({
  id,
  name: `widget-${id}`,
  version,
  description: "d",
  author: "a",
  mountPoints: ["sidebar"],
  entryType: "native",
  permissions: [],
  defaultConfig: {},
});

beforeEach(() => {
  localStorage.clear();
  useInstalledWidgetsStore.getState().clear();
});

describe("useInstalledWidgetsStore", () => {
  it("install persists into the right workspace bucket", () => {
    const m = mkManifest("alpha");
    useInstalledWidgetsStore.getState().install("ws-1", m);
    const installed = useInstalledWidgetsStore.getState().getInstalled("ws-1");
    expect(installed).toHaveLength(1);
    expect(installed[0]).toEqual(m);
  });

  it("install is idempotent on (workspaceId, manifestId)", () => {
    const v1 = mkManifest("alpha", "0.1.0");
    const v2 = mkManifest("alpha", "0.2.0");
    useInstalledWidgetsStore.getState().install("ws-1", v1);
    useInstalledWidgetsStore.getState().install("ws-1", v2);
    const installed = useInstalledWidgetsStore.getState().getInstalled("ws-1");
    expect(installed).toHaveLength(1);
    expect(installed[0]?.version).toBe("0.2.0");
  });

  it("uninstall removes the entry but keeps the workspace key", () => {
    const m = mkManifest("alpha");
    useInstalledWidgetsStore.getState().install("ws-1", m);
    useInstalledWidgetsStore.getState().uninstall("ws-1", "alpha");
    const state = useInstalledWidgetsStore.getState();
    expect(Object.keys(state.byWorkspace)).toContain("ws-1");
    expect(state.byWorkspace["ws-1"]).toEqual([]);
  });

  it("getInstalled returns empty array for unknown workspaceId", () => {
    expect(useInstalledWidgetsStore.getState().getInstalled("nonexistent")).toEqual([]);
  });

  it("clear wipes all state", () => {
    useInstalledWidgetsStore.getState().install("ws-1", mkManifest("alpha"));
    useInstalledWidgetsStore.getState().install("ws-2", mkManifest("beta"));
    useInstalledWidgetsStore.getState().clear();
    expect(useInstalledWidgetsStore.getState().byWorkspace).toEqual({});
  });

  it("persistence: state survives reload via localStorage", () => {
    const m = mkManifest("alpha");
    useInstalledWidgetsStore.getState().install("ws-1", m);
    const raw = localStorage.getItem("urule-installed-widgets");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.byWorkspace["ws-1"]).toBeDefined();
    expect(parsed.state.byWorkspace["ws-1"][0].id).toBe("alpha");
  });

  it("cross-workspace isolation", () => {
    useInstalledWidgetsStore.getState().install("ws-1", mkManifest("a"));
    useInstalledWidgetsStore.getState().install("ws-2", mkManifest("b"));
    const ws1 = useInstalledWidgetsStore.getState().getInstalled("ws-1");
    const ws2 = useInstalledWidgetsStore.getState().getInstalled("ws-2");
    expect(ws1).toHaveLength(1);
    expect(ws1[0]?.id).toBe("a");
    expect(ws2).toHaveLength(1);
    expect(ws2[0]?.id).toBe("b");
  });
});
