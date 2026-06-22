// MusicBrainz OAuth2 service
// Supports two flows:
//   1. Electron: temporary HTTP server on localhost + BrowserWindow (auto)
//   2. Web: OOB flow (user copies code manually)
//
// Register your app at https://musicbrainz.org/account/applications
//   - Type: Public (desktop app)
//   - Redirect URI for Electron: http://localhost:5678 (dynamic port)
//   - Redirect URI for OOB: urn:ietf:wg:oauth:2.0:oob

import { platformFetch } from "./platform-fetch";

const AUTH_BASE = "https://musicbrainz.org/oauth2";
const SCOPE = "tag";

export type MusicBrainzTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  token_type: string;
};

/**
 * Build the MusicBrainz authorize URL for the OOB (out-of-band) flow.
 */
export function buildAuthorizeUrlOob(clientId: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: "urn:ietf:wg:oauth:2.0:oob",
    scope: SCOPE,
  });
  return `${AUTH_BASE}/authorize?${params.toString()}`;
}

/**
 * Build the MusicBrainz authorize URL for the localhost callback flow (Electron).
 */
export function buildAuthorizeUrlLocalhost(clientId: string, port: number): string {
  const redirectUri = `http://127.0.0.1:${port}/oauth2/callback`;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPE,
  });
  return `${AUTH_BASE}/authorize?${params.toString()}`;
}

/**
 * Exchange an authorization code for an access token.
 * Uses `grant_type=authorization_code`.
 *
 * Works from both renderer (via platformFetch) and Electron main.
 */
export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<MusicBrainzTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });

  const response = await platformFetch(`${AUTH_BASE}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Selftify/1.0.0 ( https://github.com/selftify )",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`MusicBrainz token exchange failed (${response.status}): ${errText.slice(0, 300)}`);
  }

  return response.json();
}

/**
 * Refresh an expired access token.
 * Uses `grant_type=refresh_token`.
 *
 * Works from both renderer (via platformFetch) and Electron main.
 */
export async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<MusicBrainzTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await platformFetch(`${AUTH_BASE}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Selftify/1.0.0 ( https://github.com/selftify )",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`MusicBrainz token refresh failed (${response.status}): ${errText.slice(0, 300)}`);
  }

  return response.json();
}

/**
 * Check whether the current token is expired (or expires within the given margin in seconds).
 * Returns true if token should be refreshed.
 */
export function isTokenExpired(expiresAt?: number, marginSeconds = 60): boolean {
  if (!expiresAt) return true;
  return Date.now() + marginSeconds * 1000 >= expiresAt;
}

/**
 * Compute the absolute timestamp when the token expires.
 */
export function computeExpiresAt(expiresIn: number): number {
  return Date.now() + expiresIn * 1000;
}
