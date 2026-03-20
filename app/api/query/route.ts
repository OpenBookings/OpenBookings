import { NextRequest, NextResponse } from "next/server";
import type { HotelSearchInput, HotelSearchResult } from "@/types/hotel";
import { query } from "@/lib/postgres/db";

/** Parse and validate URL params into HotelSearchInput */
function parseSearchParams(
  searchParams: URLSearchParams
): { input: HotelSearchInput; errors: string[] } {
  const errors: string[] = [];
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");
  const checkin = searchParams.get("checkin");
  const checkout = searchParams.get("checkout");
  const adults = searchParams.get("adults");
  const children = searchParams.get("children");
  const rooms = searchParams.get("rooms");

  const num = (v: string | null, name: string): number | null => {
    if (v == null || v === "") return null;
    const n = Number(v);
    if (Number.isNaN(n)) {
      errors.push(`${name} must be a number`);
      return null;
    }
    return n;
  };

  const latN = num(lat, "lat");
  const lonN = num(lon, "lon");
  const adultsN = num(adults, "adults");
  const roomsN = num(rooms, "rooms");
  let childrenN: number | null = null;
  if (children != null && children !== "") {
    const c = num(children, "children");
    if (c != null) childrenN = c;
  }

  if (lat == null || lat === "") errors.push("lat is required");
  if (lon == null || lon === "") errors.push("lon is required");
  if (checkin == null || checkin === "") errors.push("checkin is required");
  if (checkout == null || checkout === "") errors.push("checkout is required");
  if (adults == null || adults === "") errors.push("adults is required");
  if (rooms == null || rooms === "") errors.push("rooms is required");

  if (errors.length > 0) {
    return {
      input: {
        lat: latN ?? 0,
        lon: lonN ?? 0,
        checkin: checkin ?? "",
        checkout: checkout ?? "",
        adults: adultsN ?? 0,
        children: childrenN,
        rooms: roomsN ?? 0,
      },
      errors,
    };
  }

  const input: HotelSearchInput = {
    lat: latN as number,
    lon: lonN as number,
    checkin: checkin as string,
    checkout: checkout as string,
    adults: adultsN as number,
    children: childrenN,
    rooms: roomsN as number,
  };
  return { input, errors };
}

const HOTEL_SEARCH_SQL = `
WITH user_input AS (
  SELECT
    $1::float              AS lat,
    $2::float              AS lng,
    $3::date               AS arrival,
    $4::date               AS departure,
    $5::int                AS adults,
    $6::int                AS children
),
stay_dates AS (
  SELECT generate_series(
    (SELECT arrival FROM user_input),
    (SELECT departure - INTERVAL '1 day' FROM user_input),
    INTERVAL '1 day'
  )::date AS stay_date
),
num_nights AS (
  SELECT COUNT(*)::int AS n FROM stay_dates
),
candidate_rooms AS (
  SELECT
    p.id            AS property_id,
    p.name          AS property_name,
    p.city,
    p.country,
    r.id            AS room_id,
    r.name          AS room_name,
    r.description   AS room_description,
    rp.price_per_night,
    rp.currency
  FROM properties p
  JOIN physical_rooms r  ON r.hotel_id = p.id
  JOIN rate_plans rp     ON rp.room_id = r.id
  CROSS JOIN user_input u
  WHERE r.is_active
    AND rp.is_active
    AND u.adults   <= r.max_adults
    AND u.children <= r.max_children
    AND ST_DWithin(
      ST_SetSRID(p.location::geometry, 4326)::geography,
      ST_SetSRID(ST_MakePoint(u.lng::float, u.lat::float), 4326)::geography,
      250000
    )
),
availability_check AS (
  SELECT
    cr.property_id,
    cr.property_name,
    cr.city,
    cr.country,
    cr.room_id,
    cr.room_name,
    cr.room_description,
    cr.price_per_night,
    cr.currency,
    COUNT(*) AS available_nights
  FROM candidate_rooms cr
  JOIN stay_dates sd ON TRUE
  JOIN room_inventory ri
    ON  ri.room_id         = cr.room_id
    AND ri.date::date      = sd.stay_date
    AND ri.available_rooms > 0
  GROUP BY
    cr.property_id, cr.property_name, cr.city, cr.country,
    cr.room_id, cr.room_name, cr.room_description,
    cr.price_per_night, cr.currency
  HAVING COUNT(*) = (SELECT n FROM num_nights)
),
cheapest_per_property AS (
  SELECT DISTINCT ON (property_id)
    property_id,
    property_name,
    city,
    country,
    room_id,
    room_name,
    room_description,
    price_per_night,
    ROUND((price_per_night * (SELECT n FROM num_nights))::numeric, 2) AS total_price,
    currency
  FROM availability_check
  ORDER BY property_id, price_per_night ASC
)
SELECT *
FROM cheapest_per_property
ORDER BY total_price ASC
`;

/** Run the hotel search query with the given input. */
async function runQuery(input: HotelSearchInput): Promise<HotelSearchResult[]> {
  const children = input.children ?? 0;
  const rows = await query<Record<string, unknown>>(HOTEL_SEARCH_SQL, [
    input.lat,
    input.lon,
    input.checkin,
    input.checkout,
    input.adults,
    children,
  ]);
  return rows.map((row) => ({
    property_id: String(row.property_id),
    property_name: String(row.property_name),
    city: String(row.city),
    country: String(row.country),
    room_id: String(row.room_id),
    room_name: String(row.room_name),
    room_description: String(row.room_description ?? ""),
    price_per_night: Number(row.price_per_night),
    total_price: Number(row.total_price),
    currency: String(row.currency),
  }));
}

function buildSimpleHtml(
  input: HotelSearchInput,
  results: HotelSearchResult[],
  errors: string[]
): string {
  const resultRows =
    results.length === 0
      ? "<tr><td colspan=\"6\">No results (query not implemented yet)</td></tr>"
      : results
          .map(
            (r) =>
              `<tr>
                <td>${escapeHtml(r.property_name)}</td>
                <td>${escapeHtml(r.city)}</td>
                <td>${escapeHtml(r.country)}</td>
                <td>${escapeHtml(r.room_name)}</td>
                <td>${escapeHtml(r.room_description)}</td>
                <td>${r.price_per_night}</td>
                <td>${r.total_price}</td>
                <td>${r.currency}</td>
              </tr>`
          )
          .join("");

  const errorBlock =
    errors.length > 0
      ? `<section class="errors"><h2>Validation errors</h2><ul>${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul></section>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Query results</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 1rem auto; padding: 0 1rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th, td { border: 1px solid #ccc; padding: 0.5rem; text-align: left; }
    th { background: #f5f5f5; }
    .params { background: #f9f9f9; padding: 1rem; border-radius: 6px; margin-bottom: 1rem; }
    .params code { background: #eee; padding: 0.2em 0.4em; border-radius: 4px; }
    .errors { color: #c00; margin-bottom: 1rem; }
    a { color: #06c; }
  </style>
</head>
<body>
  <h1>Hotel search results</h1>
  <div class="params">
    <strong>Input:</strong>
    <code>lat=${input.lat}, lon=${input.lon}, checkin=${escapeHtml(input.checkin)}, checkout=${escapeHtml(input.checkout)}, adults=${input.adults}, children=${input.children ?? "—"}, rooms=${input.rooms}</code>
    <br />
    <a href="?${new URLSearchParams({
      lat: String(input.lat),
      lon: String(input.lon),
      checkin: input.checkin,
      checkout: input.checkout,
      adults: String(input.adults),
      rooms: String(input.rooms),
      ...(input.children != null ? { children: String(input.children) } : {}),
      format: "json",
    })}">Get raw JSON</a>
  </div>
  ${errorBlock}
  <table>
    <thead>
      <tr>
        <th>Property</th>
        <th>City</th>
        <th>Country</th>
        <th>Room</th>
        <th>Description</th>
        <th>Price/night</th>
        <th>Total</th>
        <th>Currency</th>
      </tr>
    </thead>
    <tbody>${resultRows}</tbody>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const { input, errors } = parseSearchParams(searchParams);

  const wantsJson =
    searchParams.get("format") === "json" ||
    request.headers.get("accept")?.includes("application/json") === true;

  let results: HotelSearchResult[];
  try {
    results = await runQuery(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database error";
    if (wantsJson) {
      return NextResponse.json(
        { error: message, input, results: [] },
        { status: 500 }
      );
    }
    const html = buildSimpleHtml(input, [], [
      ...errors,
      `Query failed: ${message}`,
    ]);
    return new NextResponse(html, {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (wantsJson) {
    return NextResponse.json(
      {
        input,
        errors: errors.length > 0 ? errors : undefined,
        results,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }

  const html = buildSimpleHtml(input, results, errors);
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
