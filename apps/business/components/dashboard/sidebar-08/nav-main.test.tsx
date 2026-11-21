import { describe, expect, test } from "bun:test";
import type { AccessLevel, NavKey } from "@openbookings/authz/nav-access";
import { LayoutDashboard, HandCoins, Users } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { mockModules } from "@/lib/mock-modules";

await mockModules(import.meta.dir, {
  "next/navigation": () => ({
    // Finance is open, so its pages render.
    usePathname: () => "/dashboard/finance/billing",
    useRouter: () => ({}),
    useSearchParams: () => new URLSearchParams(),
  }),
});

const { NavMain, cantOpenReason } = await import("./nav-main");
const { SidebarProvider } = await import("@/components/ui/sidebar");

const items = [
  { title: "Overview", url: "/dashboard", icon: LayoutDashboard, navKey: "overview" as const },
  {
    title: "Finance",
    url: "#",
    icon: HandCoins,
    items: [
      { title: "Payouts", url: "/dashboard/finance", navKey: "payouts" as const },
      { title: "Billing", url: "/dashboard/finance/billing", navKey: "billing" as const },
    ],
  },
  { title: "Team", url: "/dashboard/team", icon: Users, navKey: "team" as const },
];

const open: Record<NavKey, AccessLevel> = {
  overview: "edit",
  reservations: "edit",
  messages: "edit",
  reviews: "edit",
  property: "edit",
  rooms: "edit",
  rates: "edit",
  pricingRules: "edit",
  analytics: "edit",
  payouts: "edit",
  billing: "edit",
  team: "edit",
};

function render(access: Record<NavKey, AccessLevel>) {
  return renderToStaticMarkup(
    <SidebarProvider>
      <NavMain items={items} access={access} hotelName="Hotel Aurora" />
    </SidebarProvider>,
  );
}

describe("NavMain", () => {
  test("greys out nav items whose access is none", () => {
    const html = render({ ...open, overview: "none", payouts: "none", billing: "view" });
    // Greyed: no link to follow, marked disabled, still focusable.
    expect(html).not.toContain('href="/dashboard"');
    expect(html).not.toContain('href="/dashboard/finance"');
    expect(html.split('aria-disabled="true"').length - 1).toBe(2);
    expect(html.split('tabindex="0"').length - 1).toBe(2);
    // "view" still opens.
    expect(html).toContain('href="/dashboard/finance/billing"');
    expect(html).toContain('href="/dashboard/team"');
    expect(html).toContain("Overview");
    expect(html).toContain("Payouts");
  });

  test("with full access every item is a link", () => {
    const html = render(open);
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/dashboard/finance"');
    expect(html).not.toContain('aria-disabled="true"');
  });

  test("the tooltip names the hotel and the page", () => {
    expect(cantOpenReason("Hotel Aurora", "Payouts")).toBe("Your role at Hotel Aurora can't open Payouts.");
  });
});
