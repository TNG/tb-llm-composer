import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ensureLocalNetworkPermission, revokeLocalNetworkPermission } from "../localNetworkPermissions";

const permissionsContainsMock = vi.fn();
const permissionsRequestMock = vi.fn();
const permissionsRemoveMock = vi.fn();

beforeEach(() => {
  global.browser = {
    // @ts-expect-error
    permissions: {
      contains: permissionsContainsMock,
      request: permissionsRequestMock,
      remove: permissionsRemoveMock,
    },
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ensureLocalNetworkPermission", () => {
  test("is a no-op when allowLocalNetwork is false", async () => {
    await ensureLocalNetworkPermission(false);
    expect(permissionsContainsMock).not.toHaveBeenCalled();
    expect(permissionsRequestMock).not.toHaveBeenCalled();
  });

  test("returns without prompting if permission is already granted", async () => {
    permissionsContainsMock.mockResolvedValue(true);

    await ensureLocalNetworkPermission(true);

    expect(permissionsContainsMock).toHaveBeenCalledWith({ origins: ["<all_urls>"] });
    expect(permissionsRequestMock).not.toHaveBeenCalled();
  });

  test("requests permission when not yet granted and user approves", async () => {
    permissionsContainsMock.mockResolvedValue(false);
    permissionsRequestMock.mockResolvedValue(true);

    await ensureLocalNetworkPermission(true);

    expect(permissionsRequestMock).toHaveBeenCalledWith({ origins: ["<all_urls>"] });
  });

  test("throws when user denies the permission request", async () => {
    permissionsContainsMock.mockResolvedValue(false);
    permissionsRequestMock.mockResolvedValue(false);

    await expect(ensureLocalNetworkPermission(true)).rejects.toThrow(
      "Permission to access local network servers was denied",
    );
  });
});

describe("revokeLocalNetworkPermission", () => {
  test("is a no-op when the permission was never granted", async () => {
    permissionsContainsMock.mockResolvedValue(false);

    await revokeLocalNetworkPermission();

    expect(permissionsContainsMock).toHaveBeenCalledWith({ origins: ["<all_urls>"] });
    expect(permissionsRemoveMock).not.toHaveBeenCalled();
  });

  test("removes the permission when it is currently granted", async () => {
    permissionsContainsMock.mockResolvedValue(true);
    permissionsRemoveMock.mockResolvedValue(undefined);

    await revokeLocalNetworkPermission();

    expect(permissionsRemoveMock).toHaveBeenCalledWith({ origins: ["<all_urls>"] });
  });
});
