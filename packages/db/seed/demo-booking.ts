/**
 * Seeds the one booking the checkout page pays for.
 *
 * There is no booking-intent table yet, so checkout reads a real `bookings`
 * row in `pending` — which is exactly what a pre-payment intent is. The ids are
 * fixed rather than generated so the script is idempotent and so
 * `apps/web/app/checkout/_lib/booking.ts` can look the row up by constant.
 *
 * It attaches to whatever property is already in the database rather than
 * inventing one, so the summary renders the real Terme Di Saturnia rows,
 * images and check-in times.
 *
 * Money: every `bigint` amount in this schema is in MAJOR units (whole euros) —
 * `rate_plans.bar` of 109 is €109, and the pricing calculator rounds to two
 * decimals rather than working in minor units. Stripe is handed minor units,
 * converted at the edge in `_lib/booking.ts`.
 *
 * Run: bun --env-file=../../.env.local packages/db/seed/demo-booking.ts
 */

import { Pool } from "pg";

/** The demo booking, and the rate plan it is priced against. */
export const DEMO_BOOKING_ID = "b0000000-0000-4000-8000-000000000001";
const DEMO_RESERVATION_ID = "b0000000-0000-4000-8000-000000000002";
const DEMO_RATE_PLAN_ID = "b0000000-0000-4000-8000-000000000003";

/** "Deluxe" at Terme Di Saturnia — the only room with a room photo and a description. */
const ROOM_ID = "533f72ed-2519-4684-b456-46adb557aba5";
const PROPERTY_ID = "44ca5796-7461-488a-9613-be71394d4aaa";

const CHECK_IN = "2026-10-14";
const CHECK_OUT = "2026-10-17";
const NIGHTS = 3;
const ADULTS = 2;
const CHILDREN = 0;

const PRICE_PER_NIGHT = 185;
const BOOKING_FEE_RATE = 0.035;

const ROOM_SUBTOTAL = PRICE_PER_NIGHT * NIGHTS;
const BOOKING_FEE = Math.round(ROOM_SUBTOTAL * BOOKING_FEE_RATE);
/** Grand total, fee included. `booking_fee_amount` names a component of it. */
const TOTAL = ROOM_SUBTOTAL + BOOKING_FEE;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // The guest. Any existing account will do — the booking just needs an owner.
    const { rows: users } = await pool.query<{ id: string }>(
      `select id from "user" order by "createdAt" limit 1`,
    );
    const userId = users[0]?.id;
    if (!userId) throw new Error("No user rows to attach the demo booking to");

    const { rowCount: roomExists } = await pool.query(
      `select 1 from rooms where id = $1 and property_id = $2`,
      [ROOM_ID, PROPERTY_ID],
    );
    if (!roomExists) throw new Error(`Room ${ROOM_ID} is not on property ${PROPERTY_ID}`);

    // The Deluxe room shipped with no rate plan of its own, so the demo brings
    // the one it is priced against. Refundable, with a policy the checkout page
    // can actually quote — the existing plans all carry a null policy.
    await pool.query(
      `insert into rate_plans
         (id, room_id, name, bar, currency, is_refundable, cancellation_policy,
          booking_fee_rate, min_stay, is_active)
       values ($1, $2, 'Flexible', $3, 'EUR', true, $4, $5, 1, true)
       on conflict (id) do update set
         bar = excluded.bar,
         cancellation_policy = excluded.cancellation_policy,
         booking_fee_rate = excluded.booking_fee_rate,
         updated_at = now()`,
      [DEMO_RATE_PLAN_ID, ROOM_ID, PRICE_PER_NIGHT, BOOKING_FEE_RATE.toFixed(4)],
    );

    // `pending` is the pre-payment state: the room is held, nothing is charged.
    await pool.query(
      `insert into bookings
         (id, hotel_id, user_id, check_in_date, check_out_date, status,
          total_amount, booking_fee_amount, currency)
       values ($1, $2, $3, $4, $5, 'pending', $6, $7, 'EUR')
       on conflict (id) do update set
         check_in_date = excluded.check_in_date,
         check_out_date = excluded.check_out_date,
         status = excluded.status,
         total_amount = excluded.total_amount,
         booking_fee_amount = excluded.booking_fee_amount,
         updated_at = now()`,
      [DEMO_BOOKING_ID, PROPERTY_ID, userId, CHECK_IN, CHECK_OUT, TOTAL, BOOKING_FEE],
    );

    await pool.query(
      `insert into reservations
         (id, booking_id, room_id, rate_plan_id, adults, children,
          total_nights, price_per_night, total_amount)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (id) do update set
         adults = excluded.adults,
         children = excluded.children,
         total_nights = excluded.total_nights,
         price_per_night = excluded.price_per_night,
         total_amount = excluded.total_amount`,
      [
        DEMO_RESERVATION_ID,
        DEMO_BOOKING_ID,
        ROOM_ID,
        DEMO_RATE_PLAN_ID,
        ADULTS,
        CHILDREN,
        NIGHTS,
        PRICE_PER_NIGHT,
        ROOM_SUBTOTAL,
      ],
    );

    console.log(
      `Seeded booking ${DEMO_BOOKING_ID}: ${NIGHTS} nights, ${ADULTS} adults, €${TOTAL} total (€${BOOKING_FEE} fee).`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
