import Link from "next/link";

export default function SearchDemoPage() {
  // Demo values only; adjust as needed.
  const example = {
    lat: "51.5074", // London
    lon: "-0.1278",
    checkin: "2026-04-10",
    checkout: "2026-04-13",
    adults: "2",
    children: "",
    rooms: "1",
  };

  const exampleQuery = new URLSearchParams({
    lat: example.lat,
    lon: example.lon,
    checkin: example.checkin,
    checkout: example.checkout,
    adults: example.adults,
    // `children` is optional; leaving it blank keeps it null on the server.
    ...(example.children ? { children: example.children } : {}),
    rooms: example.rooms,
  }).toString();

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">
        Search (Demo)
      </h1>
      <p className="mt-2 text-muted-foreground">
        This is a lightweight page to exercise the `GET /api/query` endpoint.
        It does not yet render results in-place.
      </p>

      <section className="mt-8 rounded-lg border p-5">
        <h2 className="text-lg font-medium">Run a demo search</h2>
        <form
          method="GET"
          action="/api/query"
          className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <label className="flex flex-col gap-1 text-sm">
            Lat
            <input
              className="rounded-md border px-3 py-2"
              type="text"
              name="lat"
              defaultValue={example.lat}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Lon
            <input
              className="rounded-md border px-3 py-2"
              type="text"
              name="lon"
              defaultValue={example.lon}
              required
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Check-in
            <input
              className="rounded-md border px-3 py-2"
              type="date"
              name="checkin"
              defaultValue={example.checkin}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Check-out
            <input
              className="rounded-md border px-3 py-2"
              type="date"
              name="checkout"
              defaultValue={example.checkout}
              required
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Adults
            <input
              className="rounded-md border px-3 py-2"
              type="number"
              name="adults"
              defaultValue={example.adults}
              min={1}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Children (optional)
            <input
              className="rounded-md border px-3 py-2"
              type="number"
              name="children"
              min={0}
              placeholder="0"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Rooms
            <input
              className="rounded-md border px-3 py-2"
              type="number"
              name="rooms"
              defaultValue={example.rooms}
              min={1}
              required
            />
          </label>

          <div className="flex items-end">
            <button
              type="submit"
              className="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
            >
              View results
            </button>
          </div>
        </form>
      </section>

      <section className="mt-6 text-sm text-muted-foreground">
        Prefer JSON?
        {" "}
        <Link
          className="text-primary underline"
          href={`/api/query?${exampleQuery}&format=json`}
        >
          View example JSON
        </Link>
      </section>
    </main>
  );
}

