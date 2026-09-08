import Link from 'next/link';
import { InkField } from '@/components/ink-field';

const startHere = [
  {
    href: '/docs/getting-started',
    title: 'Getting started',
    description: 'Sign in, complete the four setup steps, and learn your way around the dashboard.',
  },
  {
    href: '/docs/concepts',
    title: 'Concepts',
    description: 'Room types, rate plans and availability — the handful of ideas everything else rests on.',
  },
  {
    href: '/docs/common-tasks',
    title: 'Common tasks',
    description: 'Step-by-step answers to the jobs that span more than one screen.',
  },
];

const areas = [
  { href: '/docs/bookings', title: 'Bookings', description: 'Reservations, guest messages and reviews.' },
  { href: '/docs/property', title: 'Property', description: 'What you sell, at what price, on which dates.' },
  { href: '/docs/finance', title: 'Finance', description: 'Payouts, invoices and what you are owed.' },
  { href: '/docs/analytics', title: 'Analytics', description: 'Occupancy, revenue and how a period is tracking.' },
  { href: '/docs/reference', title: 'Reference', description: 'Glossary, grid legend, limits and data handling.' },
  { href: '/docs/your-account', title: 'Your account', description: 'Profile, team members and permissions.' },
];

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      <section className="relative isolate flex min-h-[min(84vh,46rem)] items-end overflow-hidden">
        <InkField className="ink-canvas pointer-events-none absolute inset-0 size-full" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: [
              'linear-gradient(103deg, var(--color-fd-background) 0%, var(--color-fd-background) 46%, color-mix(in oklab, var(--color-fd-background) 70%, transparent) 60%, transparent 82%)',
              'linear-gradient(to top, var(--color-fd-background) 0%, transparent 34%)',
            ].join(', '),
          }}
        />

        <div className="relative mx-auto w-full max-w-6xl px-6 pt-40 pb-20 md:pb-28">
          <p className="font-body text-fd-foreground/70 text-xs tracking-[0.22em] uppercase">
            OpenBookings · Documentation
          </p>
          <h1 className="font-display text-fd-foreground mt-6 max-w-[16ch] text-[clamp(2.6rem,6.4vw,4.75rem)] leading-[0.98] tracking-[-0.02em] text-balance">
            Everything the dashboard does, written down.
          </h1>
          <p className="font-body text-fd-foreground/70 mt-7 max-w-[46ch] text-lg leading-relaxed">
            Guides for the OpenBookings business dashboard — who is arriving today, what the guest asked
            last night, and what you are selling on which dates.
          </p>

          <div className="font-body mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/docs"
              className="bg-fd-foreground text-fd-background hover:bg-fd-foreground/85 focus-visible:outline-fd-ring inline-flex h-11 items-center rounded-md px-5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Start reading
            </Link>
            <Link
              href="/docs/getting-started/setting-up-your-property"
              className="border-fd-border text-fd-foreground hover:bg-fd-accent focus-visible:outline-fd-ring inline-flex h-11 items-center rounded-md border px-5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Set up your property
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl px-6 pb-28">
        <section className="pt-4">
          <h2 className="font-body text-fd-muted-foreground text-xs tracking-[0.22em] uppercase">Start here</h2>
          <ul className="mt-8">
            {startHere.map((item, i) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="group border-fd-border hover:border-fd-foreground/35 focus-visible:outline-fd-ring grid grid-cols-[2.5rem_1fr] items-baseline gap-x-4 border-t py-8 transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 md:grid-cols-[4rem_minmax(0,20rem)_1fr] md:gap-x-8"
                >
                  <span className="font-body text-fd-muted-foreground text-sm tabular-nums">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="font-display text-fd-foreground text-2xl tracking-[-0.01em] md:text-3xl">
                    {item.title}
                  </span>
                  <span className="font-body text-fd-muted-foreground col-start-2 mt-3 max-w-[46ch] text-base leading-relaxed md:col-start-3 md:mt-0">
                    {item.description}
                    <span
                      aria-hidden
                      className="text-fd-foreground ml-2 inline-block transition-transform duration-300 ease-out group-hover:translate-x-1"
                    >
                      →
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-24">
          <h2 className="font-body text-fd-muted-foreground text-xs tracking-[0.22em] uppercase">
            Browse by area
          </h2>
          <ul className="mt-8 grid gap-x-12 sm:grid-cols-2">
            {areas.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="group border-fd-border hover:border-fd-foreground/35 focus-visible:outline-fd-ring block border-t py-5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-4"
                >
                  <span className="font-body text-fd-foreground text-base font-medium">
                    {item.title}
                    <span
                      aria-hidden
                      className="text-fd-muted-foreground ml-2 inline-block transition-transform duration-300 ease-out group-hover:translate-x-1"
                    >
                      →
                    </span>
                  </span>
                  <span className="font-body text-fd-muted-foreground mt-1 block max-w-[42ch] text-sm leading-relaxed">
                    {item.description}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <p className="font-body text-fd-muted-foreground mt-24 text-sm">
          Cannot find it?{' '}
          <Link href="/docs/getting-help" className="text-fd-foreground underline underline-offset-4">
            Getting help
          </Link>{' '}
          covers what to send us and where.
        </p>
      </div>
    </main>
  );
}
