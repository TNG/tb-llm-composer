/**
 * Host-permission helpers for the configured LLM endpoint.
 *
 * In a Thunderbird/Firefox MV3 extension, entries in `host_permissions` are opt-in: they are
 * NOT granted at install time. Until the user grants the origin, even background-context
 * `fetch`es to it are subject to CORS and get blocked ("Access-Control-Allow-Origin missing").
 * These helpers derive the endpoint origin and let us check/request that permission.
 */

/** Build an origin match pattern (`scheme://host/*`) for the endpoint URL, or null if unparsable. */
export function endpointOriginPattern(endpointUrl: string): string | null {
  try {
    const url = new URL(endpointUrl);
    // Use hostname (never host): WebExtension match patterns don't allow ports.
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return null;
  }
}

/** Whether the host permission for the endpoint's origin is currently granted. */
export async function hasEndpointPermission(endpointUrl: string): Promise<boolean> {
  const origin = endpointOriginPattern(endpointUrl);
  if (!origin) return false;
  return browser.permissions.contains({ origins: [origin] });
}

/**
 * Request the host permission for the endpoint's origin (idempotent: resolves true without a
 * prompt if already granted). `browser.permissions.request` requires an active user gesture and
 * Firefox drops that flag across `await`, so this issues the request synchronously (no pre-check)
 * and must be called before any other await in a user-input handler (e.g. the options page).
 */
export function requestEndpointPermission(endpointUrl: string): Promise<boolean> {
  const origin = endpointOriginPattern(endpointUrl);
  if (!origin) return Promise.resolve(false);
  return browser.permissions.request({ origins: [origin] });
}
