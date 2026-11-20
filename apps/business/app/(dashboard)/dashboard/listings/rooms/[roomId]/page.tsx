import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import { BreadcrumbLabel } from "@/components/dashboard/breadcrumb-labels";
import { PageHold, PageLoading } from "@/components/dashboard/page-loaders";
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
  // Host-scoped: another host's room, an archived one and a made-up id are
  // all the same 404.
  const data = await loadRoomEditor(session, roomId);
  if (!data) notFound();

  return (
    <>
      <BreadcrumbLabel segment={roomId} label={data.room.name} />
      <PageHold id="room" fill>
        <RoomEditor data={data} />
      </PageHold>
    </>
  );
}
