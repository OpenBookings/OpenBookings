"use client";
import { useParams } from "next/navigation";
import { HOST_STEPS, STEP_TITLES, STEP_SUBTITLES, type HostStep } from "./steps";

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const currentSlug = params.step as string;
  const currentIndex = HOST_STEPS.indexOf(currentSlug as HostStep);

  const title = STEP_TITLES[currentSlug as HostStep] ?? "";
  const subtitle = STEP_SUBTITLES[currentSlug as HostStep];

  return (
    <main className="min-h-dvh bg-[#0d0f12] flex flex-col">
      {/* Logo — top left */}
      <header className="px-8 pt-7 shrink-0">
        <img
          src="https://cdn.openbookings.co/Openbookings-logo-v2.png"
          alt="OpenBookings"
          className="h-8 w-auto select-none pointer-events-none"
          draggable="false"
        />
      </header>

      {/* Step title + progress */}
      <div className="flex flex-col items-center text-center px-6 pt-10 pb-8 shrink-0">
        <h1 className="text-[1.85rem] font-semibold text-white leading-snug max-w-lg">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-2 text-sm text-white/45 max-w-sm">{subtitle}</p>
        )}

        {/* Step segments */}
        <div className="flex items-center gap-2 mt-6">
          {HOST_STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-[3px] w-10 rounded-full transition-all duration-300 ${
                i === currentIndex
                  ? "bg-white"
                  : i < currentIndex
                  ? "bg-white/40"
                  : "bg-white/12"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Page content */}
      <div className="flex justify-center px-6 flex-1">
        <div className="w-full max-w-2xl">
          {children}
        </div>
      </div>
    </main>
  );
}
