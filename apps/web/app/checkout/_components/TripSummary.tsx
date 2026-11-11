'use client';

import { useEffect, useRef } from 'react';
import Image from 'next/image';
import { Baby, BedSingle, Check, Coffee, User } from 'lucide-react';
import * as Sentry from '@sentry/nextjs';
import { useCheckoutElements } from '@stripe/react-stripe-js/checkout';
import type { PolicyStep } from '@openbookings/pricing';
import { partyFacts } from '../_lib/party';
import { buildLedger, formatMoney, ledgerPayNowCents, type LedgerRoom } from '../_lib/ledger';

/**
 * The left half of checkout: what the guest is about to buy.
 *
 * Composed around one question — "are these the right dates?" — because by this
 * point the hotel and the room are already decided and the dates are the thing
 * a guest re-reads before paying. So the dates get display type and everything
 * else arranges itself around them: identity above, ledger below, policy last.
 *
 * Glass mode throughout (DESIGN_SYSTEM.md §3.2): white-alpha over the host's
 * photograph, never an opaque fill. The one opaque surface on this page is the
 * payment card in the other column, which is what makes it read as the thing
 * you act on.
 */

/** One room of the booking, as listed. */
export type TripSummaryRoom = {
  /** The intent's own row; a room type can be picked twice. */
  id: string;
  roomName: string;
  roomType: string | null;
  bedType: string | null;
  sizeSqm: number | null;
  roomImageUrl: string;
  ratePlanName: string;
  /** This room's own party and what it asked for. */
  adults: number;
  children: number;
  infants: number;
  includesBreakfast: boolean;
  cots: number;
  extraBeds: number;
};

/** One set of cancellation terms, and the rooms it applies to. */
export type TripSummaryCancellation = {
  /** The schedule: free until a date, what follows, and no-shows. */
  steps: PolicyStep[];
  roomNames: string[];
};

export type TripSummaryProps = {
  logoUrl: string;
  propertyName: string;
  locationLabel: string | null;

  /** In the order the guest picked them. */
  rooms: TripSummaryRoom[];

  checkInDay: string;
  checkInMonth: string;
  checkOutDay: string;
  checkOutMonth: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  nightsLabel: string;

  /** Each room's price breakdown, for the ledger. In the same order as `rooms`. */
  ledgerRooms: LedgerRoom[];

  /** One entry per distinct set of terms: rooms on the same terms share one. */
  cancellations: TripSummaryCancellation[];
  /** Shown once under the schedule when cots or extra beds are paid at the property. */
  payAtPropertyNote: string | null;
  /** A Non-refundable rate on any room: the guest confirms it before the card form shows. */
  requiresNonRefundableConsent: boolean;
};

/* ─────────────────────────── identity ─────────────────────────── */

/** Small tracked caps. The only place uppercase is used, so it stays a signal. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-semibold tracking-[0.18em] text-white/55 uppercase">
      {children}
    </span>
  );
}

/**
 * The room, with its photo.
 *
 * The two marks sit centred above everything else — the partnership is a
 * letterhead, not a competitor to the room name, so it gets the top of the
 * block and then gets out of the way.
 *
 * Beneath it the photo runs 16:9, the shape hotel photography is actually shot
 * in, so the room is shown the way the host framed it rather than cropped to a
 * portrait sliver. The name and its attributes sit beside it on the same
 * optical centre, so the pairing scans as one object: this picture, this room.
 */
function RoomIdentity({
  logoUrl,
  propertyName,
  rooms,
}: {
  logoUrl: string;
  propertyName: string;
  rooms: TripSummaryRoom[];
}) {
  // One room keeps the page's heading; several share it, so none claims it.
  const Heading = rooms.length === 1 ? 'h1' : 'h2';
  return (
    <div className="space-y-7 sm:space-y-9">
      <div className="flex items-center justify-center gap-4">
        {logoUrl && (
          <Image src={logoUrl} alt={propertyName} width={128} height={48} className="h-10 w-auto sm:h-12 object-contain" />
        )}
        <span className="text-white/40 text-sm font-medium" aria-hidden="true">✕</span>
        <Image
          src="/OB-LOGO-LIGHT.png"
          alt="OpenBookings"
          width={64}
          height={48}
          unoptimized
          className="h-10 w-auto sm:h-12 object-contain"
        />
      </div>

      {rooms.length > 1 && <h1 className="sr-only">Your rooms at {propertyName}</h1>}
      {rooms.map((room) => {
        const attributes = [
          room.bedType && `${room.bedType} bed`,
          room.sizeSqm && `${room.sizeSqm} m²`,
          room.ratePlanName && `${room.ratePlanName} rate`,
        ].filter((value): value is string => Boolean(value));
        const party = partyFacts(room);
        const chip =
          'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/15 bg-white/8 px-2.5 py-1 text-xs leading-none text-white/90';
        const chips = [
          room.includesBreakfast && { label: 'Breakfast included', Icon: Coffee },
          room.cots > 0 && { label: 'Cot', Icon: Baby },
          room.extraBeds > 0 && { label: 'Extra bed', Icon: BedSingle },
        ].filter((c): c is { label: string; Icon: typeof Coffee } => Boolean(c));
        return (
          <div key={room.id} className="space-y-4">
            <div className="flex items-center gap-5 sm:gap-7">
              {room.roomImageUrl && (
                <Image
                  src={room.roomImageUrl}
                  alt=""
                  width={224}
                  height={126}
                  className="aspect-16/9 w-40 shrink-0 rounded-2xl object-cover ring-1 ring-white/15 sm:w-56"
                />
              )}
              <div className="min-w-0 flex-1">
                <Heading className="font-serif text-3xl leading-[1.05] text-balance text-white sm:text-4xl">
                  {room.roomName}
                  {room.roomType && room.roomType !== room.roomName ? ` ${room.roomType}` : ''}
                </Heading>
                {attributes.length > 0 && (
                  <p className="mt-3 text-sm text-white/55">
                    {attributes.map((fact, i) => (
                      <span key={fact} className="whitespace-nowrap">
                        {i > 0 && <span aria-hidden="true"> · </span>}
                        {fact}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </div>

            {(party.length > 0 || chips.length > 0) && (
              <div className="space-y-3">
                {party.length > 0 && (
                  <p className="flex items-start gap-2 text-sm text-white/75">
                    <User className="mt-0.5 size-4 shrink-0 text-white/55" strokeWidth={2} aria-hidden="true" />
                    <span>
                      {party.map((fact, i) => (
                        <span key={fact} className="whitespace-nowrap">
                          {i > 0 && <span aria-hidden="true"> · </span>}
                          {fact}
                        </span>
                      ))}
                    </span>
                  </p>
                )}
                {chips.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {chips.map(({ label, Icon }) => (
                      <span key={label} className={chip}>
                        <Icon className="size-3 text-white/60" strokeWidth={2} aria-hidden="true" />
                        {label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── the stay ─────────────────────────── */

function StayEnd({
  label,
  day,
  month,
  time,
  timePrefix,
  align,
}: {
  label: string;
  day: string;
  month: string;
  time: string | null;
  timePrefix: string;
  align: 'left' | 'right';
}) {
  const alignment = align === 'right' ? 'items-end text-right' : 'items-start text-left';
  return (
    <div className={`flex flex-col ${alignment}`}>
      <Eyebrow>{label}</Eyebrow>
      <span className="mt-2.5 font-serif text-5xl leading-none text-white tabular-nums sm:text-6xl">
        {day}
      </span>
      {/*
        Serif, so the weekday and month read as part of the numeral above them
        rather than as a caption bolted underneath. The clock time stays sans
        and tracked: it is a different kind of fact, and dressing it in the
        display face would flatten the two into one grey block.
      */}
      <span className="mt-2.5 font-serif text-lg leading-none text-white/90">{month}</span>
      {time && (
        <span className="mt-2 text-[11px] tracking-[0.12em] text-white/55 uppercase">
          {timePrefix} {time}
        </span>
      )}
    </div>
  );
}

/**
 * Check-in and check-out as the two ends of a journey, read left to right, with
 * the night count riding the line between them.
 *
 * The rule is drawn as two flex segments rather than a border on the container
 * so the count sits *in* the line instead of floating above it, and so the
 * whole thing collapses gracefully when the column narrows.
 */
function StayRail({
  checkInDay,
  checkInMonth,
  checkOutDay,
  checkOutMonth,
  checkInTime,
  checkOutTime,
  nightsLabel,
}: Pick<
  TripSummaryProps,
  | 'checkInDay'
  | 'checkInMonth'
  | 'checkOutDay'
  | 'checkOutMonth'
  | 'checkInTime'
  | 'checkOutTime'
  | 'nightsLabel'
>) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/[0.06] p-5 backdrop-blur-md sm:p-6">
      {/*
        `items-start` plus the connector's own top padding, rather than
        `items-center`: centring aligns the rule against the *whole* column
        including the times beneath, which drops it below the numerals. Pinning
        both to the top puts the rule through the numerals' optical centre,
        where the eye expects a line joining two dates to run.
      */}
      <div className="flex items-start justify-between gap-3 sm:gap-5">
        <StayEnd
          label="Check-in"
          day={checkInDay}
          month={checkInMonth}
          time={checkInTime}
          timePrefix="from"
          align="left"
        />

        {/* The rule is decoration; the count is not, so only the rule is hidden. */}
        <div className="flex min-w-0 flex-1 flex-col items-center gap-2.5 pt-6">
          <span className="text-[11px] font-semibold tracking-[0.18em] whitespace-nowrap text-white/75 uppercase">
            {nightsLabel}
          </span>
          <span className="flex w-full items-center" aria-hidden="true">
            <span className="size-1.5 shrink-0 rounded-full bg-[#a5b4f0]" />
            <span className="h-px flex-1 bg-gradient-to-r from-[#a5b4f0]/60 via-white/25 to-[#a5b4f0]/60" />
            <span className="size-1.5 shrink-0 rounded-full bg-[#a5b4f0]" />
          </span>
        </div>

        <StayEnd
          label="Check-out"
          day={checkOutDay}
          month={checkOutMonth}
          time={checkOutTime}
          timePrefix="until"
          align="right"
        />
      </div>
    </div>
  );
}

/* ─────────────────────────── the ledger ─────────────────────────── */

/**
 * One priced row: name left, amount right, nothing in between.
 *
 * Alignment alone does the joining. Leader rules and row dividers both read as
 * clutter at this row count — a booking has two or three lines, never enough
 * for the eye to lose its place crossing the gap.
 */
function LedgerRow({ name, detail, amount }: { name: string; detail?: string; amount: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="text-[15px] font-medium text-white/90">
        {name}
        {detail && <span className="ml-2 text-sm text-white/50">{detail}</span>}
      </span>
      <span className="text-[15px] font-medium text-white tabular-nums">{amount}</span>
    </div>
  );
}

function LedgerSkeleton() {
  return (
    <div className="space-y-4 py-2" aria-hidden="true">
      <div className="h-4 w-3/5 animate-pulse rounded-full bg-white/12" />
      <div className="h-4 w-2/5 animate-pulse rounded-full bg-white/12" />
      <div className="h-8 w-1/2 animate-pulse rounded-full bg-white/12" />
    </div>
  );
}

/**
 * The total is Stripe's. The rows come from our own snapshot of the booking and
 * are shown only when they add up to it to the cent; otherwise Stripe's own
 * line items are shown, so the ledger can never disagree with the charge.
 */
function Ledger({ propertyName, ledgerRooms }: { propertyName: string; ledgerRooms: LedgerRoom[] }) {
  const checkoutState = useCheckoutElements();
  const reported = useRef(false);

  const stripeTotalCents =
    checkoutState.type === 'success' ? checkoutState.checkout.total.total.minorUnitsAmount : null;
  const ledger = stripeTotalCents === null ? null : buildLedger(ledgerRooms, propertyName, stripeTotalCents);
  // Old intents have no breakdown to show; that is expected, not a mismatch.
  const hasBreakdown = ledgerRooms.length > 0 && ledgerRooms.every((room) => room.rateNights.length > 0);
  const mismatch = stripeTotalCents !== null && hasBreakdown && ledger === null;

  useEffect(() => {
    if (!mismatch || reported.current) return;
    reported.current = true;
    Sentry.captureMessage('checkout ledger mismatch', {
      level: 'warning',
      tags: { area: 'checkout' },
      extra: { payNowCents: ledgerPayNowCents(ledgerRooms), stripeTotalCents },
    });
  }, [mismatch, ledgerRooms, stripeTotalCents]);

  if (checkoutState.type !== 'success') return <LedgerSkeleton />;

  const { checkout } = checkoutState;

  if (!ledger) {
    return (
      <div>
        <div className="space-y-3.5">
          {checkout.lineItems.map((item) => (
            <LedgerRow
              key={item.id}
              name={item.name}
              // Stripe returns the unit price already localised. The quantity is
              // only worth showing when there is more than one of something.
              detail={item.quantity > 1 ? `${item.unitAmount.amount} × ${item.quantity}` : undefined}
              amount={item.total.amount}
            />
          ))}
        </div>

        {/* The one rule the ledger keeps: it separates the parts from the sum. */}
        <div className="mt-5 flex items-baseline justify-between gap-6 border-t border-white/20 pt-5">
          <span className="text-[15px] font-medium text-white/70">Total incl. tax &amp; fees</span>
          <span className="font-serif text-3xl leading-none text-white tabular-nums sm:text-4xl">
            {checkout.total.total.amount}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="space-y-3.5">
        {ledger.rows.map((row, i) => (
          <LedgerRow key={`${row.kind}-${i}`} name={row.label} detail={row.detail} amount={formatMoney(row.amount)} />
        ))}
      </div>

      <div className="mt-5 flex items-baseline justify-between gap-6 border-t border-white/20 pt-5">
        <span className="text-[15px] font-medium text-white/70">Total for your stay</span>
        <span className="font-serif text-3xl leading-none text-white tabular-nums sm:text-4xl">
          {formatMoney(ledger.totalForStay)}
        </span>
      </div>

      {ledger.atProperty && (
        <div className="mt-5 space-y-3 rounded-2xl border border-white/15 bg-white/[0.06] p-5 backdrop-blur-md">
          <LedgerRow name={`Pay now · charged by ${propertyName}`} amount={formatMoney(ledger.payNow)} />
          <LedgerRow
            name={ledger.atProperty.label}
            detail={ledger.atProperty.detail}
            amount={formatMoney(ledger.atProperty.amount)}
          />
        </div>
      )}

      <p className="mt-4 text-xs text-white/60">Incl. VAT. No booking or card fees.</p>
    </div>
  );
}

/* ─────────────────────────── policy ─────────────────────────── */

/**
 * The policy, quiet but not hidden.
 *
 * A dotted timeline in the property's own time: the date the guest has to act
 * by, then what follows. Words and dates only; no amounts at this point.
 * Given a panel of its own, and the page's accent, because this is what lets
 * someone press pay. The first free step keeps the serif and the green check.
 */
function PolicyPanel({ steps, roomsLabel }: { steps: PolicyStep[]; roomsLabel: string | null }) {
  return (
    <div className="rounded-2xl border border-[#a5b4f0]/25 bg-[#a5b4f0]/[0.07] p-5 backdrop-blur-md sm:p-6">
      <p className="text-[11px] font-semibold tracking-[0.18em] text-white/55 uppercase">
        What cancelling costs
        {roomsLabel && ` · ${roomsLabel}`}
      </p>
      <ol className="mt-4 space-y-4">
        {steps.map((step, i) => {
          const free = step.kind === 'free';
          const last = i === steps.length - 1;
          return (
            <li key={step.kind} className="relative flex gap-3.5">
              {!last && (
                <span
                  className="absolute top-6 bottom-[-1rem] left-[0.6875rem] border-l border-dotted border-white/30"
                  aria-hidden="true"
                />
              )}
              <span className="relative mt-0.5 flex size-[1.375rem] shrink-0 items-center justify-center" aria-hidden="true">
                {free ? (
                  <Check className="size-5 text-green-400" strokeWidth={2.25} />
                ) : (
                  <span className="size-2 rounded-full bg-white/45" />
                )}
              </span>
              <div className="min-w-0">
                <p
                  className={
                    free
                      ? 'font-serif text-xl leading-snug text-white sm:text-2xl'
                      : 'text-[15px] font-medium text-white/90'
                  }
                >
                  {step.title}
                </p>
                <p className="mt-1 text-sm text-white/70">{step.detail}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function PolicyFooter({
  cancellations,
  payAtPropertyNote,
}: {
  cancellations: TripSummaryCancellation[];
  payAtPropertyNote: string | null;
}) {
  return (
    <footer>
      <div className="space-y-4">
        {cancellations.map((terms) => (
          <PolicyPanel
            key={JSON.stringify(terms.steps)}
            steps={terms.steps}
            roomsLabel={cancellations.length > 1 ? terms.roomNames.join(', ') : null}
          />
        ))}
      </div>

      {payAtPropertyNote && <p className="mt-4 text-sm text-white/70">{payAtPropertyNote}</p>}

      <p className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-white/60">
        {/* Legal pages open in a new tab so the guest doesn't lose checkout. */}
        <a
          href="/legal/en/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="underline-offset-4 transition-colors hover:text-white/85 hover:underline"
        >
          Terms of service
        </a>
        <a
          href="/legal/en/terms#cancellations"
          target="_blank"
          rel="noopener noreferrer"
          className="underline-offset-4 transition-colors hover:text-white/85 hover:underline"
        >
          Cancellation policy
        </a>
        <a
          href="/legal/en/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="underline-offset-4 transition-colors hover:text-white/85 hover:underline"
        >
          Privacy policy
        </a>
      </p>
    </footer>
  );
}

/* ─────────────────────────── composition ─────────────────────────── */

export function TripSummary(props: TripSummaryProps) {
  return (
    // Spacing carries the hierarchy: wide gaps between the four movements,
    // tight ones inside each. The rhythm is what stops this reading as a list.
    <section className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 space-y-8 motion-safe:duration-500 sm:space-y-10">
      <RoomIdentity logoUrl={props.logoUrl} propertyName={props.propertyName} rooms={props.rooms} />

      <StayRail
        checkInDay={props.checkInDay}
        checkInMonth={props.checkInMonth}
        checkOutDay={props.checkOutDay}
        checkOutMonth={props.checkOutMonth}
        checkInTime={props.checkInTime}
        checkOutTime={props.checkOutTime}
        nightsLabel={props.nightsLabel}
      />

      <Ledger propertyName={props.propertyName} ledgerRooms={props.ledgerRooms} />

      <PolicyFooter cancellations={props.cancellations} payAtPropertyNote={props.payAtPropertyNote} />
    </section>
  );
}
