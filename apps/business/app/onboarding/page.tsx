"use client"
import {useState } from "react";

const STEPS = [
  "Create Organization",
  "Core Information",
  "Add Room(s)",
  "Legal & Boring",
  "Stripe Connect",
];

export default function onboardingPage() {
  const [currentStep, setCurrentStep] = useState(1);

  return (
    <main className="h-screen bg-[#0d0f12] flex overflow-hidden">
      {/* Left sidebar — 1/4 */}
      <aside className="w-1/4 flex flex-col p-10">
        {/* Logo + steps centered vertically */}
        <div className="flex-1 flex flex-col items-center justify-center gap-16">
          {/* Logo */}
          <div className="flex flex-col items-center gap-2">
            <img
              src="https://cdn.openbookings.co/Openbookings-logo-v2.png"
              alt="OpenBookings"
              className="h-24 w-auto select-none pointer-events-none"
              draggable="false"
            />
            <span className="text-3xl font-bold text-white">
              Business Portal
            </span>
       
          </div>
    


          {/* Step list */}
          <nav className="flex flex-col w-full pl-6">
            {STEPS.map((label, i) => {
              const step = i + 1;
              const isActive = step === currentStep;
              const isDone = step < currentStep;
              const isLast = step === STEPS.length;

              return (
                <div key={step} className="flex gap-4">
                  {/* Indicator column */}
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${isActive
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
                          {step}
                        </span>
                      )}
                    </div>
                    {!isLast && (
                      <div className={`w-px flex-1 my-2 ${isDone ? "bg-blue-500/50" : "bg-white/10"}`} style={{ minHeight: "24px" }} />
                    )}
                  </div>

                  {/* Label column */}
                  <div className={`pb-8 ${isLast ? "pb-0" : ""}`}
                    onClick={() => {
                      if (isDone) {
                        setCurrentStep(i + 1);
                      } else {
                        // Optionally, handle finish action here
                      }
                    }}>
                    <span
                      className={`${isDone? "cursor-pointer" : "cursor-default"} text-sm font-medium leading-8 transition-colors ${isActive ? "text-white" : isDone ? "text-white/50" : "text-white/25"}`}
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

        {/* Footer pinned to bottom */}
        <p className="text-sm text-white/25">
          Have a question?{" "}
          <a href="mailto:hello@openbookings.co" className="text-blue-400 underline-offset-2 hover:underline">
            Reach out here
          </a>
        </p>
      </aside>

      {/* Right content — 3/4 */}
      <section className="w-3/4 flex p-10">
        <div className="bg-white/3 border rounded-2xl w-full p-10 flex flex-col gap-6">
          {/* Step counter + title */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-blue-400/80">
              Step {currentStep} of {STEPS.length}
            </p>

            <h1 className="mt-1.5 text-2xl font-semibold text-white">
              {STEPS[currentStep - 1]}
            </h1>

            <p className="mt-1.5 text-sm text-white/35">
              Note: To be filled in by the signing authority of your organization
            </p>
          </div>

          {/* Adaptive content */}
          <div className="flex-1" />

          {/* Next / Finish button */}
          <div className="flex justify-end">
            <button
              className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-8 py-2.5 rounded-lg transition-colors"
              onClick={() => {
                if (currentStep < STEPS.length) {
                  setCurrentStep(currentStep + 1);
                } else {
                  // Optionally, handle finish action here
                }
              }}
            >
              {currentStep === STEPS.length ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
