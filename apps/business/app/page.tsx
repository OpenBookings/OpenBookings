import Link from "next/link";

export default function MarketingPage() {
  return (
    <div className="min-h-screen bg-[#0d0f12] text-white flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-10 py-6">
        <img
          src="https://cdn.openbookings.co/Openbookings-logo-v2.png"
          alt="OpenBookings"
          className="h-8 w-auto select-none pointer-events-none"
          draggable={false}
        />
        <Link
          href="/login"
          className="text-sm font-medium text-white/70 hover:text-white transition-colors"
        >
          Sign in →
        </Link>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center text-center px-6 py-24">
        <p className="text-xs font-semibold uppercase tracking-widest text-blue-400/80 mb-4">
          Business Portal
        </p>
        <h1 className="text-5xl sm:text-6xl font-semibold tracking-tight max-w-3xl leading-tight">
          Run your property with confidence
        </h1>
        <p className="mt-6 text-lg text-white/50 max-w-xl leading-relaxed">
          OpenBookings gives hospitality teams the tools to manage bookings,
          onboard staff, and grow their business — all in one place.
        </p>
        <Link
          href="/login"
          className="mt-10 inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 transition-colors text-white font-medium text-sm px-6 py-3 rounded-xl"
        >
          Get started
          <span aria-hidden>→</span>
        </Link>

        {/* Feature highlights */}
        <div className="mt-24 grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-3xl w-full text-left">
          {[
            {
              title: "Onboarding made easy",
              body: "A guided setup gets your property, rooms, and team live in minutes.",
            },
            {
              title: "Team management",
              body: "Invite staff, assign roles, and keep everyone on the same page.",
            },
            {
              title: "Built for hospitality",
              body: "Designed around the real workflows of hotels and short-stay properties.",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="bg-white/3 border border-white/8 rounded-2xl p-6"
            >
              <h3 className="text-sm font-semibold text-white mb-2">{f.title}</h3>
              <p className="text-sm text-white/40 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="px-10 py-6 flex items-center justify-between border-t border-white/8">
        <p className="text-xs text-white/25">
          © {new Date().getFullYear()} OpenBookings
        </p>
        <a
          href="mailto:support@openbookings.co"
          className="text-xs text-blue-400 hover:underline underline-offset-2"
        >
          support@openbookings.co
        </a>
      </footer>
    </div>
  );
}
