"use client";

import { useCallback } from "react";

/*
 * Build a Keycloak OIDC authorize URL and redirect the browser to it.
 *
 * Keycloak handles the upstream identity provider plumbing (Google,
 * GitHub, Apple, generic SAML/OIDC). The frontend just needs to point
 * at the realm's auth endpoint with `kc_idp_hint=<alias>` to skip the
 * built-in chooser and go straight to that provider.
 *
 * Operators wire up each provider in the Keycloak admin console
 * (Identity Providers → Add Provider → fill in the OAuth client
 * IDs/secrets the IdP issues). The alias they pick there is what we
 * pass here. Aliases default to the provider's name in Keycloak's
 * UI (`google`, `github`, `apple`, `microsoft`, etc.).
 *
 * The callback flow:
 *   1. user clicks "Sign in with Google" → window.location → Keycloak
 *   2. Keycloak handles upstream OAuth handshake
 *   3. Keycloak redirects back to /login/callback?code=…&state=…
 *   4. /login/callback exchanges the code for tokens and stores them
 *      in useAuthStore, then routes to /office.
 *
 * State parameter doubles as a CSRF defence + a "where to send the user
 * after" carrier; we URL-encode the post-login destination into it.
 */

const DEFAULT_REALM = "urule";
const DEFAULT_CLIENT_ID = "urule-office";

interface SsoLoginOptions {
  /**
   * Keycloak Identity-Provider alias (`google`, `github`, etc.). Omit
   * to land on Keycloak's IdP chooser — useful for the catch-all
   * "Sign in with SSO" button.
   */
  provider?: string;
  /** Where to send the user after a successful login. Default `/office`. */
  redirectAfter?: string;
}

export function buildSsoAuthorizeUrl(options: SsoLoginOptions = {}): string {
  const keycloakUrl = process.env.NEXT_PUBLIC_KEYCLOAK_URL ?? "http://localhost:8281";
  const realm = process.env.NEXT_PUBLIC_KEYCLOAK_REALM ?? DEFAULT_REALM;
  const clientId = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? DEFAULT_CLIENT_ID;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const redirectUri = `${origin}/login/callback`;

  const state = btoa(JSON.stringify({ next: options.redirectAfter ?? "/office", n: cryptoNonce() }));

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: "openid profile email",
    redirect_uri: redirectUri,
    state,
  });
  if (options.provider) {
    params.set("kc_idp_hint", options.provider);
  }
  return `${keycloakUrl}/realms/${realm}/protocol/openid-connect/auth?${params.toString()}`;
}

function cryptoNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Hook returning a stable `signInWith(provider)` callback. Provider is
 * a Keycloak IdP alias; pass `undefined` for the chooser flow.
 */
export function useSsoLogin() {
  return useCallback((provider?: string, redirectAfter?: string) => {
    if (typeof window === "undefined") return;
    window.location.href = buildSsoAuthorizeUrl({ provider, redirectAfter });
  }, []);
}
