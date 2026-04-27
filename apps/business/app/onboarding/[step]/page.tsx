import { loadStepData } from "../actions";
import { OnboardingStepClient } from "./client";

export default async function OnboardingStepPage() {
  const stepData = await loadStepData();

  return (
    <OnboardingStepClient
      initialCoreInfo={stepData["core-info"]}
      initialLegal={stepData["legal-n-boring"]}
    />
  );
}
