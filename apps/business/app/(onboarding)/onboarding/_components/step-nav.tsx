"use client";

interface StepNavProps {
  showBack: boolean;
  onBack: () => void;
  onNext: () => void;
  nextDisabled: boolean;
  nextLabel: string;
  isPending: boolean;
}

export function StepNav({ showBack, onBack, onNext, nextDisabled, nextLabel, isPending }: StepNavProps) {
  return (
    <div className="fixed bottom-0 inset-x-0 bg-[#0d0f12]">
      <div className="flex justify-between items-center mx-auto w-full max-w-2xl px-6 py-5 border-t border-white/8">
        <div>
          {showBack && (
            <button
              className="bg-transparent border border-white/20 hover:bg-white/8 disabled:opacity-50 text-white/60 text-sm font-medium px-8 py-2.5 rounded-lg transition-colors"
              onClick={onBack}
            >
              Back
            </button>
          )}
        </div>

        <p className="text-xs text-white/25 select-none">Progress saved after each step</p>

        <div>
          <button
            disabled={isPending || nextDisabled}
            className="bg-ob-brand hover:bg-ob-brand-light disabled:opacity-50 text-white text-sm font-medium px-8 py-2.5 rounded-lg transition-colors"
            onClick={onNext}
          >
            {isPending ? "Saving…" : nextLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
