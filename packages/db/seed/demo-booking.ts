/**
 * Seeds the demo rate plan and the confirmed two-room booking used by the
 * cancellation screens, plus the inclusive-rates confirmation for the demo
 * property's organisation.
 *
 * It attaches to whatever property is already in the database rather than
 * inventing one, so the bookings show the real Terme Di Saturnia rows,
 * images and check-in times.
 *
 * Money: every `bigint` amount in this schema is in MAJOR units (whole euros),
 * so `rate_plans.bar` of 109 is €109.
 *
 * Run: bun --env-file=../../.env.local packages/db/seed/demo-booking.ts
 */

import { Pool } from "pg";
import { confirmBookingPolicy } from "../src/reservation-policy";

/**
 * A confirmed two-room booking for the cancellation screens (guest booking
 * page, host reservations). Reset to a fresh confirmed state on every run,
 * 30 days out, so its free-cancellation window is always open.
 */
export const DEMO_CONFIRMED_BOOKING_ID = "b0000000-0000-4000-8000-000000000011";
const DEMO_CONFIRMED_RESERVATION_IDS = [
  "b0000000-0000-4000-8000-000000000012",
  "b0000000-0000-4000-8000-000000000013",
];
const CONFIRMED_NIGHTS = 3;
/** The rate plan the confirmed booking is priced against. */
const DEMO_RATE_PLAN_ID = "b0000000-0000-4000-8000-000000000003";

/** "Deluxe" at Terme Di Saturnia — the only room with a room photo and a description. */
const ROOM_ID = "533f72ed-2519-4684-b456-46adb557aba5";
const PROPERTY_ID = "44ca5796-7461-488a-9613-be71394d4aaa";

const ADULTS = 2;

/** Tax-inclusive, like every rate: this is what the guest pays per night. */
const PRICE_PER_NIGHT = 185;
const RATES_TAX_INCLUSIVE_DOC_ID = "rates-vat-inclusive@2026-10-30";
const BOOKING_FEE_RATE = 0.045;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // The guest. Any existing account will do — the booking just needs an owner.
    const { rows: users } = await pool.query<{ id: string }>(
      `select id from "user" order by "createdAt" limit 1`,
    );
    const userId = users[0]?.id;
    if (!userId) throw new Error("No user rows to attach the demo bookings to");

    const { rowCount: roomExists } = await pool.query(
      `select 1 from rooms where id = $1 and property_id = $2`,
      [ROOM_ID, PROPERTY_ID],
    );
    if (!roomExists) throw new Error(`Room ${ROOM_ID} is not on property ${PROPERTY_ID}`);

    // The Deluxe room shipped with no rate plan of its own, so the demo brings
    // the one it is priced against. Refundable: it follows the property's
    // cancellation tier.
    await pool.query(
      `insert into rate_plans
         (id, room_id, name, bar, currency, is_refundable,
          booking_fee_rate, min_stay, is_active)
       values ($1, $2, 'Flexible', $3, 'EUR', true, $4, 1, true)
       on conflict (id) do update set
         bar = excluded.bar,
         is_refundable = true,
         booking_fee_rate = excluded.booking_fee_rate,
         updated_at = now()`,
      [DEMO_RATE_PLAN_ID, ROOM_ID, PRICE_PER_NIGHT, BOOKING_FEE_RATE.toFixed(4)],
    );

    // Checkout refuses a property whose organisation has not confirmed that
    // its rates include tax. Give the demo property's organisation that
    // confirmation, signed by its first owner, so the seeded booking is
    // payable. Keep the id in step with RATES_TAX_INCLUSIVE_DOC_ID in
    // packages/authz/src/rates-doc.ts.
    const { rowCount: confirmed } = await pool.query(
      `insert into org_consent
         (organization_id, doc_id, signed_by_user_id, signer_full_name, signed_at)
       select p.organization_id, $2, m."userId", coalesce(u.name, 'Demo owner'), now()
       from properties p
       join "member" m on m."organizationId" = p.organization_id and m.role = 'owner'
       join "user" u on u.id = m."userId"
       where p.id = $1
         and not exists (
           select 1 from org_consent oc
           where oc.organization_id = p.organization_id and oc.doc_id = $2
         )
       order by m."createdAt"
       limit 1`,
      [PROPERTY_ID, RATES_TAX_INCLUSIVE_DOC_ID],
    );
    if (confirmed) console.log("Recorded the inclusive-rates confirmation for the demo organisation.");
    const { rows: [state] } = await pool.query<{ ok: boolean }>(
      `select exists (
         select 1 from org_consent oc join properties p on p.organization_id = oc.organization_id
         where p.id = $1 and oc.doc_id = $2) as ok`,
      [PROPERTY_ID, RATES_TAX_INCLUSIVE_DOC_ID],
    );
    if (!state?.ok) {
      console.warn(
        "WARNING: the demo property's organisation has NOT confirmed inclusive rates " +
          "(no organisation, or no owner member). Checkout will refuse this booking.",
      );
    }

    // The readiness gate also wants a Stripe account, legal details and a
    // billing profile (spec decision 9). Fill in what is missing, never over
    // what a host entered.
    await pool.query(
      `insert into property_content (property_id, legal_company_name, vat_number)
       values ($1, 'Demo Hotel B.V.', 'NL000000000B01')
       on conflict (property_id) do update set
         legal_company_name = coalesce(nullif(btrim(property_content.legal_company_name), ''), excluded.legal_company_name),
         vat_number = coalesce(nullif(btrim(property_content.vat_number), ''), excluded.vat_number)`,
      [PROPERTY_ID],
    );
    await pool.query(
      `insert into billing_profiles
         (organization_id, legal_name, address_line1, postal_code, city, country_code, vat_id, billing_email)
       select p.organization_id, 'Demo Hotel B.V.', 'Demostraat 1', '1011 AA', 'Amsterdam', 'NL',
              'NL000000000B01', 'billing@demo.openbookings.test'
       from properties p where p.id = $1 and p.organization_id is not null
       on conflict (organization_id) do nothing`,
      [PROPERTY_ID],
    );
    await pool.query(
      `update org_profile op set stripe_account_id = coalesce(op.stripe_account_id, 'acct_demo')
       from properties p where p.id = $1 and op.organization_id = p.organization_id`,
      [PROPERTY_ID],
    );

    await seedConfirmedBooking(pool, userId);
    console.log(
      `Seeded confirmed booking ${DEMO_CONFIRMED_BOOKING_ID}: 2 rooms × ${CONFIRMED_NIGHTS} nights, 30 days out.`,
    );
  } finally {
    await pool.end();
  }
}

/**
 * The confirmed two-room booking, reset on every run: any cancellations,
 * refunds and snapshot from a previous run are cleared, and the policy is
 * snapshotted afresh through the same code real bookings will use.
 */
async function seedConfirmedBooking(pool: Pool, userId: string) {
  const day = 86_400_000;
  const checkIn = new Date(Date.now() + 30 * day).toISOString().slice(0, 10);
  const checkOut = new Date(Date.now() + (30 + CONFIRMED_NIGHTS) * day).toISOString().slice(0, 10);
  const roomTotal = PRICE_PER_NIGHT * CONFIRMED_NIGHTS;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`delete from refunds where booking_id = $1`, [DEMO_CONFIRMED_BOOKING_ID]);
    await client.query(`delete from booking_events where booking_id = $1`, [DEMO_CONFIRMED_BOOKING_ID]);
    await client.query(
      `insert into bookings
         (id, hotel_id, user_id, check_in_date, check_out_date, status, total_amount, currency)
       values ($1, $2, $3, $4, $5, 'pending', $6, 'EUR')
       on conflict (id) do update set
         check_in_date = excluded.check_in_date, check_out_date = excluded.check_out_date,
         status = 'pending', total_amount = excluded.total_amount, confirmed_at = null,
         cancelled_at = null, cancellation_reason = null, no_show_reported_at = null,
         departed_early_on = null, updated_at = now()`,
      [DEMO_CONFIRMED_BOOKING_ID, PROPERTY_ID, userId, checkIn, checkOut, roomTotal * 2],
    );
    for (const id of DEMO_CONFIRMED_RESERVATION_IDS) {
      await client.query(
        `insert into reservations
           (id, booking_id, room_id, rate_plan_id, adults, children, total_nights, price_per_night, total_amount)
         values ($1, $2, $3, $4, $5, 0, $6, $7, $8)
         on conflict (id) do update set
           total_nights = excluded.total_nights, price_per_night = excluded.price_per_night,
           total_amount = excluded.total_amount, check_in_at = null, cancelled_at = null`,
        [id, DEMO_CONFIRMED_BOOKING_ID, ROOM_ID, DEMO_RATE_PLAN_ID, ADULTS, CONFIRMED_NIGHTS, PRICE_PER_NIGHT, roomTotal],
      );
    }
    await confirmBookingPolicy(client, { bookingId: DEMO_CONFIRMED_BOOKING_ID, confirmedAt: new Date() });
    // The exact split (0035), from the nights and tourist tax the policy snapshot just wrote.
    await client.query(
      `update bookings b
       set rooms_total_cents = r.rooms_cents, tourist_tax_cents = r.tax_cents,
           total_cents = r.rooms_cents + r.tax_cents, commission_cents = 0
       from (
         select booking_id,
                sum((select round(sum((n->>'price')::numeric) * 100) from jsonb_array_elements(nights) n)) as rooms_cents,
                sum(round(tourist_tax_amount * 100)) as tax_cents
         from reservations group by booking_id
       ) r
       where r.booking_id = b.id and b.id = $1`,
      [DEMO_CONFIRMED_BOOKING_ID],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
