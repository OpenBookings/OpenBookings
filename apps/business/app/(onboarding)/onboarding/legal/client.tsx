"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LegalNBoringStep, type LegalNBoringValues } from "../_steps/legal-n-boring";
import { StepNav } from "../_components/step-nav";
import { saveStepData, provisionStripeAccount, type LegalNBoringData } from "../actions";

const EMPTY_LEGAL: LegalNBoringValues = {
  legalCompanyName: "",
  fullName: "",
  roleTitle: "",
  vatNumber: "",
  cocNumber: "",
  partnerAgreementSignedAt: null,
  dpaSignedAt: null,
};

function toValues(saved: LegalNBoringData | undefined): LegalNBoringValues {
  if (!saved) return EMPTY_LEGAL;
  return {
    legalCompanyName: saved.legalCompanyName ?? "",
    fullName: saved.fullName ?? "",
    roleTitle: saved.roleTitle ?? "",
    vatNumber: saved.vatNumber ?? "",
    cocNumber: saved.cocNumber ?? "",
    partnerAgreementSignedAt: saved.partnerAgreement?.signedAt ?? null,
    dpaSignedAt: saved.dpa?.signedAt ?? null,
  };
}

export function LegalClient({ initialValues }: { initialValues?: LegalNBoringData }) {
  const router = useRouter();
  const [values, setValues] = useState<LegalNBoringValues>(() => toValues(initialValues));
  const [isPending, startTransition] = useTransition();

  function handleNext() {
    startTransition(async () => {
      await provisionStripeAccount();
      router.push("/onboarding/stripe");
    });
  }

  function handleBack() {
    router.push("/onboarding/address");
  }

  const nextDisabled =
    !values.legalCompanyName.trim() ||
    !values.fullName.trim() ||
    !values.roleTitle.trim() ||
    !values.vatNumber.trim() ||
    !values.partnerAgreementSignedAt;

  return (
    <>
      <div className="pb-28">
        <LegalNBoringStep
          values={values}
          onChange={(partial) => setValues((prev) => ({ ...prev, ...partial }))}
        />
      </div>
      <StepNav
        showBack
        onBack={handleBack}
        onNext={handleNext}
        nextDisabled={nextDisabled}
        nextLabel="Next"
        isPending={isPending}
      />
    </>
  );
}
