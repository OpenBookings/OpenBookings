import { describe, expect, mock, test } from "bun:test";
import type { SwitchableProperty } from "@openbookings/authz";
import { renderToStaticMarkup } from "react-dom/server";
import { mockModules } from "@/lib/mock-modules";

await mockModules(import.meta.dir, {
  "next/navigation": () => ({
    usePathname: () => "/dashboard/bookings/reservations",
    useRouter: () => ({}),
    useSearchParams: () => new URLSearchParams(),
    unstable_rethrow: () => {},
  }),
  "@/lib/switch-property": () => ({ switchProperty: async () => ({ ok: false }) }),
});

const { PropertySwitcher, PropertyList, pickHotel } = await import("./property-switcher");
const { SidebarProvider } = await import("@/components/ui/sidebar");

let next = 0;
const hotel = (propertyName: string, organizationName: string, role = "owner"): SwitchableProperty => ({
  propertyId: `p-${++next}`,
  propertyName,
  logoUrl: "https://cdn.openbookings.co/uploads/logo.png",
  organizationId: `org-${organizationName}`,
  organizationName,
  role,
  hasPropertyAccess: true,
});

const aurora = hotel("Hotel Aurora", "Aurora BV", "frontdesk");
const borealis = hotel("Hotel Borealis", "Aurora BV", "owner,finance");
const canal = hotel("Hotel Prinsengracht", "Canal Group", "manager");

function header(properties: SwitchableProperty[], current: SwitchableProperty | null) {
  return renderToStaticMarkup(
    <SidebarProvider>
      <PropertySwitcher properties={properties} current={current} />
    </SidebarProvider>,
  );
}

const list = (properties: SwitchableProperty[], currentId = properties[0]!.propertyId) =>
  renderToStaticMarkup(<PropertyList properties={properties} currentId={currentId} onSelect={() => {}} />);

describe("the sidebar header", () => {
  test("single-property user renders the plain brand without a chevron", () => {
    const html = header([aurora], aurora);
    expect(html).toContain("Hotel Aurora");
    expect(html).toContain("Aurora BV");
    expect(html).not.toContain("lucide-chevrons-up-down");
    expect(html).not.toContain("<button");
  });

  test("shows no hotel logo, for one hotel or many", () => {
    expect(header([aurora], aurora)).not.toContain("uploads/logo.png");
    expect(header([aurora, canal], aurora)).not.toContain("uploads/logo.png");
  });

  test("two hotels: the header is the switcher", () => {
    const html = header([aurora, canal], aurora);
    expect(html).toContain("Hotel Aurora");
    expect(html).toContain("Aurora BV");
    expect(html).toContain("lucide-chevrons-up-down");
    expect(html).toContain('aria-haspopup="dialog"');
  });

  test("no hotel yet: the plain OpenBookings mark", () => {
    const html = header([], null);
    expect(html).toContain("OpenBookings");
    expect(html).not.toContain("lucide-chevrons-up-down");
    expect(html).not.toContain("<button");
  });
});

describe("the hotel list", () => {
  test("groups hotels by organization with role labels", () => {
    const html = list([aurora, borealis, canal]);
    expect(html).toContain('cmdk-group-heading=""');
    const auroraHeading = html.indexOf(">Aurora BV<");
    const canalHeading = html.indexOf(">Canal Group<");
    expect(auroraHeading).toBeGreaterThan(-1);
    expect(canalHeading).toBeGreaterThan(auroraHeading);
    expect(html.indexOf("Hotel Borealis")).toBeLessThan(canalHeading);
    expect(html).toContain("Front desk");
    expect(html).toContain("Owner and Back office");
    expect(html).toContain("Manager");
  });

  test("marks the current hotel", () => {
    const html = list([aurora, borealis, canal], borealis.propertyId);
    expect(html.split("Current hotel").length - 1).toBe(1);
    expect(html.indexOf("Current hotel")).toBeGreaterThan(html.indexOf("Hotel Borealis"));
    expect(html.indexOf("Current hotel")).toBeLessThan(html.indexOf("Hotel Prinsengracht"));
  });

  test("one company: a flat list without headings", () => {
    const html = list([aurora, borealis]);
    expect(html).not.toContain('cmdk-group-heading=""');
    expect(html).toContain("Hotel Borealis");
  });

  test("shows search from 8 hotels", () => {
    const many = Array.from({ length: 8 }, (_, i) => hotel(`Hotel ${i}`, "Canal Group"));
    expect(list(many.slice(0, 7))).not.toContain("Find a hotel");
    expect(list(many)).toContain("Find a hotel");
  });
});

describe("picking a hotel", () => {
  const RETURN_TO = "/dashboard/bookings/reservations/abc";

  function pick(
    property: SwitchableProperty,
    switchProperty: (id: string, returnTo: string) => Promise<{ ok: false } | undefined>,
    rethrow: (error: unknown) => void = () => {},
  ) {
    const log: string[] = [];
    let attempt: Promise<void> = Promise.resolve();
    const deps = {
      close: () => log.push("close"),
      begin: (p: SwitchableProperty, run: () => Promise<void>) => {
        log.push(`begin ${p.propertyName}`);
        attempt = run();
      },
      switchProperty: mock(switchProperty),
      fail: (p: SwitchableProperty) => log.push(`fail ${p.propertyName}`),
      rethrow,
    };
    pickHotel(property, aurora.propertyId, RETURN_TO, deps);
    return { log, deps, done: () => attempt };
  }

  test("another hotel: switches on the server with the current path", async () => {
    // A switch redirects, which never resolves with a result.
    const { log, deps, done } = pick(canal, async () => undefined);
    await done();
    expect(deps.switchProperty).toHaveBeenCalledWith(canal.propertyId, RETURN_TO);
    expect(log).toEqual(["close", "begin Hotel Prinsengracht"]);
  });

  test("the current hotel: just closes the list", async () => {
    const { log, deps, done } = pick(aurora, async () => undefined);
    await done();
    expect(deps.switchProperty).not.toHaveBeenCalled();
    expect(log).toEqual(["close"]);
  });

  test("a refusal fails", async () => {
    const { log, done } = pick(canal, async () => ({ ok: false }));
    await done();
    expect(log).toEqual(["close", "begin Hotel Prinsengracht", "fail Hotel Prinsengracht"]);
  });

  test("a thrown error fails instead of reaching the error boundary", async () => {
    const { log, done } = pick(canal, async () => {
      throw new Error("offline");
    });
    await done();
    expect(log).toEqual(["close", "begin Hotel Prinsengracht", "fail Hotel Prinsengracht"]);
  });

  test("a redirect is rethrown for Next to follow", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    const { log, done } = pick(
      canal,
      async () => {
        throw redirect;
      },
      (error) => {
        if (error === redirect) throw error;
      },
    );
    await expect(done()).rejects.toBe(redirect);
    expect(log).toEqual(["close", "begin Hotel Prinsengracht"]);
  });
});
