import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import { pageAccess } from "@/lib/page-access";
import { NoAccessPage } from "@/components/dashboard/no-access-page";
import { EditAccessProvider } from "@/components/dashboard/edit-access";
import { BreadcrumbLabel } from "@/components/dashboard/breadcrumb-labels";
import { PageHold, PageLoading } from "@/components/dashboard/page-loaders";
import { loadManagedRooms } from "@/lib/apps/managed";
import { RoomEditor } from "../_components/room-editor";
import { loadRoomEditor } from "../_lib/query";

interface PageProps {
  params: Promise<{ roomId: string }>;
}

export default function RoomEditorPage({ params }: PageProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Suspense fallback={<PageLoading id="room" />}>
        <EditorContent params={params} />
      </Suspense>
    </div>
  );
}

async function EditorContent({ params }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const { roomId } = await params;
  // Scoped to the current hotel: another hotel's room, an archived one and a
  // made-up id are all the same 404.
  const access = await pageAccess("rooms");
  if (access.level === "none") {
    return (
      <PageHold id="room" fill>
        <NoAccessPage navKey="rooms" current={access.current} />
      </PageHold>
    );
  }
  const { current } = access;
  const data = await loadRoomEditor(session, current?.propertyId ?? null, roomId);
  if (!data) notFound();
  const managed = current ? await loadManagedRooms(current.propertyId) : null;

  return (
    <>
      <BreadcrumbLabel segment={roomId} label={data.room.name} />
      <PageHold id="room" fill>
        <EditAccessProvider canEdit={access.level === "edit"} hotelName={current?.propertyName}>
          <RoomEditor data={data} managed={managed} />
        </EditAccessProvider>
      </PageHold>
    </>
  );
}
