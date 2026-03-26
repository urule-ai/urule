/**
 * JWT payload from Keycloak OIDC tokens.
 */
export interface UruleJwtPayload {
  /** Subject — the user's unique ID in Keycloak */
  sub: string;
  /** Preferred username */
  preferred_username?: string;
  /** Email address */
  email?: string;
  /** Whether email is verified */
  email_verified?: boolean;
  /** Full name */
  name?: string;
  /** Given name */
  given_name?: string;
  /** Family name */
  family_name?: string;
  /** Realm roles */
  realm_access?: {
    roles: string[];
  };
  /** Client-specific roles */
  resource_access?: Record<string, { roles: string[] }>;
  /** Token issuer (Keycloak realm URL) */
  iss?: string;
  /** Audience */
  aud?: string | string[];
  /** Issued at (epoch seconds) */
  iat?: number;
  /** Expiration (epoch seconds) */
  exp?: number;
  /** Authorized party */
  azp?: string;
  /** Session ID */
  sid?: string;
}

/**
 * Decoded user identity available on authenticated requests.
 */
export interface UruleUser {
  /** User ID (Keycloak subject) */
  id: string;
  /** Username */
  username: string;
  /** Email */
  email: string;
  /** Display name */
  name: string;
  /** Realm roles */
  roles: string[];
}

/**
 * Configuration for the auth middleware plugin.
 */
export interface AuthMiddlewareOptions {
  /**
   * Keycloak JWKS URL for public key fetching.
   * Example: http://localhost:8281/realms/urule/protocol/openid-connect/certs
   */
  jwksUrl?: string;

  /**
   * Keycloak realm URL (used as expected issuer).
   * Example: http://localhost:8281/realms/urule
   */
  issuer?: string;

  /**
   * Expected audience (client ID).
   * @default 'urule-office'
   */
  audience?: string;

  /**
   * Route prefixes that do NOT require authentication.
   * Healthz is always public.
   * @default ['/healthz']
   */
  publicRoutes?: string[];

  /**
   * Skip auth entirely (for development/testing).
   * When true, injects a mock user into every request.
   * @default false
   */
  skipAuth?: boolean;
}
