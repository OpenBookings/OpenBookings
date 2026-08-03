import { stripe } from '@openbookings/stripe';

const STATIC_INTENT = {
  id: 'intent_static_001',
  roomId: 'room_static_001',
  checkIn: new Date('2026-07-01'),
  checkOut: new Date('2026-07-05'),
  guestCount: 2,
  heldUntil: null,
  room: {
    name: 'Deluxe Sea View',
    property: {
      name: "Hotel Côte d'Azur",
      stripeAccountId: process.env.STRIPE_CONNECT_ACCOUNT_ID ?? '',
    },
  },
};

const STATIC_PRICING = {
  totalCents: 48000,
  platformFeeCents: 2400,
};

function formatDateRange(checkIn: Date, checkOut: Date) {
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${fmt(checkIn)} – ${fmt(checkOut)}`;
}

export async function POST(_req: Request) {
  const intent = { ...STATIC_INTENT, heldUntil: new Date(Date.now() + 30 * 60 * 1000) };
  const pricing = STATIC_PRICING;

  let session;
  try {
    session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'eur',
          unit_amount: pricing.totalCents,
          product_data: {
            name: `${intent.room.property.name} — ${intent.room.name}`,
            description: `${formatDateRange(intent.checkIn, intent.checkOut)} · ${intent.guestCount} guests`,
          },
        },
        quantity: 1,
      },
    ],
    payment_intent_data: intent.room.property.stripeAccountId
      ? {
          transfer_data: { destination: intent.room.property.stripeAccountId },
          application_fee_amount: pricing.platformFeeCents,
        }
      : {},
    metadata: {
      bookingIntentId: intent.id,
      roomId: intent.roomId,
    },
    success_url: `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/booking/confirm?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/booking/${intent.id}/cancelled`,
      expires_at: Math.floor(intent.heldUntil.getTime() / 1000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[checkout]', message);
    return Response.json({ error: message }, { status: 500 });
  }

  return Response.json({ checkoutUrl: session.url });
}
