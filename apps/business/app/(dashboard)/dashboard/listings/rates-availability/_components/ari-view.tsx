"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Monitor } from "lucide-react";
import { AriToolbar } from "./ari-toolbar";
import { AriGrid } from "./ari-grid";
import { AriDetailPanel } from "./ari-detail-panel";
import { AriEditDialogs, type DialogState } from "./edit-dialogs";
import { roomHasIssues } from "../_lib/runs";
import type {
  AriGridData,
  AriSelection,
  EditPrefill,
  RoomTypeRow,
} from "../_lib/types";

/**
 * Client shell for the ARI screen.
 *
 * The date range and stay length live in the URL, not in component state:
 * they change what has to be queried, so they belong to the server round
 * trip — and it makes a particular week shareable and back-button-navigable.
 * Everything that is purely a view concern (collapse, filters, which cell the
 * panel is showing) stays local.
 *
 * Because the page keys this component on the property only, that local state
 * survives every date and stay-length change: filters stay on until the host
 * clears them, which is what "hide the rooms I'm not working on" has to mean
 * for someone stepping week by week through a season.
 */

interface AriViewProps {
  data: AriGridData;
  startDate: string;
  windowDays: number;
}

export function AriView({ data, startDate, windowDays }: AriViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const [expandedRooms, setExpandedRooms] = React.useState<Set<string>>(
    // Collapsed by default: six room types by four rate plans is 24+ rows, and
    // a wall of them is exactly what this screen exists to avoid.
    () => new Set(),
  );
  const [hiddenRoomIds, setHiddenRoomIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [issuesOnly, setIssuesOnly] = React.useState(false);
  const [selection, setSelection] = React.useState<AriSelection | null>(null);
  const [dialog, setDialog] = React.useState<DialogState | null>(null);

  // A selection is a snapshot of a room and a cell from the data it was made
  // against. Once new data arrives the panel would be describing dates that are
  // no longer on screen, so drop it — the remount used to do this for us.
  const [renderedData, setRenderedData] = React.useState(data);
  if (renderedData !== data) {
    setRenderedData(data);
    setSelection(null);
  }

  const updateParams = (next: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) params.set(key, value);
    startTransition(() => router.push(`?${params.toString()}`, { scroll: false }));
  };

  const shiftDays = (days: number) => {
    const date = new Date(`${startDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    updateParams({ start: date.toISOString().split("T")[0] });
  };

  const visibleRooms = React.useMemo(() => {
    let rooms: RoomTypeRow[] = data.rooms.filter(
      (room) => !hiddenRoomIds.has(room.id),
    );
    if (issuesOnly) rooms = rooms.filter(roomHasIssues);
    return rooms;
  }, [data.rooms, hiddenRoomIds, issuesOnly]);

  const filteredData = React.useMemo(
    () => ({ ...data, rooms: visibleRooms }),
    [data, visibleRooms],
  );

  const toggleRoom = (roomId: string) =>
    setExpandedRooms((current) => {
      const next = new Set(current);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });

  const toggleRoomFilter = (roomId: string) =>
    setHiddenRoomIds((current) => {
      const next = new Set(current);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });

  const clearFilters = () => {
    setHiddenRoomIds(new Set());
    setIssuesOnly(false);
  };

  // Panel routes into a modal: close the panel first so focus does not end up
  // trapped between two overlapping Radix dialogs.
  const openDialog = (kind: DialogState["kind"], prefill: EditPrefill = {}) => {
    setSelection(null);
    setDialog({ kind, prefill });
  };

  return (
    <>
      <div className="hidden min-h-0 flex-1 flex-col lg:flex">
        <AriToolbar
          startDate={data.dates[0] ?? startDate}
          endDate={data.dates[data.dates.length - 1] ?? startDate}
          windowDays={windowDays}
          stayLength={data.stayLength}
          rooms={data.rooms}
          hiddenRoomIds={hiddenRoomIds}
          issuesOnly={issuesOnly}
          pending={pending}
          onShift={shiftDays}
          onToday={() =>
            updateParams({ start: new Date().toISOString().split("T")[0] })
          }
          onWindowChange={(days) => updateParams({ days: String(days) })}
          onStayLengthChange={(nights) =>
            updateParams({ stay: String(nights) })
          }
          onToggleRoomFilter={toggleRoomFilter}
          onIssuesOnlyChange={setIssuesOnly}
          onClearFilters={clearFilters}
          onOpenDialog={(kind) => openDialog(kind)}
        />

        <div className="flex min-h-0 flex-1 flex-col p-4 lg:p-6">
          <AriGrid
            data={filteredData}
            expandedRooms={expandedRooms}
            onToggleRoom={toggleRoom}
            onSelect={setSelection}
          />
        </div>
      </div>

      <DesktopOnlyNotice />

      <AriDetailPanel
        selection={selection}
        currency={data.currency}
        stayLength={data.stayLength}
        onClose={() => setSelection(null)}
        onEditAvailability={(prefill) => openDialog("availability", prefill)}
        onEditRestrictions={(prefill) => openDialog("restrictions", prefill)}
        onReopen={(prefill) => openDialog("reopen", prefill)}
      />

      <AriEditDialogs
        state={dialog}
        data={data}
        onClose={() => setDialog(null)}
      />
    </>
  );
}

/**
 * Deliberately not responsive. A 14-column grid squeezed onto a phone is worse
 * than no grid — it invites mis-taps on the one screen where a wrong edit
 * closes real inventory. Say so plainly instead of degrading.
 */
function DesktopOnlyNotice() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center lg:hidden">
      <Monitor className="size-8 text-muted-foreground" aria-hidden />
      <h2 className="font-medium">Open this on a desktop</h2>
      <p className="max-w-sm text-muted-foreground text-sm">
        Rates &amp; availability is a wide, dense grid built for a large screen.
        Open it on a desktop to manage your rates.
      </p>
    </div>
  );
}
