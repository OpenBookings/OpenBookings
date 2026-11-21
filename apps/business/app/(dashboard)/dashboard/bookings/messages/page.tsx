import { PageHold } from "@/components/dashboard/page-loaders";
import { PageHeader } from "@/components/dashboard/page-header";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import { NoAccessPage } from "@/components/dashboard/no-access-page";
import { pageAccess } from "@/lib/page-access";
import { MessagesView } from "@/components/dashboard/messages/messages-view";
import { loadThreads } from "./_lib/threads";

export default async function MessagesPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const access = await pageAccess("messages");
  if (access.level === "none") {
    return (
      <PageHold id="messages" fill>
        <NoAccessPage navKey="messages" current={access.current} />
      </PageHold>
    );
  }
  // None without a current hotel.
  const { current } = access;
  const threads = current ? await loadThreads(session, current.propertyId) : [];

  return (
    <PageHold id="messages" fill>
      <PageHeader
        title="Messages"
        description="Read and answer your guests' messages here."
        className="shrink-0 px-4 pb-4 md:pb-6 lg:px-6"
      />
      <MessagesView threads={threads} currentUserId={session.user.id} />
    </PageHold>
  );
}
