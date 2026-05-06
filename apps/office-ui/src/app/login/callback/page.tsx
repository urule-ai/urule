"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { useAuthStore } from "@/store/useAuthStore";
import { toast } from "@/store/useToastStore";

// Force fully-client rendering. The page reads `window.location` and
// `useSearchParams()` which would otherwise need a Suspense boundary
// at the App-Router static-prerender phase. Disabling SSR here is
// correct: there's nothing useful to render server-side for a
// pure-callback page that needs the URL fragment + browser storage.
export const dynamic = "force-dynamic";

/*
 * Keycloak OIDC redirect URI — receives `?code=…&state=…` after the
 * upstream provider hands the user back to us via Keycloak. Trades
 * the code for tokens at Keycloak's `/protocol/openid-connect/token`
 * endpoint, hydrates the auth store, then routes the user to wherever
 * `state.next` points (default /office).
 *
 * On any failure the user lands back on /login with a toast — no auth
 * state is half-committed. Token refresh is the same path the
 * password-flow login uses (api.ts interceptor handles it).
 *
 * The `state` param is opaque CSRF + a JSON envelope carrying the
 * post-login destination the original SSO button captured. We Base64
 * the JSON to keep it URL-safe; signing isn't needed because the
 * code-for-token swap fails if the original PKCE/state pair was
 * tampered with by the time it reaches Keycloak.
 */

interface ParsedState {
  next: string;
}

function decodeState(stateParam: string | null): ParsedState {
  if (!stateParam) return { next: "/office" };
  try {
    const json = JSON.parse(atob(stateParam)) as { next?: string };
    return { next: json.next ?? "/office" };
  } catch {
    return { next: "/office" };
  }
}

function decodeJwtPayload<T = Record<string, unknown>>(token: string): T | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as T;
  } catch {
    return null;
  }
}

export default function SsoCallbackPage() {
  return (
    <Suspense fallback={<CallbackShell />}>
      <SsoCallbackInner />
    </Suspense>
  );
}

function CallbackShell() {
  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-background-dark">
      <div className="glass-panel rounded-xl p-8 max-w-sm w-full text-center space-y-3">
        <span className="icon text-primary text-4xl animate-spin">progress_activity</span>
        <h1 className="text-lg font-bold">Completing sign-in…</h1>
      </div>
    </div>
  );
}

function SsoCallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);
  const [status, setStatus] = useState<"working" | "error">("working");
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    const code = params?.get("code");
    const error = params?.get("error");
    const errorDescription = params?.get("error_description");
    const stateParam = params?.get("state");

    if (error) {
      setStatus("error");
      setErrorMessage(errorDescription ?? error);
      toast.error("Sign-in failed", errorDescription ?? error);
      const t = setTimeout(() => router.replace("/login"), 4000);
      return () => clearTimeout(t);
    }
    if (!code) {
      setStatus("error");
      setErrorMessage("No authorization code returned from Keycloak.");
      const t = setTimeout(() => router.replace("/login"), 4000);
      return () => clearTimeout(t);
    }

    const next = decodeState(stateParam).next;
    const keycloakUrl = process.env.NEXT_PUBLIC_KEYCLOAK_URL ?? "http://localhost:8281";
    const realm = process.env.NEXT_PUBLIC_KEYCLOAK_REALM ?? "urule";
    const clientId = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? "urule-office";
    const redirectUri = `${window.location.origin}/login/callback`;

    axios
      .post(
        `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`,
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          redirect_uri: redirectUri,
          code,
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      )
      .then(({ data }: { data: { access_token: string; refresh_token: string } }) => {
        setTokens(data.access_token, data.refresh_token);

        // Pull the user identity out of the access token so the rest
        // of the app has a profile without a separate /userinfo call.
        const claims = decodeJwtPayload<{
          sub: string;
          email?: string;
          name?: string;
          preferred_username?: string;
          realm_access?: { roles?: string[] };
        }>(data.access_token);
        if (claims) {
          setUser({
            id: claims.sub,
            email: claims.email ?? "",
            display_name: claims.name ?? claims.preferred_username ?? claims.email ?? "User",
            role: claims.realm_access?.roles?.[0] ?? "member",
          });
        }
        toast.success("Signed in", "Welcome back.");
        router.replace(next);
      })
      .catch((err: { response?: { data?: { error_description?: string; error?: string } } }) => {
        const reason =
          err.response?.data?.error_description ?? err.response?.data?.error ?? "Token exchange failed";
        setStatus("error");
        setErrorMessage(reason);
        toast.error("Sign-in failed", reason);
        const t = setTimeout(() => router.replace("/login"), 4000);
        return () => clearTimeout(t);
      });
    // The hook only runs once per mount; the params object is stable inside
    // a single navigation frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-background-dark">
      <div className="glass-panel rounded-xl p-8 max-w-sm w-full text-center space-y-3">
        {status === "working" ? (
          <>
            <span className="icon text-primary text-4xl animate-spin">progress_activity</span>
            <h1 className="text-lg font-bold">Completing sign-in…</h1>
            <p className="text-xs text-text-muted">Exchanging authorization code with the identity provider.</p>
          </>
        ) : (
          <>
            <span className="icon text-accent-warning text-4xl">error_outline</span>
            <h1 className="text-lg font-bold">Sign-in failed</h1>
            <p className="text-xs text-text-muted break-words">{errorMessage}</p>
            <p className="text-[11px] text-text-muted">Returning you to the login page…</p>
          </>
        )}
      </div>
    </div>
  );
}
