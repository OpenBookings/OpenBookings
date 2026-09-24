"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Monitor } from "lucide-react";
import { toast } from "sonner";
import { AriToolbar } from "./ari-toolbar";
import { AriGrid } from "./ari-grid";
import { AriDetailPanel } from "./ari-detail-panel";
import { AriEditDialogs, type DialogState } from "./edit-dialogs";
import { RangeActionBar } from "./range-action-bar";
import { roomHasIssues } from "../_lib/runs";
import { useAriDraft } from "../_lib/use-ari-draft";
import { publishAriChanges } from "../_lib/actions";
import type {
  AriGridData,
  AriSelection,
  EditPrefill,
  RangeSelection,
  RatePlanRow,
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
  const draft = useAriDraft();
  const [publishing, setPublishing] = React.useState(false);
  const [range, setRange] = React.useState<RangeSelection | null>(null);
  /**
   * Where the next shift-click measures from.
   *
   * State rather than a ref: it is reset in the same render-phase sync that
   * drops the selection when new data arrives, and a ref cannot be written
   * during render.
   */
  const [anchor, setAnchor] = React.useState<{
    planId: string;
    col: number;
  } | null>(null);

  /**
   * Plain click moves the anchor; shift-click spans from it.
   *
   * The anchor is per rate plan, so shift-clicking on a different row starts
   * that row's range rather than drawing a rectangle across two plans that
   * have nothing to do with each other.
   */
  const selectRange = (
    room: RoomTypeRow,
    plan: RatePlanRow,
    col: number,
    extend: boolean,
  ) => {
    if (extend && anchor && anchor.planId === plan.id) {
      setRange({
        room,
        plan,
        startIndex: Math.min(anchor.col, col),
        endIndex: Math.max(anchor.col, col),
      });
      return;
    }
    setAnchor({ planId: plan.id, col });
    setRange(null);
  };

  // A selection is a snapshot of a room and a cell from the data it was made
  // against. Once new data arrives the panel would be describing dates that are
  // no longer on screen, so drop it — the remount used to do this for us.
  const [renderedData, setRenderedData] = React.useState(data);
  if (renderedData !== data) {
    setRenderedData(data);
    setSelection(null);
    setRange(null);
    setAnchor(null);
  }

  /**
   * Publish the draft.
   *
   * The window and version travel with it: the server refuses the write
   * outright if these dates changed while the host was staging, rather than
   * letting one person's sweep silently overwrite another's.
   */
  const publish = async () => {
    if (draft.count === 0 || publishing) return;
    setPublishing(true);
    try {
      const result = await publishAriChanges({
        propertyId: data.propertyId,
        from: data.dates[0],
        to: data.dates[data.dates.length - 1],
        version: data.version,
        changes: draft.changes,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      // Only now: a draft cleared before the write lands leaves the host with
      // nothing to retry and no record of what they had queued.
      draft.discard();
      setSelection(null);
      toast.success(
        `Published ${draft.count} change${draft.count === 1 ? "" : "s"}.`,
      );
      startTransition(() => router.refresh());
    } catch {
      toast.error("Could not publish. Your changes are still here — try again.");
    } finally {
      setPublishing(false);
    }
  };

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
          draftCount={draft.count}
          publishing={publishing}
          onPublish={publish}
          onDiscard={draft.discard}
        />

        <div className="flex min-h-0 flex-1 flex-col p-4 lg:p-6">
          <AriGrid
            data={filteredData}
            expandedRooms={expandedRooms}
            onToggleRoom={toggleRoom}
            onSelect={setSelection}
            draftEditFor={draft.editFor}
            onRangeSelect={selectRange}
            rangeSelection={range}
            selection={selection}
          />
        </div>
      </div>

      <RangeActionBar
        range={range}
        onClear={() => setRange(null)}
        onStage={(edits) => {
          draft.stage(edits);
          setRange(null);
        }}
      />

      <DesktopOnlyNotice />

      <AriDetailPanel
        selection={selection}
        currency={data.currency}
        stayLength={data.stayLength}
        onClose={() => setSelection(null)}
        onEditAvailability={(prefill) => openDialog("availability", prefill)}
        onEditRestrictions={(prefill) => openDialog("restrictions", prefill)}
        onReopen={(prefill) => openDialog("reopen", prefill)}
        onStage={draft.stage}
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
