import Link from "next/link";
import { Footer } from "./Footer";

export function FinalCTA() {
  return (
    <section className="bg-[#080808] p-3 pt-0 sm:p-6 sm:pt-0">
      <div
        className="overflow-hidden rounded-[24px] border border-white/8 sm:rounded-[32px]"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 50% 0%, rgba(88,64,224,0.12) 0%, transparent 60%), radial-gradient(ellipse 50% 45% at 85% 100%, rgba(0,200,168,0.05) 0%, transparent 55%), #0d1117",
        }}
      >
        <div className="px-6 py-24 text-center sm:px-16 sm:py-[140px]">
          <div className="mb-[18px] text-[11px] font-medium tracking-[0.15em] text-white/28 uppercase">
            Get Started
          </div>
          <h2 className="mx-auto mb-6 max-w-[600px] font-(family-name:--font-cormorant) text-[52px] leading-[0.95] font-bold tracking-[-1.5px] text-white sm:text-[84px] sm:tracking-[-2.5px]">
            Keep your margin.
          </h2>
          <p className="mx-auto mb-11 max-w-[46ch] text-[16px] leading-[1.7] font-light text-white/46 sm:text-[17px]">
            List your property in minutes, or talk to us first. Either way, the rate is 4.5% — same as it
            says on the tin.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href="/login"
              className="rounded-[10px] bg-white px-8 py-[15px] text-[15px] font-medium tracking-[-0.01em] text-[#0d1117] transition-opacity hover:opacity-90"
            >
              List Your Property →
            </Link>
            <Link
              href="/login"
              className="rounded-[10px] border border-white/13 px-7 py-[15px] text-[15px] text-white/48 transition-colors hover:border-white/20 hover:text-white/70"
            >
              Book a Demo
            </Link>
          </div>
        </div>

        <Footer embedded />
      </div>
    </section>
  );
}
