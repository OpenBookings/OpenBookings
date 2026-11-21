import { Suspense } from "react";
import { redirect } from "next/navigation";
import { BuildingIcon } from "lucide-react";
import { getServerSession } from "@/lib/auth";
import { pageAccess } from "@/lib/page-access";
import { NoAccessPage } from "@/components/dashboard/no-access-page";
import { EditAccessProvider } from "@/components/dashboard/edit-access";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { PageHold, PageLoading } from "@/components/dashboard/page-loaders";
import { RoomsIndex } from "./_components/rooms-index";
import { loadRoomsIndex } from "./_lib/query";

export default function RoomsPage() {
  return (
    // No header bar of its own, like the Property page: the listings
    // layout already names the section.
    <div className="flex min-h-0 flex-1 flex-col">
      <Suspense fallback={<PageLoading id="rooms" />}>
        <IndexContent />
      </Suspense>
    </div>
  );
}

async function IndexContent() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const access = await pageAccess("rooms");
  if (access.level === "none") {
    return (
      <PageHold id="rooms" fill>
        <NoAccessPage navKey="rooms" current={access.current} />
      </PageHold>
    );
  }
  const { current } = access;
  const data = await loadRoomsIndex(session, current?.propertyId ?? null);
  if (!data) return <NoProperty />;

  return (
    <PageHold id="rooms" fill>
      <EditAccessProvider canEdit={access.level === "edit"} hotelName={current?.propertyName}>
        <RoomsIndex data={data} />
      </EditAccessProvider>
    </PageHold>
  );
}

/** Same dead end as the Property page: rooms hang off a property onboarding creates. */
function NoProperty() {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BuildingIcon />
        </EmptyMedia>
        <EmptyTitle>No listing yet</EmptyTitle>
        <EmptyDescription>
          Your property has not been set up. Finish onboarding, or contact support if you have
          already completed it.
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
