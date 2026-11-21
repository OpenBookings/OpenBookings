import { Suspense } from "react";
import { redirect } from "next/navigation";
import { BuildingIcon } from "lucide-react";
import { query } from "@openbookings/db";
import { propertyReadiness, readinessCopy, readinessEnforced } from "@openbookings/billing/readiness";
import { getServerSession } from "@/lib/auth";
import { pageAccess } from "@/lib/page-access";
import { NoAccessPage } from "@/components/dashboard/no-access-page";
import { EditAccessProvider } from "@/components/dashboard/edit-access";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { PageHold, PageLoading } from "@/components/dashboard/page-loaders";
import { PropertyEditor } from "./_components/property-editor";
import { loadAmenityCatalog, loadEditorData } from "./_lib/query";

export default function PropertyPage() {
  return (
    // No header of its own: the listings layout already renders the section
    // name above this, and a second one only steals pane height.
    <div className="flex min-h-0 flex-1 flex-col">
      <Suspense fallback={<PageLoading id="property" />}>
        <EditorContent />
      </Suspense>
    </div>
  );
}

async function EditorContent() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const access = await pageAccess("property");
  if (access.level === "none") {
    return (
      <PageHold id="property" fill>
        <NoAccessPage navKey="property" current={access.current} />
      </PageHold>
    );
  }
  const { current } = access;
  const [data, amenities] = await Promise.all([
    loadEditorData(session, current?.propertyId ?? null),
    loadAmenityCatalog(),
  ]);

  if (!data) return <NoProperty />;

  // Stripe's own "can this account charge" is left out: the page should not
  // wait on a network call. Publishing makes it.
  const readiness = readinessEnforced()
    ? (
        await propertyReadiness(
          { query: async (text, values) => ({ rows: await query(text, values) }) },
          data.property.id,
        )
      ).missing.map((item) => ({ item, label: readinessCopy(item) }))
    : [];

  return (
    <PageHold id="property" fill>
      <EditAccessProvider canEdit={access.level === "edit"} hotelName={current?.propertyName}>
        <PropertyEditor data={data} amenities={amenities} readiness={readiness} />
      </EditAccessProvider>
    </PageHold>
  );
}

/**
 * Reachable when a host's onboarding predates the promotion in promotion.ts and
 * the backfill has not run for them. Points at support rather than offering a
 * create form: a property created here would bypass the legal and Stripe steps
 * onboarding exists to collect.
 */
function NoProperty() {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BuildingIcon />
        </EmptyMedia>
        <EmptyTitle>No listing yet</EmptyTitle>
        <EmptyDescription>
          Your property has not been set up. Finish onboarding, or contact support if you
          have already completed it.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <a href="/support" className="text-sm underline underline-offset-2 hover:no-underline">
          Contact support
        </a>
      </EmptyContent>
    </Empty>
  );
}
