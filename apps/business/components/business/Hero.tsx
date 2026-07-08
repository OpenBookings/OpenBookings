import Link from "next/link";

export function Hero() {
  return (
    <section
      id="hero"
      className="relative overflow-hidden flex min-h-svh flex-col items-center px-16 pt-24 text-center"
      style={{
        background:
          "radial-gradient(ellipse 80% 60% at 50% 40%, rgba(88,64,224,0.1) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 20% 80%, rgba(0,200,168,0.06) 0%, transparent 55%), #0d1117",
      }}
    >
      {/*
        Stage: a self-contained box that owns the "center point" for both the
        orbital art and the headline. Everything inside is positioned relative
        to THIS box's own 50%, not the section's — so the rings/nodes always
        stay locked to the text regardless of what renders above or below
        (e.g. the dashboard mockup's height changing).
      */}
      <div className="relative flex w-full flex-1 items-center justify-center" style={{ minHeight: 700 }}>
        {/*
          Orbital rings + floating nodes.

          Design language (GitHub-Discussions-style): three TRUE concentric
          circles (r = 330 / 470 / 620) centered on the headline. The outer
          rings deliberately overflow the stage and get clipped, so the art
          feels like it continues past the frame. Every node is positioned by
          its CENTER (translate -50%,-50%) at an exact (x, y) that satisfies
          x² + y² = r², so nodes sit ON the ring lines instead of floating
          near them.
        */}
        <div className="pointer-events-none absolute inset-0 hidden items-center justify-center lg:flex">
          <svg
            width="1400"
            height="1400"
            viewBox="-700 -700 1400 1400"
            fill="none"
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
          >
            <circle cx="0" cy="0" r="330" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
            <circle cx="0" cy="0" r="470" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
            <circle cx="0" cy="0" r="620" stroke="rgba(255,255,255,0.035)" strokeWidth="1" />
            {/* small decorative dots resting on the rings */}
            <circle cx="-310" cy="113" r="3" fill="rgba(255,255,255,0.14)" />
            <circle cx="233" cy="-234" r="3" fill="rgba(255,255,255,0.12)" />
            <circle cx="-336" cy="329" r="3.5" fill="rgba(0,200,168,0.35)" />
            <circle cx="614" cy="-86" r="3" fill="rgba(255,255,255,0.1)" />
            <circle cx="-614" cy="-86" r="3" fill="rgba(123,106,238,0.35)" />
            <circle cx="585" cy="205" r="3" fill="rgba(255,255,255,0.1)" />
          </svg>

          {/* ring 1 (r=330) · top — booking confirmation pill */}
          <div className="absolute top-[calc(50%-330px)] left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-[9px] whitespace-nowrap rounded-full border border-[rgba(0,200,168,0.25)] bg-[#161d2e] px-4 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
            <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#00C8A8]" />
            <span className="text-[12px] font-medium text-white">Booking confirmed</span>
            <span className="text-[11px] text-white/38">€480</span>
          </div>

          {/* ring 1 (r=330) · right — small trend count */}
          <div className="absolute top-[calc(50%-113px)] left-[calc(50%+310px)] flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap text-[12px] text-white/45">
            <span className="text-[#4ade80]">↑</span> 12.4% Conversion
          </div>

          {/* ring 1 (r=330) · bottom-left — new booking pill */}
          <div className="absolute top-[calc(50%+234px)] left-[calc(50%-233px)] flex -translate-x-1/2 -translate-y-1/2 items-center gap-[9px] whitespace-nowrap rounded-full border border-white/9 bg-[#161d2e] px-4 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
            <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-[rgba(255,180,60,0.9)]" />
            <span className="text-[12px] font-medium text-white">New booking</span>
            <span className="text-[11px] text-white/38">Ocean View · 3 nights</span>
          </div>

          {/* ring 1 (r=330) · bottom-right — revenue count */}
          <div className="absolute top-[calc(50%+234px)] left-[calc(50%+233px)] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[13px] font-medium text-white/70">
            €42,350 <span className="text-[11px] font-normal text-[#4ade80]">↑</span>
          </div>

          {/* ring 2 (r=470) · upper-left — occupancy card */}
          <div className="absolute top-[calc(50%-235px)] left-[calc(50%-407px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/10 bg-[#161d2e] px-4 py-[11px] text-left shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
            <div className="mb-1 text-[10px] uppercase tracking-[0.08em] text-white/32">Occupancy</div>
            <div className="text-[22px] font-semibold tracking-[-0.03em] text-white">87.3%</div>
            <div className="mt-[3px] text-[10px] text-[#4ade80]">↑ 3.1% this month</div>
          </div>

          {/* ring 2 (r=470) · upper-right — GDPR circular chip */}
          <div className="absolute top-[calc(50%-235px)] left-[calc(50%+407px)] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[rgba(88,64,224,0.3)] bg-[#161d2e] shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7B6AEE" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <div className="whitespace-nowrap text-center">
              <div className="text-[11px] font-medium text-white/80">GDPR Compliant</div>
              <div className="text-[10px] text-white/35">EU Data Residency</div>
            </div>
          </div>

          {/* ring 2 (r=470) · left — open source circular chip */}
          <div className="absolute top-[calc(50%+20px)] left-[calc(50%-470px)] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-[#161d2e] shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            </div>
            <div className="whitespace-nowrap text-center">
              <div className="text-[11px] font-medium text-white/80">Open Source Core</div>
              <div className="text-[10px] text-white/35">MPL-2.0 Licensed</div>
            </div>
          </div>

          {/* ring 2 (r=470) · right — commission pill */}
          <div className="absolute top-[calc(50%+20px)] left-[calc(50%+470px)] flex -translate-x-1/2 -translate-y-1/2 items-center gap-[9px] whitespace-nowrap rounded-full border border-[rgba(0,200,168,0.22)] bg-[#161d2e] px-4 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
            <span className="text-[12px] font-semibold text-[#00C8A8]">No surprises</span>
            <span className="text-[11px] text-white/38">Published rates, always</span>
          </div>

          {/* ring 2 (r=470) · bottom-right — checkmark chip */}
          <div className="absolute top-[calc(50%+329px)] left-[calc(50%+336px)] flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[rgba(0,200,168,0.35)] bg-[#161d2e] shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00C8A8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>

          {/* ring 3 (r=620) · left — small count label */}
          <div className="absolute top-[calc(50%+310px)] left-[calc(50%-537px)] hidden -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap text-[12px] text-white/40 xl:flex">
            <span className="text-white/30">★</span> 4.9 Star Reviews
          </div>

          {/* ring 3 (r=620) · right — small count label */}
          <div className="absolute top-[calc(50%+310px)] left-[calc(50%+537px)] hidden -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap text-[12px] text-white/40 xl:flex">
            <span className="text-[#00C8A8]">↑</span> 68 bookings today
          </div>
        </div>

        {/* Center content — the fixed anchor point everything else orbits */}
        <div className="relative z-2 max-w-[660px]">
          <h1 className="mb-7 font-(family-name:--font-cormorant) text-[64px] leading-[0.88] font-bold tracking-[-2px] text-white sm:text-[80px] sm:tracking-[-2.5px] lg:text-[104px] lg:tracking-[-3px]">
            Effortless.
            <br />
            Transparent.
          </h1>
          <p className="mb-11 text-[18px] leading-[1.65] font-light text-white/46">
            See the code. See the fees. See the difference.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href="/login"
              className="rounded-[10px] bg-white px-8 py-[15px] text-[15px] font-medium tracking-[-0.01em] text-[#0d1117] hover:opacity-90 transition-opacity"
            >
              List Your Property →
            </Link>
            <Link
              href="/login"
              className="rounded-[10px] border border-white/13 px-7 py-[15px] text-[15px] text-white/48 hover:text-white/70 hover:border-white/20 transition-colors"
            >
              Book a Demo
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
