import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { mockModules } from "@/lib/mock-modules";

/** What the page asked the server to do, and every Button it rendered (to press one). */
const connectCalls: { propertyId: string; sendUpcoming: boolean }[] = [];
const buttons: { onClick?: () => void; children?: React.ReactNode }[] = [];

await mockModules(import.meta.dir, {
  "next/navigation": () => ({ useRouter: () => ({ refresh() {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }),
  "../_lib/actions": () => ({
    connectChannelManager: async (input: { propertyId: string; sendUpcoming: boolean }) => {
      connectCalls.push(input);
      return { ok: true };
    },
    disconnectChannelManager: async () => ({ ok: true }),
  }),
  // Records each Button's props so a test can press one; renders a plain button.
  "@/components/ui/button": () => ({
    Button: (all: Record<string, unknown> & { asChild?: boolean; children?: React.ReactNode }) => {
      const props = Object.fromEntries(Object.entries(all).filter(([key]) => !["asChild", "variant", "size"].includes(key)));
      buttons.push(props as (typeof buttons)[number]);
      return all.asChild ? all.children : <button {...(props as React.ComponentProps<"button">)} />;
    },
    buttonVariants: () => "",
  }),
  // The real actions import auth, which throws without its env: nothing to snapshot.
}, ["../_lib/actions"]);

const { ChannelManagerView } = await import("./channel-manager-view");
const { EditAccessProvider } = await import("@/components/dashboard/edit-access");
const { TooltipProvider } = await import("@/components/ui/tooltip");

type Data = NonNullable<React.ComponentProps<typeof ChannelManagerView>["data"]>;

const base: Data = {
  connected: false,
  propertyCode: "OB7F3A2C1D9E",
  timezone: "Europe/Amsterdam",
  appName: "SiteMinder",
  connectedAt: null,
  upcomingCount: 6,
  roomsLinked: 0,
  roomsTotal: 0,
  lastUpdateAt: null,
  needsAttentionCount: 0,
};

function render(data: Data, canEdit = true) {
  return renderToStaticMarkup(
    <TooltipProvider>
      <EditAccessProvider canEdit={canEdit} hotelName="Hotel De Gracht">
        <ChannelManagerView data={data} propertyId="11111111-1111-4111-8111-111111111111" hotelName="Hotel De Gracht" />
      </EditAccessProvider>
    </TooltipProvider>,
  );
}

describe("Channel manager page", () => {
  test("not connected: what changes, the tick box with the real count, and Connect", () => {
    const html = render(base);
    expect(html).toContain("Not connected");
    expect(html).toContain("What changes once connected");
    expect(html).toContain("Send your 6 upcoming bookings to SiteMinder");
    expect(html).toContain("Connect SiteMinder");
    // The code is only shown once connected.
    expect(html).not.toContain("OB7F3A2C1D9E");
    expect(html).not.toContain("Disconnect");
  });

  test("the tick box is hidden when there are no upcoming bookings, and says booking for one", () => {
    expect(render({ ...base, upcomingCount: 0 })).not.toContain("upcoming booking");
    expect(render({ ...base, upcomingCount: 1 })).toContain("Send your 1 upcoming booking to SiteMinder");
  });

  test("view-only: Connect is disabled", () => {
    const html = render(base, false);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Connect SiteMinder/);
  });

  test("setting up: waiting, the hotel code with Copy, three steps, and Disconnect apart", () => {
    const html = render({ ...base, connected: true, upcomingCount: 0, connectedAt: "2026-11-24T12:48:00Z", roomsTotal: 4 });
    expect(html).toContain("Waiting for SiteMinder");
    expect(html).toContain("OB7F3A2C1D9E");
    expect(html).toContain("Copy");
    expect(html).toContain("Add OpenBookings as a channel");
    expect(html).toContain("0 of 4 rooms linked");
    expect(html).toContain("First update from SiteMinder");
    expect(html).toContain("Disconnect SiteMinder");
  });

  test("connected: four facts, needs attention only when there is something", () => {
    const connected = { ...base, connected: true, upcomingCount: 0, connectedAt: "2026-11-24T12:48:00Z", roomsLinked: 4, roomsTotal: 4, lastUpdateAt: "2026-11-20T13:06:00Z" };
    const html = render(connected);
    expect(html).toContain("Connected");
    expect(html).toContain("4 of 4");
    expect(html).toContain("Last update from SiteMinder");
    expect(html).toContain("20 Nov, 14:06");
    expect(html).not.toContain("Needs attention");
    expect(render({ ...connected, needsAttentionCount: 1 })).toContain("1 booking");
  });

  test("Connect sends upcoming bookings by default, also when there is no box to tick (N = 0)", async () => {
    const text = (node: React.ReactNode): string =>
      Array.isArray(node) ? node.map(text).join("") : typeof node === "string" ? node : "";
    for (const upcomingCount of [0, 6]) {
      connectCalls.length = 0;
      buttons.length = 0;
      render({ ...base, upcomingCount });
      const connect = buttons.find((b) => text(b.children).includes("Connect SiteMinder"));
      connect!.onClick!();
      await Promise.resolve();
      expect(connectCalls).toEqual([{ propertyId: "11111111-1111-4111-8111-111111111111", sendUpcoming: true }]);
    }
  });
});
