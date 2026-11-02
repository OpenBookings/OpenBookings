import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { BedDouble, ChevronDown, Heart, Hotel } from "lucide-react";
import { query } from "@openbookings/db";
import { getServerSession } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LinkTabs } from "../_components/LinkTabs";
import { EmptyCard, PageHeader, RowList } from "../_components/section";
import { UnlikeButton } from "./_components/UnlikeButton";
import { GUEST_LIKES_SQL, LIKES_VIEWS, groupByHotel, parseView, type LikedHotel, type LikedRoomRow } from "./_lib/likes";

export const metadata: Metadata = { title: "Likes" };
export const dynamic = "force-dynamic";

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function Thumb({ src, size, fallback }: { src: string | null; size: number; fallback: React.ReactNode }) {
  return (
    <span
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-secondary text-muted-foreground [&_svg]:size-4"
      style={{ width: size, height: size }}
    >
      {src ? <Image src={src} alt="" fill sizes={`${size}px`} className="object-cover" /> : fallback}
    </span>
  );
}

/** image - room name - like button. The name opens the hotel's rooms. */
function RoomRow({ hotel, room }: { hotel: LikedHotel; room: LikedHotel["rooms"][number] }) {
  return (
    <li className="flex items-center gap-4 px-5 py-3">
      <Thumb src={room.imageUrl} size={48} fallback={<BedDouble aria-hidden />} />
      <Link
        href={`/p/${hotel.slug}#rooms`}
        className="min-w-0 flex-1 truncate text-sm font-medium outline-none hover:underline focus-visible:underline"
      >
        {room.name}
      </Link>
      <UnlikeButton roomId={room.id} roomName={room.name} />
    </li>
  );
}

/** By hotel: one row per hotel that opens to its liked rooms. */
function ByHotel({ hotels }: { hotels: LikedHotel[] }) {
  return (
    <Card className="gap-0 divide-y overflow-hidden py-0">
      {hotels.map((hotel) => (
        <details key={hotel.id} className="group">
          <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-4 transition-colors outline-none hover:bg-accent focus-visible:bg-accent [&::-webkit-details-marker]:hidden">
            <Thumb src={hotel.imageUrl} size={56} fallback={<Hotel aria-hidden />} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{hotel.name}</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {[hotel.city, plural(hotel.rooms.length, "room", "rooms")].filter(Boolean).join(" · ")}
              </p>
            </div>
            <ChevronDown
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <ul className="divide-y border-t bg-muted/30 sm:pl-[72px]">
            {hotel.rooms.map((room) => (
              <RoomRow key={room.id} hotel={hotel} room={room} />
            ))}
          </ul>
        </details>
      ))}
    </Card>
  );
}

/** By room: every liked room, under its hotel's name. */
function ByRoom({ hotels }: { hotels: LikedHotel[] }) {
  return (
    <div className="flex flex-col gap-8">
      {hotels.map((hotel) => (
        <section key={hotel.id} aria-labelledby={`likes-${hotel.id}`} className="flex flex-col gap-3">
          <h2 id={`likes-${hotel.id}`} className="text-base font-semibold">
            <Link href={`/p/${hotel.slug}`} className="outline-none hover:underline focus-visible:underline">
              {hotel.name}
            </Link>
          </h2>
          <RowList>
            <ul className="divide-y">
              {hotel.rooms.map((room) => (
                <RoomRow key={room.id} hotel={hotel} room={room} />
              ))}
            </ul>
          </RowList>
        </section>
      ))}
    </div>
  );
}

export default async function LikesPage({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const session = await getServerSession();
  if (!session) return null; // The layout shows the sign-in form.

  const view = parseView((await searchParams).view);
  const hotels = groupByHotel(await query<LikedRoomRow>(GUEST_LIKES_SQL, [session.user.id]));

  return (
    <>
      <PageHeader title="Likes" description="Rooms you saved with the heart, to come back to." />
      {hotels.length > 0 ? (
        <div className="flex flex-col gap-4">
          <LinkTabs
            label="Show likes"
            tabs={LIKES_VIEWS.map((v) => ({
              href: v.id === "hotel" ? "/account/likes" : `/account/likes?view=${v.id}`,
              title: v.title,
              current: v.id === view,
            }))}
          />
          {view === "hotel" ? <ByHotel hotels={hotels} /> : <ByRoom hotels={hotels} />}
        </div>
      ) : (
        <EmptyCard
          icon={<Heart aria-hidden />}
          title="No likes yet"
          body="Tap the heart on any room while you browse, and it's kept here."
          action={
            <Button asChild variant="outline" className="mt-2 h-11">
              <Link href="/">Find a place to stay</Link>
            </Button>
          }
        />
      )}
    </>
  );
}
