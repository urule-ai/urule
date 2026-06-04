import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

/**
 * Resolve the current workspace id for the signed-in user.
 *
 * Hits `GET /api/v1/workspaces/current` — the member-accessible "current
 * workspace" shortcut — NOT the admin-only `GET /workspaces` cross-workspace
 * list (#95). Use the returned id to call workspace-scoped endpoints such as
 * `GET /api/v1/workspaces/:wsId/agents`, and gate dependent queries with
 * `enabled: !!workspaceId` so they don't fire with an undefined id.
 *
 * Returns `undefined` until the workspace resolves. (Demo mode returns the
 * first workspace; when multi-workspace UX lands this becomes session-scoped
 * server-side, and this hook keeps working unchanged.)
 */
export function useWorkspaceId(): string | undefined {
  const { data } = useQuery<{ id: string }>({
    queryKey: ["workspace-current"],
    queryFn: () => api.get("/workspaces/current").then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
  return data?.id;
}
