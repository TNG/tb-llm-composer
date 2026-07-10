import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { endpointOriginPattern, hasEndpointPermission, requestEndpointPermission } from "../hostPermissions";

const originalBrowser = global.browser;

const containsMock = vi.fn();
const requestMock = vi.fn();

beforeEach(() => {
  containsMock.mockReset();
  requestMock.mockReset();
  global.browser = {
    permissions: {
      contains: containsMock,
      request: requestMock,
    },
  } as unknown as typeof browser;
});

afterEach(() => {
  global.browser = originalBrowser;
});

describe("endpointOriginPattern", () => {
  test("builds a scheme+host match pattern from a full endpoint URL", () => {
    expect(endpointOriginPattern("https://chat.model.tngtech.com/v1/chat/completions")).toEqual(
      "https://chat.model.tngtech.com/*",
    );
  });

  test("keeps a non-default port in the pattern", () => {
    expect(endpointOriginPattern("http://localhost:8080/v1/chat/completions")).toEqual("http://localhost:8080/*");
  });

  test("returns null for an unparsable URL", () => {
    expect(endpointOriginPattern("not-a-url")).toBeNull();
  });
});

describe("hasEndpointPermission", () => {
  test("returns true when the origin permission is granted", async () => {
    containsMock.mockResolvedValue(true);

    await expect(hasEndpointPermission("https://chat.model.tngtech.com/v1")).resolves.toBe(true);
    expect(containsMock).toHaveBeenCalledWith({ origins: ["https://chat.model.tngtech.com/*"] });
  });

  test("returns false when the origin permission is not granted", async () => {
    containsMock.mockResolvedValue(false);

    await expect(hasEndpointPermission("https://chat.model.tngtech.com/v1")).resolves.toBe(false);
  });

  test("returns false without querying for an unparsable URL", async () => {
    await expect(hasEndpointPermission("not-a-url")).resolves.toBe(false);
    expect(containsMock).not.toHaveBeenCalled();
  });
});

describe("requestEndpointPermission", () => {
  test("requests the origin permission and returns the grant result", async () => {
    requestMock.mockResolvedValue(true);

    await expect(requestEndpointPermission("https://chat.model.tngtech.com/v1")).resolves.toBe(true);
    expect(requestMock).toHaveBeenCalledWith({ origins: ["https://chat.model.tngtech.com/*"] });
  });

  test("does not pre-check with contains (request must fire synchronously for the user gesture)", async () => {
    requestMock.mockResolvedValue(true);

    await requestEndpointPermission("https://chat.model.tngtech.com/v1");

    expect(containsMock).not.toHaveBeenCalled();
  });

  test("returns false without requesting for an unparsable URL", async () => {
    await expect(requestEndpointPermission("not-a-url")).resolves.toBe(false);
    expect(requestMock).not.toHaveBeenCalled();
  });
});
