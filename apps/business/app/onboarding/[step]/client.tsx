"use client";

import { useState, useTransition } from "react";
import { useParams, useRouter } from "next/navigation";
import { HOST_STEPS } from "../steps";
import { CoreInfoTextStep, type CoreInfoTextValues } from "./_steps/core-info-text";
import { CoreInfoLocationStep, type CoreInfoLocationValues } from "./_steps/core-info-location";
import { LegalNBoringStep, type LegalNBoringValues } from "./_steps/legal-n-boring";
import { saveStepData } from "../actions";
import type { CoreInfoTextData, CoreInfoLocationData, LegalNBoringData } from "../actions";

const EMPTY_TEXT: CoreInfoTextValues = {
  displayName: "",
  tagline: "",
  description: "",
  photos: [],
  houseRulesText: "",
};

const EMPTY_LOCATION: CoreInfoLocationValues = {
  streetAddress: "",
  city: "",
  country: "",
  postalCode: "",
  coordinates: null,
};

const EMPTY_LEGAL: LegalNBoringValues = {
  legalCompanyName: "",
  fullName: "",
  roleTitle: "",
  vatNumber: "",
  cocNumber: "",
  partnerAgreementSignedAt: null,
  dpaSignedAt: null,
};

function toCoreInfoTextValues(saved: CoreInfoTextData | undefined): CoreInfoTextValues {
  if (!saved) return EMPTY_TEXT;
  return { ...EMPTY_TEXT, ...saved };
}

function toCoreInfoLocationValues(saved: CoreInfoLocationData | undefined): CoreInfoLocationValues {
  if (!saved) return EMPTY_LOCATION;
  return { ...EMPTY_LOCATION, ...saved };
}

function toLegalValues(saved: LegalNBoringData | undefined): LegalNBoringValues {
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

interface Props {
  initialCoreInfoText?: CoreInfoTextData;
  initialCoreInfoLocation?: CoreInfoLocationData;
  initialLegal?: LegalNBoringData;
}

export function OnboardingStepClient({ initialCoreInfoText, initialCoreInfoLocation, initialLegal }: Props) {
  const params = useParams();
  const router = useRouter();
  const currentSlug = params.step as string;
  const currentIndex = HOST_STEPS.indexOf(currentSlug as typeof HOST_STEPS[number]);

  const [coreInfoText, setCoreInfoText] = useState<CoreInfoTextValues>(() =>
    toCoreInfoTextValues(initialCoreInfoText)
  );
  const [coreInfoLocation, setCoreInfoLocation] = useState<CoreInfoLocationValues>(() =>
    toCoreInfoLocationValues(initialCoreInfoLocation)
  );
  const [legal, setLegal] = useState<LegalNBoringValues>(() =>
    toLegalValues(initialLegal)
  );
  const [isPending, startTransition] = useTransition();

  function isNextDisabled() {
    if (currentSlug === "core-info-text") {
      return !coreInfoText.displayName.trim();
    }
    if (currentSlug === "core-info-location") {
      return !coreInfoLocation.streetAddress.trim() || !coreInfoLocation.city.trim();
    }
    if (currentSlug === "legal-n-boring") {
      return (
        !legal.legalCompanyName.trim() ||
        !legal.fullName.trim() ||
        !legal.roleTitle.trim() ||
        !legal.vatNumber.trim() ||
        !legal.partnerAgreementSignedAt
      );
    }
    return false;
  }

  function handleNext() {
    startTransition(async () => {
      if (currentSlug === "core-info-text") {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { photos: _photos, ...serializable } = coreInfoText;
        await saveStepData("core-info-text", serializable);
      }
      if (currentSlug === "core-info-location") {
        await saveStepData("core-info-location", coreInfoLocation);
      }
      const nextIndex = currentIndex + 1;
      if (nextIndex < HOST_STEPS.length) {
        router.push(`/onboarding/${HOST_STEPS[nextIndex]}`);
      } else {
        router.push("/dashboard");
      }
    });
  }

  function handlePrevious() {
    startTransition(async () => {
      const previousIndex = currentIndex - 1;
      if (previousIndex >= 0) {
        router.push(`/onboarding/${HOST_STEPS[previousIndex]}`);
      }
    });
  }

  return (
    <>
      <div className="pb-28">
        {currentSlug === "core-info-text" && (
          <CoreInfoTextStep
            values={coreInfoText}
            onChange={(partial) => setCoreInfoText((prev) => ({ ...prev, ...partial }))}
          />
        )}
        {currentSlug === "core-info-location" && (
          <CoreInfoLocationStep
            values={coreInfoLocation}
            onChange={(partial) => setCoreInfoLocation((prev) => ({ ...prev, ...partial }))}
          />
        )}
        {currentSlug === "legal-n-boring" && (
          <LegalNBoringStep
            values={legal}
            onChange={(partial) => setLegal((prev) => ({ ...prev, ...partial }))}
          />
        )}
      </div>

      <div className="fixed bottom-0 inset-x-0 bg-[#0d0f12]">
      <div className="flex justify-between items-center mx-auto w-full max-w-2xl px-6 py-5 border-t border-white/8">
        <div>
          {currentIndex > 0 && (
            <button
              className="bg-transparent border border-white/20 hover:bg-white/8 disabled:opacity-50 text-white/60 text-sm font-medium px-8 py-2.5 rounded-lg transition-colors"
              onClick={handlePrevious}
            >
              Back
            </button>
          )}
        </div>

        <p className="text-xs text-white/25 select-none">Progress saved after each step</p>

        <div>
          <button
            disabled={isPending || isNextDisabled()}
            className="bg-ob-brand hover:bg-ob-brand-light disabled:opacity-50 text-white text-sm font-medium px-8 py-2.5 rounded-lg transition-colors"
            onClick={handleNext}
          >
            {isPending ? "Saving…" : currentIndex === HOST_STEPS.length - 1 ? "Finish" : "Next"}
          </button>
        </div>
      </div>
      </div>
    </>
  );
}
