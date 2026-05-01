"use client";

import { useState, useTransition } from "react";
import { useParams, useRouter } from "next/navigation";
import { HOST_STEPS } from "../steps";
import { CoreInfoStep, type CoreInfoValues } from "./_steps/core-info";
import { LegalNBoringStep, type LegalNBoringValues } from "./_steps/legal-n-boring";
import { AddTeamsStep, type AddTeamsValues } from "./_steps/add-teams";
import { saveStepData } from "../actions";
import type { CoreInfoData, LegalNBoringData } from "../actions";

const EMPTY_CORE_INFO: CoreInfoValues = {
  displayName: "",
  description: "",
  streetAddress: "",
  city: "",
  country: "",
  postalCode: "",
  coordinates: null,
  photos: [],
  houseRulesText: "",
};

const EMPTY_TEAMS: AddTeamsValues = {
  teams: [],
};

const EMPTY_LEGAL: LegalNBoringValues = {
  legalCompanyName: "",
  fullName: "",
  roleTitle: "",
  partnerAgreementSignedAt: null,
  dpaSignedAt: null,
};

function toCoreInfoValues(saved: CoreInfoData | undefined): CoreInfoValues {
  if (!saved) return EMPTY_CORE_INFO;
  return { ...EMPTY_CORE_INFO, ...saved };
}

function toLegalValues(saved: LegalNBoringData | undefined): LegalNBoringValues {
  if (!saved) return EMPTY_LEGAL;
  return {
    legalCompanyName: saved.legalCompanyName ?? "",
    fullName: saved.fullName ?? "",
    roleTitle: saved.roleTitle ?? "",
    partnerAgreementSignedAt: saved.partnerAgreement?.signedAt ?? null,
    dpaSignedAt: saved.dpa?.signedAt ?? null,
  };
}

interface Props {
  initialCoreInfo?: CoreInfoData;
  initialLegal?: LegalNBoringData;
}

export function OnboardingStepClient({ initialCoreInfo, initialLegal }: Props) {
  const params = useParams();
  const router = useRouter();
  const currentSlug = params.step as string;
  const currentIndex = HOST_STEPS.indexOf(currentSlug as typeof HOST_STEPS[number]);

  const [coreInfo, setCoreInfo] = useState<CoreInfoValues>(() =>
    toCoreInfoValues(initialCoreInfo)
  );
  const [teams, setTeams] = useState<AddTeamsValues>(EMPTY_TEAMS);
  const [legal, setLegal] = useState<LegalNBoringValues>(() =>
    toLegalValues(initialLegal)
  );
  const [isPending, startTransition] = useTransition();

  function isNextDisabled() {
    if (currentSlug === "legal-n-boring") {
      return (
        !legal.legalCompanyName.trim() ||
        !legal.fullName.trim() ||
        !legal.roleTitle.trim() ||
        !legal.partnerAgreementSignedAt ||
        !legal.dpaSignedAt
      );
    }
    return false;
  }

  function handleNext() {
    startTransition(async () => {
      if (currentSlug === "core-info") {
        // Exclude File objects — photos need a separate upload flow
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { photos: _photos, ...serializable } = coreInfo;
        await saveStepData("core-info", serializable);
      }
      if (currentSlug === "add-teams") {
        await saveStepData("add-teams", teams);
      }

      const nextIndex = currentIndex + 1;
      if (nextIndex < HOST_STEPS.length) {
        router.push(`/onboarding/${HOST_STEPS[nextIndex]}`);
      } else {
        // TODO: mark onboarding complete and redirect to dashboard
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
      <div className="flex-1 overflow-y-auto min-h-0 mt-6">
        {currentSlug === "core-info" && (
          <CoreInfoStep
            values={coreInfo}
            onChange={(partial) => setCoreInfo((prev) => ({ ...prev, ...partial }))}
          />
        )}
        {currentSlug === "add-teams" && (
          <AddTeamsStep
            values={teams}
            onChange={(partial) => setTeams((prev) => ({ ...prev, ...partial }))}
          />
        )}
        {currentSlug === "legal-n-boring" && (
          <LegalNBoringStep
            values={legal}
            onChange={(partial) => setLegal((prev) => ({ ...prev, ...partial }))}
          />
        )}
      </div>

      <div className="flex border-t justify-between items-center py-4">
        <div>
          {currentIndex > 0 && (
            <button
              className="bg-transparent border border-white/25 hover:bg-white/10 disabled:opacity-50 text-white/70 text-sm font-medium px-8 py-2.5 rounded-lg transition-colors"
              onClick={handlePrevious}
            >
              Back
            </button>
          )}
        </div>
   
        <div>
          <button
            disabled={isPending || isNextDisabled()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium px-8 py-2.5 rounded-lg transition-colors"
            onClick={handleNext}
          >
            {isPending ? "Saving…" : currentIndex === HOST_STEPS.length - 1 ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </>
  );
}
