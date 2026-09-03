'use client';

import { ShieldCheck } from 'lucide-react';
import { useCheckoutForm } from '@stripe/react-stripe-js/checkout';

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

export type TripSummaryProps = {
  logoUrl: string;
  propertyName: string;
  locationLabel: string | null;

  roomName: string;
  roomType: string | null;
  bedType: string | null;
  sizeSqm: number | null;
  roomImageUrl: string;

  checkInDay: string;
  checkInMonth: string;
  checkOutDay: string;
  checkOutMonth: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  nightsLabel: string;
  guestsLabel: string;

  cancellationPolicy: string;
  freeCancellationLabel: string | null;
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
 * The thumbnail is not decoration: a guest who picked a Garden Junior Suite and
 * is shown a Deluxe should be able to catch it without reading a word.
 */
function RoomIdentity({
  logoUrl,
  propertyName,
  locationLabel,
  roomName,
  roomType,
  roomImageUrl,
  attributes,
}: {
  logoUrl: string;
  propertyName: string;
  locationLabel: string | null;
  roomName: string;
  roomType: string | null;
  roomImageUrl: string;
  attributes: string[];
}) {
  return (
    <div className="flex flex-col sm:flex-row items-stretch gap-5 sm:gap-6">
      {roomImageUrl && (
        // Sized to be looked at rather than glanced past — at thumbnail scale
        // one hotel room is indistinguishable from another, which defeats the
        // point of showing it. 4:5 keeps a portrait crop of a wide photo.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={roomImageUrl}
          alt=""
          className="aspect-4/4 w-28 shrink-0 rounded-2xl object-cover ring-1 ring-white/15 sm:w-40"
        />
      )}
      <div className="min-w-0 min-h-0 flex flex-col flex-1 py-1">
        <div className="flex items-center gap-3 flex-1 min-h-0 mt-2">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={propertyName} className="h-10 w-auto sm:h-14 object-contain" />
          )}
          <span className="text-white/50 text-sm font-medium" aria-hidden="true">✕</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/OB-LOGO-LIGHT.png" alt="OpenBookings" className="h-10 w-auto sm:h-14 object-contain" />
        </div>

        <div className="mt-8">
          <h1 className="mt-1.5 font-serif text-3xl leading-[1.05] text-balance text-white sm:text-4xl">
            {roomName}
            {roomType && roomType !== roomName ? ` ${roomType}` : ''}
          </h1>
          {attributes.length > 0 && (
            <p className="mt-2.5 text-sm text-white/55">{attributes.join(' · ')}</p>
          )}
        </div>
      </div>
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
 * Read back out of the Checkout Session rather than from our own booking rows,
 * so the split shown here cannot disagree with the one being charged.
 */
function Ledger() {
  const checkoutState = useCheckoutForm();

  if (checkoutState.type !== 'success') return <LedgerSkeleton />;

  const { checkout } = checkoutState;

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

/* ─────────────────────────── policy ─────────────────────────── */

/**
 * The policy, quiet but not hidden.
 *
 * Previously an opaque white card, which read as a second thing to act on and
 * competed with the payment form. The date is stated outright — "until Wed 7
 * Oct" answers the question the sentence only describes.
 */
function PolicyFooter({
  freeCancellationLabel,
}: {
  freeCancellationLabel: string | null;
}) {
  return (
    <footer>
      {/*
        Given a panel of its own, and the page's accent, because this is the
        sentence that lets someone press pay: the risk of committing is the last
        thing standing between the guest and the button in the other column.
        Set as a deadline rather than a restatement of the policy beneath it —
        the host's wording describes the rule, this resolves it to the date the
        guest actually has to act on, which the rule alone cannot tell them.
      */}
      <div className="rounded-2xl border border-[#a5b4f0]/25 bg-[#a5b4f0]/[0.07] p-5 backdrop-blur-md sm:p-6">
        {freeCancellationLabel && (
          <p className="flex items-start gap-3">
            <ShieldCheck
              className="mt-0.5 size-6 shrink-0 text-green-400"
         
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <span className="font-serif text-xl leading-snug text-white sm:text-2xl">
              Cancel free until {freeCancellationLabel}
            </span>
          </p>
        )}
      </div>

      <p className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-white/60">
        {/* Destinations are not built yet — these are placeholders by design. */}
        <a
          href="#"
          className="underline-offset-4 transition-colors hover:text-white/85 hover:underline"
        >
          Terms of service
        </a>
        <a
          href="#"
          className="underline-offset-4 transition-colors hover:text-white/85 hover:underline"
        >
          Cancellation policy
        </a>
        <a
          href="#"
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
  const attributes = [
    props.bedType && `${props.bedType} bed`,
    props.sizeSqm && `${props.sizeSqm} m²`,
    props.guestsLabel,
  ].filter((value): value is string => Boolean(value));

  return (
    // Spacing carries the hierarchy: wide gaps between the four movements,
    // tight ones inside each. The rhythm is what stops this reading as a list.
    <section className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 space-y-8 motion-safe:duration-500 sm:space-y-10">
      <RoomIdentity
        logoUrl={props.logoUrl}
        propertyName={props.propertyName}
        locationLabel={props.locationLabel}
        roomName={props.roomName}
        roomType={props.roomType}
        roomImageUrl={props.roomImageUrl}
        attributes={attributes}
      />

      <StayRail
        checkInDay={props.checkInDay}
        checkInMonth={props.checkInMonth}
        checkOutDay={props.checkOutDay}
        checkOutMonth={props.checkOutMonth}
        checkInTime={props.checkInTime}
        checkOutTime={props.checkOutTime}
        nightsLabel={props.nightsLabel}
      />

      <Ledger />

      <PolicyFooter
        freeCancellationLabel={props.freeCancellationLabel}
      />
    </section>
  );
}
