/**
 * Handles the optional `<all_urls>` permission needed to reach LLM servers
 * on the local network (i.e. servers that are not on the same machine but
 * reachable only within the LAN).
 *
 * The user explicitly opts in via a checkbox in the options page.
 * Servers running on the same machine (localhost, 127.x.x.x) work without
 * any extra permission and are therefore not covered here.
 */

/**
 * If `allowLocalNetwork` is true, verifies the optional `<all_urls>` permission
 * is already granted. Does NOT prompt the user – permission requests must come
 * from a user-gesture context (options page) and calling
 * `browser.permissions.request()` from the background script silently fails in
 * Thunderbird MV3, causing a generic network error even though the user has
 * already granted the permission.
 *
 * Throws if `allowLocalNetwork` is true but the permission is not (yet) granted,
 * directing the user to the options page.
 * Returns immediately (no-op) when `allowLocalNetwork` is false.
 */
export async function ensureLocalNetworkPermission(allowLocalNetwork: boolean): Promise<void> {
  if (!allowLocalNetwork) {
    return;
  }

  const alreadyGranted = await browser.permissions.contains({ origins: ["<all_urls>"] });
  if (!alreadyGranted) {
    throw new Error(
      "Permission to access local network servers is not granted. " +
        'Please enable "Allow connections to local network" in the extension settings and grant the permission when prompted.',
    );
  }
}

/**
 * Removes the optional `<all_urls>` origin permission that was previously
 * granted for local network access.  Safe to call even if the permission
 * was never granted (no-op in that case).
 */
export async function revokeLocalNetworkPermission(): Promise<void> {
  const isGranted = await browser.permissions.contains({ origins: ["<all_urls>"] });
  if (!isGranted) {
    return;
  }
  await browser.permissions.remove({ origins: ["<all_urls>"] });
}
