import { describe, expect, test } from "bun:test";
import { handleDownload, type DownloadDeps } from "@/lib/billing/download";

const ORG = "org-1";

function deps(over: { role?: string | null; found?: { key: string; filename: string } | null } = {}) {
  const calls = { find: [] as unknown[][], presign: [] as unknown[][] };
  const d: DownloadDeps = {
    scope: async () =>
      over.role === null ? null : { organizationId: ORG, db: { query: async () => ({ rows: [] }) }, memberRole: over.role ?? "finance" },
    find: async (scope, id, file) => {
      calls.find.push([scope.organizationId, id, file]);
      return over.found === undefined ? { key: "invoices/2026/OB-2026-0001.pdf", filename: "OB-2026-0001.pdf" } : over.found;
    },
    presign: async (key, ttl, filename) => {
      calls.presign.push([key, ttl, filename]);
      return `https://r2.test/${key}?sig=x`;
    },
  };
  return { d, calls };
}

describe("invoice download route", () => {
  test("a member with billing:read is redirected to a 300-second link", async () => {
    for (const role of ["owner", "admin", "finance"]) {
      const { d, calls } = deps({ role });
      const res = await handleDownload(d, "inv-1", "pdf");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://r2.test/invoices/2026/OB-2026-0001.pdf?sig=x");
      expect(calls.presign).toEqual([["invoices/2026/OB-2026-0001.pdf", 300, "OB-2026-0001.pdf"]]);
      expect(calls.find).toEqual([[ORG, "inv-1", "pdf"]]);
    }
  });

  test("the csv file is asked for by name", async () => {
    const { d, calls } = deps();
    await handleDownload(d, "inv-1", "csv");
    expect(calls.find[0][2]).toBe("csv");
  });

  test("a role without billing:read gets 404 and nothing is looked up", async () => {
    for (const role of ["manager", "reservations", "frontdesk", "nonsense"]) {
      const { d, calls } = deps({ role });
      const res = await handleDownload(d, "inv-1", "pdf");
      expect(res.status).toBe(404);
      expect(calls.find).toEqual([]);
      expect(calls.presign).toEqual([]);
    }
  });

  test("a member of another organization gets 404 for an invoice", async () => {
    const { d, calls } = deps({ found: null });
    const res = await handleDownload(d, "someone-elses", "pdf");
    expect(res.status).toBe(404);
    expect(calls.presign).toEqual([]);
  });

  test("no session is 401, and an unknown file kind is 404", async () => {
    expect((await handleDownload(deps({ role: null }).d, "inv-1", "pdf")).status).toBe(401);
    expect((await handleDownload(deps().d, "inv-1", "zip")).status).toBe(404);
    expect((await handleDownload(deps().d, "inv-1", null)).status).toBe(404);
  });
});
