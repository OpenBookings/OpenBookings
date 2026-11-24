import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import { pageAccess } from "@/lib/page-access";
import { NoAccessPage } from "@/components/dashboard/no-access-page";
import { EditAccessProvider } from "@/components/dashboard/edit-access";
import { BreadcrumbLabel } from "@/components/dashboard/breadcrumb-labels";
import { PageHold, PageLoading } from "@/components/dashboard/page-loaders";
import { ChannelManagerView } from "./_components/channel-manager-view";
import { loadChannelManager } from "./_lib/data";

export default function ChannelManagerPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Suspense fallback={<PageLoading id="channelManager" />}>
        <ChannelManagerContent />
      </Suspense>
    </div>
  );
}

async function ChannelManagerContent() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const access = await pageAccess("channelManager");
  if (access.level === "none") {
    return (
      <PageHold id="channelManager" fill>
        <NoAccessPage navKey="channelManager" current={access.current} />
      </PageHold>
    );
  }
  // The current hotel, never one named in the URL. The loader does no
  // authorisation of its own: pageAccess has checked this user may open it.
  const { current } = access;
  const data = current ? await loadChannelManager(current.propertyId) : null;

  return (
    <>
      <BreadcrumbLabel segment="channel-manager" label="Channel manager" />
      <PageHold id="channelManager">
        <EditAccessProvider canEdit={access.level === "edit"} hotelName={current?.propertyName}>
          <ChannelManagerView
            data={data}
            propertyId={current?.propertyId ?? null}
            hotelName={current?.propertyName ?? null}
          />
        </EditAccessProvider>
      </PageHold>
    </>
  );
}
