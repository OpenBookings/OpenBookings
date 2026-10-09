"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { CoreInfoLocationValues } from "../_steps/core-info-location";
import { StepNav } from "../_components/step-nav";
import { saveStepData, type CoreInfoLocationData } from "../actions";

const CoreInfoLocationStep = dynamic(
  () => import("../_steps/core-info-location").then((m) => m.CoreInfoLocationStep),
  { ssr: false, loading: () => <div className="h-96 animate-pulse rounded-xl bg-white/5" aria-hidden /> },
);

const EMPTY_LOCATION: CoreInfoLocationValues = {
  streetAddress: "",
  city: "",
  country: "",
  postalCode: "",
  coordinates: null,
};

function toValues(saved: CoreInfoLocationData | undefined): CoreInfoLocationValues {
  if (!saved) return EMPTY_LOCATION;
  return { ...EMPTY_LOCATION, ...saved };
}

export function AddressClient({ initialValues }: { initialValues?: CoreInfoLocationData }) {
  const router = useRouter();
  const [values, setValues] = useState<CoreInfoLocationValues>(() => toValues(initialValues));
  const [isPending, startTransition] = useTransition();

  function handleNext() {
    startTransition(async () => {
      await saveStepData("core-info-location", values);
      router.push("/onboarding/legal");
    });
  }

  function handleBack() {
    router.push("/onboarding/core-info");
  }

  return (
    <>
      <div className="pb-28">
        <CoreInfoLocationStep
          values={values}
          onChange={(partial) => setValues((prev) => ({ ...prev, ...partial }))}
        />
      </div>
      <StepNav
        showBack
        onBack={handleBack}
        onNext={handleNext}
        nextDisabled={!values.streetAddress.trim() || !values.city.trim()}
        nextLabel="Next"
        isPending={isPending}
      />
    </>
  );
}
