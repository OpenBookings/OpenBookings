import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { MessageSquare } from "lucide-react";
import { query } from "@openbookings/db";
import { getServerSession } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { EmptyCard, PageHeader } from "../_components/section";
import { GuestMessagesView } from "./_components/GuestMessagesView";
import { GUEST_THREADS_SQL, type GuestThreadItem } from "./_lib/threads";

export const metadata: Metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const session = await getServerSession();
  if (!session) return null; // The layout shows the sign-in form.

  const threads = await query<GuestThreadItem>(GUEST_THREADS_SQL, [session.user.id]);

  return (
    <>
      <PageHeader title="Messages" description="Your conversations with the places you're staying." />
      {threads.length > 0 ? (
        <Suspense>
          <GuestMessagesView threads={threads} currentUserId={session.user.id} />
        </Suspense>
      ) : (
        <EmptyCard
          icon={<MessageSquare aria-hidden />}
          title="No conversations yet"
          body="Questions about a stay? Open the booking and choose Message the property."
          action={
            <Button asChild variant="outline" className="mt-2 h-11">
              <Link href="/account/bookings">Go to your bookings</Link>
            </Button>
          }
        />
      )}
    </>
  );
}
