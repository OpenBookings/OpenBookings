import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { buildMockAriGrid } from "../_lib/mock-ari";
import type { AriGridData, RoomTypeRow } from "../_lib/types";
import { AriGrid } from "./ari-grid";
import { AriManagedProvider } from "./managed-context";

/**
 * A room SiteMinder has sent nothing for, as loadAriGrid builds it on a
 * managed hotel: no rooms (units_left null → total 0), no app price
 * (indicativePriceCents 0), so the resolver calls every night sold out.
 */
function unlinkedRoom(room: RoomTypeRow): RoomTypeRow {
  return {
    ...room,
    availability: room.availability.map((a) => ({ ...a, total: 0, left: 0, effective: 0, closure: null })),
    ratePlans: room.ratePlans.map((plan) => ({
      ...plan,
      modifiers: [],
      cells: plan.cells.map((cell) => ({
        ...cell,
        state: "sold_out" as const,
        bookable: false,
        available: 0,
        priceCents: null,
        indicativePriceCents: 0,
        trace: [],
        appliedModifiers: [],
        reasons: [{ code: "SOLD_OUT" as const, source: { kind: "system" as const }, inherited: true, range: null, ruleId: null }],
        primary: "SOLD_OUT" as const,
      })),
    })),
  };
}

const mock = buildMockAriGrid("2031-03-02", 7, 1);
const room = unlinkedRoom(mock.rooms[0]);
const data: AriGridData = { ...mock, rooms: [room] };

/** The grid's rows, without the legend under them (which names every state). */
function render(unlinkedRoomIds: string[] | null) {
  const html = renderToStaticMarkup(
    <AriManagedProvider value={unlinkedRoomIds === null ? null : { unlinkedRoomIds }}>
      <AriGrid
        data={data}
        expandedRooms={new Set([room.id])}
        onToggleRoom={() => {}}
        onSelect={() => {}}
        draftEditFor={() => undefined}
        onRangeSelect={() => {}}
        rangeSelection={null}
        selection={null}
      />
    </AriManagedProvider>,
  );
  return html.slice(0, html.indexOf(">Legend<"));
}

describe("managed grid, a room SiteMinder hasn't linked", () => {
  test("reads Not linked, never Sold out or a price", () => {
    const html = render([room.id]);
    expect(html).toContain("Not linked");
    expect(html).toContain("Not on sale until SiteMinder sends prices");
    expect(html).toContain("not linked in SiteMinder yet, not on sale");
    expect(html).not.toContain("Sold out");
    expect(html).not.toContain("sold out");
    expect(html).not.toContain("€0");
  });

  test("the same room linked (or unmanaged) still shows what the resolver says", () => {
    const html = render(null);
    expect(html).toContain("Sold out");
    expect(html).not.toContain("Not linked");
  });
});
