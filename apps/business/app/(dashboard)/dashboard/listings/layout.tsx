import { getHostScopedDb } from "@openbookings/authz";
import { BreadcrumbLabelsProvider } from "@/components/dashboard/breadcrumb-labels";
import { SiteHeader } from "@/components/dashboard/site-header";
import { GetHelpButton } from "@/components/support/get-help-button";
import { getServerSession } from "@/lib/auth";

const TABS = [
  { label: "Rates & Availability", href: "/dashboard/listings/rates-availability" },
  { label: "Property", href: "/dashboard/listings/property" },
  { label: "Rooms", href: "/dashboard/listings/rooms" },
];

/**
 * The host's listing, for the contextual "Get help". Same choice as the
 * editors and the sidebar brand: one property per host today, first by name.
 */
async function loadListing(): Promise<{ id: string; name: string } | null> {
  const session = await getServerSession();
  if (!session) return null;
  return getHostScopedDb(session).queryOne<{ id: string; name: string }>(
    `SELECT p.id::text AS id, p.name FROM properties p WHERE p.owner_user_id = $1 ORDER BY p.name LIMIT 1`,
  );
}

export default async function ListingsLayout({ children }: { children: React.ReactNode }) {
  const listing = await loadListing();
  return (
    <BreadcrumbLabelsProvider>
      <SiteHeader
        title="Listings"
        actions={
          // Renders nothing while support is switched off.
          <GetHelpButton
            category="listing"
            linked={listing ? { type: "listing", id: listing.id, label: listing.name, detail: "" } : null}
            variant="ghost"
          />
        }
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="@container/main flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-4 md:gap-6 md:py-6">{children}</div>
        </div>
      </div>
    </BreadcrumbLabelsProvider>
  );
}
