"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import posthog from "posthog-js";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ArchiveIcon,
  BedDoubleIcon,
  GripVerticalIcon,
  ImageIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { archiveRoom, createRoom, reorderRooms, setRoomPublished } from "../_lib/actions";
import { roomSummary } from "../_lib/derive";
import type { RoomsIndexData } from "../_lib/query";
import type { RoomListItem } from "../_lib/types";

const roomHref = (id: string) => `/dashboard/listings/rooms/${id}`;

/**
 * The entry point to the room editor, and the one place room order is set:
 * the order here is the order of the carousel on the guest page.
 *
 * Reordering is drag and drop, with Move up / Move down in the row menu as
 * the keyboard route. Either way the new order is written on drop, and put
 * back if the write is refused.
 */
export function RoomsIndex({ data }: { data: RoomsIndexData }) {
  const router = useRouter();
  const [rooms, setRooms] = React.useState(data.rooms);
  const [creating, setCreating] = React.useState(false);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [archiving, setArchiving] = React.useState<RoomListItem | null>(null);

  // A refresh after any write hands down a new list; it wins over local order.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setRooms(data.rooms), [data.rooms]);

  async function addRoom() {
    setCreating(true);
    const result = await createRoom(data.property.id);
    if (!result.ok) {
      setCreating(false);
      toast.error("Could not add a room type", { description: result.error });
      return;
    }
    posthog.capture("room_created");
    router.push(roomHref(result.roomId));
  }

  async function persistOrder(next: RoomListItem[], previous: RoomListItem[]) {
    setRooms(next);
    const result = await reorderRooms(
      data.property.id,
      next.map((r) => r.id),
    );
    if (!result.ok) {
      setRooms(previous);
      toast.error("Order not saved", { description: result.error });
      return;
    }
    posthog.capture("rooms_reordered");
    router.refresh();
  }

  function move(index: number, to: number) {
    if (to < 0 || to >= rooms.length || to === index) return;
    const next = [...rooms];
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item);
    void persistOrder(next, rooms);
  }

  if (rooms.length === 0) {
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BedDoubleIcon />
          </EmptyMedia>
          <EmptyTitle>No room types yet</EmptyTitle>
          <EmptyDescription>Add the rooms you sell, with their photos and rates.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" onClick={addRoom} disabled={creating}>
            {creating ? <Spinner /> : <PlusIcon />}
            Add room type
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          Guests see your rooms in this order. Drag a row to move it.
        </p>
        <Button size="sm" onClick={addRoom} disabled={creating}>
          {creating ? <Spinner /> : <PlusIcon />}
          Add room type
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead className="w-8">
                <span className="sr-only">Order</span>
              </TableHead>
              <TableHead>Room type</TableHead>
              <TableHead className="text-right">Units</TableHead>
              <TableHead className="text-right">Active rates</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rooms.map((room, index) => (
              <TableRow
                key={room.id}
                draggable
                onDragStart={(e) => {
                  setDragId(room.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => {
                  if (!dragId || dragId === room.id) return;
                  e.preventDefault();
                  // Reorder live while dragging, so the drop lands where it looks.
                  const from = rooms.findIndex((r) => r.id === dragId);
                  if (from === -1 || from === index) return;
                  const next = [...rooms];
                  const [item] = next.splice(from, 1);
                  next.splice(index, 0, item);
                  setRooms(next);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragId(null);
                  if (rooms.map((r) => r.id).join() !== data.rooms.map((r) => r.id).join()) {
                    void persistOrder(rooms, data.rooms);
                  }
                }}
                className={cn(dragId === room.id && "opacity-50")}
              >
                <TableCell className="text-muted-foreground">
                  <GripVerticalIcon className="size-4 cursor-grab" aria-hidden />
                </TableCell>
                <TableCell>
                  <Link
                    href={roomHref(room.id)}
                    className="flex items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
                      {room.coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={room.coverUrl} alt="" className="size-full object-cover" />
                      ) : (
                        <ImageIcon className="size-4 text-muted-foreground" aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{room.name}</span>
                      <span className="block truncate text-muted-foreground text-sm">
                        {roomSummary(room.sizeM2, room.beds, room.legacyBedLabel) || "Size and beds not set"}
                      </span>
                    </span>
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">{room.units}</TableCell>
                <TableCell className="text-right tabular-nums">{room.activeRates}</TableCell>
                <TableCell>
                  <Badge variant={room.status === "published" ? "secondary" : "outline"}>
                    {room.status === "published" ? "Published" : "Draft"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${room.name}`}>
                        <MoreHorizontalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => router.push(roomHref(room.id))}>
                        <PencilIcon />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={index === 0} onSelect={() => move(index, index - 1)}>
                        <ArrowUpIcon />
                        Move up
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={index === rooms.length - 1}
                        onSelect={() => move(index, index + 1)}
                      >
                        <ArrowDownIcon />
                        Move down
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setArchiving(room)}>
                        <ArchiveIcon />
                        Archive
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ArchiveRoomDialog room={archiving} onClose={() => setArchiving(null)} />
    </div>
  );
}

/**
 * Archive is a soft delete, and it is refused while bookings still hold the
 * room. The refusal is not a dead end: the dialog turns into an offer to
 * unpublish, which stops new sales and leaves the booked guests alone.
 */
export function ArchiveRoomDialog({
  room,
  onClose,
  onArchived,
}: {
  room: Pick<RoomListItem, "id" | "name" | "status"> | null;
  onClose: () => void;
  onArchived?: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [blocked, setBlocked] = React.useState<string | null>(null);

  React.useEffect(() => {
    // A fresh dialog for each room, never the last one's refusal.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (room) setBlocked(null);
  }, [room]);

  async function archive() {
    if (!room) return;
    setPending(true);
    const result = await archiveRoom(room.id);
    setPending(false);
    if (!result.ok) {
      if (result.code === "future_bookings") setBlocked(result.error);
      else toast.error("Not archived", { description: result.error });
      return;
    }
    posthog.capture("room_archived");
    toast.success("Room type archived", { description: `${room.name} is no longer listed.` });
    onClose();
    onArchived?.();
    router.refresh();
  }

  async function unpublish() {
    if (!room) return;
    setPending(true);
    const result = await setRoomPublished(room.id, false);
    setPending(false);
    if (!result.ok) {
      toast.error("Not unpublished", { description: result.error });
      return;
    }
    posthog.capture("room_unpublished");
    toast.success("Room type unpublished", { description: "Guests can no longer book it." });
    onClose();
    router.refresh();
  }

  return (
    <AlertDialog open={room !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {blocked ? "This room cannot be archived yet" : `Archive ${room?.name ?? "this room type"}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {blocked ??
              "Guests will no longer see it, and it leaves Rates & Availability. Past bookings keep it on record."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{blocked ? "Close" : "Cancel"}</AlertDialogCancel>
          {!blocked && (
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                // Stay open: the answer may be a refusal the host needs to read.
                e.preventDefault();
                void archive();
              }}
            >
              {pending && <Spinner />}
              Archive
            </AlertDialogAction>
          )}
          {blocked && room?.status === "published" && (
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                void unpublish();
              }}
            >
              {pending && <Spinner />}
              Unpublish instead
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
