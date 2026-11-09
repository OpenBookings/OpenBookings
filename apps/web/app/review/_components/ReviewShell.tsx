import { cookies } from 'next/headers';
import { BACKDROP_COOKIE } from '@openbookings/images';
import { getBackdrop } from '@openbookings/images/server';
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { Nav } from '@/components/nav';

/** The review pages: the booking page's glass, one card in the middle. */
export async function ReviewShell({ eyebrow, title, children }: { eyebrow?: string; title: string; children: React.ReactNode }) {
  const { backdrop } = await cookies().then((c) => getBackdrop(c.get(BACKDROP_COOKIE)?.value));
  return (
    <div className="relative min-h-dvh font-sans text-white">
      <GlassBackdrop backdrop={backdrop} />
      <Nav />
      <main className="relative z-10 mx-auto flex max-w-xl flex-col gap-6 px-4 pt-24 pb-20 sm:px-6 sm:pt-28 md:pt-36">
        <header>
          {eyebrow ? <p className="text-sm text-white/65">{eyebrow}</p> : null}
          <h1 className="mt-2 font-serif text-4xl leading-[1.1] sm:text-5xl">{title}</h1>
        </header>
        <section className="rounded-2xl border border-white/15 bg-black/45 p-6 shadow-2xl backdrop-blur-md sm:p-8">
          {children}
        </section>
      </main>
    </div>
  );
}

const month = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
/** "November 2031" from `YYYY-MM-01`. */
export const formatStayMonth = (iso: string) => month.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
