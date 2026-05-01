"use client";
import { useParams } from "next/navigation";
import { HOST_STEPS } from "./steps";

const STEP_LABELS: Record<string, string> = {
  "add-teams": "Add Team(s)",
  "core-info": "Core Information",
  "add-rooms": "Add Room(s)",
  "define-pricing": "Define Pricing",
  "legal-n-boring": "Legal & Boring",
  "stripe-connect": "Stripe Connect",
};

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const currentSlug = params.step as string;
  const currentIndex = HOST_STEPS.indexOf(currentSlug as typeof HOST_STEPS[number]);

  return (
    <main className="h-dvh bg-[#0d0f12] flex overflow-hidden">
      {/* Left sidebar — 1/4 */}
      <aside className="w-1/4 flex flex-col p-10">
        <div className="flex-1 flex flex-col items-center justify-center gap-16">
          {/* Logo */}
          <div className="flex flex-col items-center gap-2">
            <img
              src="https://cdn.openbookings.co/Openbookings-logo-v2.png"
              alt="OpenBookings"
              className="h-24 w-auto select-none pointer-events-none"
              draggable="false"
            />
          <p className="mt-2 text-white/90 text-3xl font-medium tracking-wide text-center px-6">
            Business Portal
          </p>
          </div>

          {/* Step list */}
          <nav className="flex flex-col w-full pl-6">
            {HOST_STEPS.map((slug, i) => {
              const label = STEP_LABELS[slug];
              const isActive = i === currentIndex;
              const isDone = i < currentIndex;
              const isLast = i === HOST_STEPS.length - 1;

              return (
                <div key={slug} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                        isActive
                          ? "border-blue-500 bg-blue-500/20"
                          : isDone
                          ? "border-blue-500 bg-blue-500"
                          : "border-white/15 bg-transparent"
                      }`}
                    >
                      {isDone ? (
                        <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <span className={`text-xs font-semibold ${isActive ? "text-blue-400" : "text-white/25"}`}>
                          {i + 1}
                        </span>
                      )}
                    </div>
                    {!isLast && (
                      <div
                        className={`w-px flex-1 my-2 ${isDone ? "bg-blue-500/50" : "bg-white/10"}`}
                        style={{ minHeight: "24px" }}
                      />
                    )}
                  </div>

                  <div className={`pb-8 ${isLast ? "pb-0" : ""}`}>
                    <span
                      className={`text-sm font-medium leading-8 transition-colors ${
                        isActive ? "text-white" : isDone ? "text-white/50" : "text-white/25"
                      }`}
                    >
                      {label}
                    </span>
                    {isActive && (
                      <p className="text-xs text-white/30 mt-0.5 leading-tight">In progress</p>
                    )}
                  </div>
                </div>
              );
            })}
          </nav>
        </div>

        <p className="text-sm text-white/25">
          Have a question?{" "}
          <a href="mailto:support@openbookings.co" className="text-blue-400 underline-offset-2 hover:underline">
            Reach out here
          </a>
        </p>
      </aside>

      {/* Right content — 3/4 */}
      <section className="w-3/4 flex flex-col p-10">
        <div className="bg-white/3 border rounded-2xl w-full p-10 flex flex-col flex-1 min-h-0">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-blue-400/80">
              Step {currentIndex + 1} of {HOST_STEPS.length}
            </p>
            <h1 className="mt-1.5 text-2xl font-semibold text-white">
              {STEP_LABELS[currentSlug]}
            </h1>
          </div>

          {children}
        </div>
      </section>
    </main>
  );
}
