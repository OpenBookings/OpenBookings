import { describe, expect, test } from "bun:test";
import { createGuestAuth } from "./guest";
import { createHostAuth } from "./host";

// Constructing an instance never touches the database (pg pools connect
// lazily), so the factories can be exercised against a dead connection
// string.
const base = {
  baseURL: "http://app.localhost:3002",
  secret: "test-secret-test-secret-test-secret-1234",
  databaseUrl: "postgres://unused:unused@127.0.0.1:1/unused",
  sendMagicLink: async () => {},
  cookiePrefix: "ob-guest",
};

describe("factory plugin surface", () => {
  test("guest instance mounts no organization endpoints", () => {
    const guest = createGuestAuth(base);
    expect("createOrganization" in guest.api).toBe(false);
    expect("listOrganizations" in guest.api).toBe(false);
  });

  test("host instance mounts organization endpoints", () => {
    const host = createHostAuth({ ...base, cookiePrefix: "ob-host" });
    expect("createOrganization" in host.api).toBe(true);
    expect("listOrganizations" in host.api).toBe(true);
  });

  test("both instances mount magic link", () => {
    const guest = createGuestAuth(base);
    const host = createHostAuth({ ...base, cookiePrefix: "ob-host" });
    expect("signInMagicLink" in guest.api).toBe(true);
    expect("signInMagicLink" in host.api).toBe(true);
  });

  test("admin endpoints exist only on the host instance", () => {
    const guest = createGuestAuth(base);
    const host = createHostAuth({ ...base, cookiePrefix: "ob-host" });
    expect("impersonateUser" in host.api).toBe(true);
    expect("setRole" in host.api).toBe(true);
    expect("impersonateUser" in guest.api).toBe(false);
    expect("setRole" in guest.api).toBe(false);
  });

  test("an organization route on the guest handler returns 404", async () => {
    const guest = createGuestAuth(base);
    const response = await guest.handler(
      new Request("http://app.localhost:3002/api/auth/organization/list"),
    );
    expect(response.status).toBe(404);
  });
});
