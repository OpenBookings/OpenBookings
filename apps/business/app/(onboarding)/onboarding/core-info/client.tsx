"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CoreInfoTextStep, type CoreInfoTextValues } from "../_steps/core-info-text";
import { StepNav } from "../_components/step-nav";
import { saveStepData, type CoreInfoTextData } from "../actions";

const EMPTY_TEXT: CoreInfoTextValues = {
  displayName: "",
  tagline: "",
  description: "",
  photos: [],
  houseRulesText: "",
};

function toValues(saved: CoreInfoTextData | undefined): CoreInfoTextValues {
  if (!saved) return EMPTY_TEXT;
  return { ...EMPTY_TEXT, ...saved };
}

export function CoreInfoClient({ initialValues }: { initialValues?: CoreInfoTextData }) {
  const router = useRouter();
  const [values, setValues] = useState<CoreInfoTextValues>(() => toValues(initialValues));
  const [isPending, startTransition] = useTransition();

  function handleNext() {
    startTransition(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { photos: _photos, ...serializable } = values;
      await saveStepData("core-info-text", serializable);
      router.push("/onboarding/address");
    });
  }

  return (
    <>
      <div className="pb-28">
        <CoreInfoTextStep
          values={values}
          onChange={(partial) => setValues((prev) => ({ ...prev, ...partial }))}
        />
      </div>
      <StepNav
        showBack={false}
        onBack={() => {}}
        onNext={handleNext}
        nextDisabled={!values.displayName.trim()}
        nextLabel="Next"
        isPending={isPending}
      />
    </>
  );
}
