import { BreadcrumbLabelsProvider } from "@/components/dashboard/breadcrumb-labels";
import { SiteHeader } from "@/components/dashboard/site-header";
import { GetHelpButton } from "@/components/support/get-help-button";
import { getCurrentProperty } from "@/lib/current-property";

/**
 * The listing for the contextual "Get help": the current hotel, the one the
 * editors and the sidebar brand show. getCurrentProperty already checked the
 * user can read it.
 */
async function loadListing(): Promise<{ id: string; name: string } | null> {
  const current = await getCurrentProperty();
  return current ? { id: current.propertyId, name: current.propertyName } : null;
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
