import Link from 'next/link';
import { Building2, Code, Server, User } from 'lucide-react';
import { InkField } from '@/components/ink-field';

const areas = [
  {
    href: '/guest',
    title: 'Guest',
    icon: User,
    description: 'Booking a stay, changing it, and getting help as a traveller.',
  },
  {
    href: '/business',
    title: 'Business',
    icon: Building2,
    description: 'Rates, availability, reservations and payouts in the Business Portal.',
  },
  {
    href: '/api',
    title: 'API',
    icon: Code,
    description: 'Authentication, endpoints and webhooks for integrating with OpenBookings.',
  },
  {
    href: '/self-hosted',
    title: 'Self-hosted',
    icon: Server,
    description: 'Deploying, configuring and operating your own OpenBookings instance.',
  },
];

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      <section className="relative isolate flex min-h-[min(84vh,46rem)] items-end overflow-hidden">
        <InkField
          className="ink-canvas pointer-events-none absolute inset-0 size-full"
          speed={1.0}
          cursorInfluence={0.55}
          width={0.5}
        />
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
            Everything OpenBookings does, written down.
          </h1>
          <p className="font-body text-fd-foreground/70 mt-7 max-w-[46ch] text-lg leading-relaxed">
            Whether you are booking a room, running a property, building against the API or hosting
            the whole thing yourself — start with the area that fits.
          </p>
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl px-6 pb-28">
        <h2 className="font-body text-fd-muted-foreground text-xs tracking-[0.22em] uppercase">
          Choose an area
        </h2>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {areas.map(({ href, title, icon: Icon, description }) => (
            <li key={href}>
              <Link
                href={href}
                className="group border-fd-border hover:border-fd-foreground/35 hover:bg-fd-accent/40 focus-visible:outline-fd-ring flex h-full flex-col rounded-lg border p-6 transition-colors focus-visible:outline-2 focus-visible:outline-offset-4"
              >
                <Icon aria-hidden className="text-fd-muted-foreground size-5" />
                <span className="font-display text-fd-foreground mt-5 text-2xl tracking-[-0.01em]">
                  {title}
                  <span
                    aria-hidden
                    className="text-fd-muted-foreground ml-2 inline-block transition-transform duration-300 ease-out group-hover:translate-x-1"
                  >
                    →
                  </span>
                </span>
                <span className="font-body text-fd-muted-foreground mt-2 max-w-[42ch] text-sm leading-relaxed">
                  {description}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
