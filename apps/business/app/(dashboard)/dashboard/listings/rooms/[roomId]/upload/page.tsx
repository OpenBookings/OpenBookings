import { auth } from "@/lib/auth";
import { query } from "@openbookings/db";
import { userOwnsRoom } from "@openbookings/authz";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { RoomImageUploader } from "@/components/upload/RoomImageUploader";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

interface PageProps {
  params: Promise<{ roomId: string }>;
}

export default async function RoomUploadPage({ params }: PageProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { roomId } = await params;

  if (!(await userOwnsRoom(session, roomId))) notFound();

  const existingImages = await query<{ id: string; url: string }>(
    `SELECT id, url FROM room_images WHERE room_id = $1 ORDER BY sort_order`,
    [roomId]
  );

  return (
    <main className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/listings/rooms"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Listings · Rooms
            </p>
            <h1 className="text-2xl font-bold text-foreground">
              Room images
            </h1>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-700 bg-zinc-800/50 p-6">
          <h2 className="mb-1 text-sm font-semibold text-foreground">
            Upload photos
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            JPEG, PNG, and WebP up to 10 MB each.
          </p>
          <RoomImageUploader
            roomId={roomId}
            existingImages={existingImages}
          />
        </div>
      </div>
    </main>
  );
}
