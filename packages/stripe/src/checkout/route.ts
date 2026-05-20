import { stripe } from '../client';

const STATIC_INTENT = {
  id: 'intent_static_001',
  roomId: 'room_static_001',
  checkIn: new Date('2026-07-01'),
  checkOut: new Date('2026-07-05'),
  guestCount: 2,
  status: 'held' as const,
  lockedTotalCents: 48000,
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
  const intent = STATIC_INTENT;
  const pricing = STATIC_PRICING;

  // Expires in 23 hours from now (Stripe requires this to be in the future)
  const nowUnix = Math.floor(Date.now() / 1000);
  const expiresAt = nowUnix + 60 * 60 * 23; // 23 hours ahead
  
  const session = await stripe.checkout.sessions.create({
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
    payment_intent_data: {
      transfer_data: {
        destination: intent.room.property.stripeAccountId,
      },
      application_fee_amount: pricing.platformFeeCents,
    },
    metadata: {
      bookingIntentId: intent.id,
      roomId: intent.roomId,
    },
    success_url: `${process.env.NEXT_PUBLIC_WEB_URL}/booking/confirm?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.NEXT_PUBLIC_WEB_URL}/booking/${intent.id}/cancelled`,
    expires_at: expiresAt,
  });

  return Response.json({ checkoutUrl: session.url });
}
