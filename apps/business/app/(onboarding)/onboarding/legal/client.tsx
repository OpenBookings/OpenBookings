"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LegalNBoringStep, type LegalNBoringValues } from "../_steps/legal-n-boring";
import { StepNav } from "../_components/step-nav";
import { provisionStripeAccount, type LegalNBoringData } from "../actions";
import { isCurrentHostAgreement } from "../_lib/host-agreement";

const EMPTY_LEGAL: LegalNBoringValues = {
  legalCompanyName: "",
  fullName: "",
  roleTitle: "",
  vatNumber: "",
  cocNumber: "",
  hostAgreementSignedAt: null,
  ratesInclusiveConfirmedAt: null,
};

function toValues(saved: LegalNBoringData | undefined): LegalNBoringValues {
  if (!saved) return EMPTY_LEGAL;
  return {
    legalCompanyName: saved.legalCompanyName ?? "",
    fullName: saved.fullName ?? "",
    roleTitle: saved.roleTitle ?? "",
    vatNumber: saved.vatNumber ?? "",
    cocNumber: saved.cocNumber ?? "",
    // Only an acceptance of the version in force counts; an older one (or a
    // legacy "Partner Agreement" click) means accepting again.
    hostAgreementSignedAt: isCurrentHostAgreement(saved.hostAgreement)
      ? saved.hostAgreement!.signedAt
      : null,
    ratesInclusiveConfirmedAt: saved.ratesInclusive?.signedAt ?? null,
  };
}

export function LegalClient({
  initialValues,
  agreementUrl,
}: {
  initialValues?: LegalNBoringData;
  agreementUrl: string | null;
}) {
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
    !values.hostAgreementSignedAt ||
    !values.ratesInclusiveConfirmedAt;

  return (
    <>
      <div className="pb-28">
        <LegalNBoringStep
          values={values}
          agreementUrl={agreementUrl}
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
