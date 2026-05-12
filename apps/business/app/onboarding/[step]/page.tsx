import { loadStepData } from "../actions";
import { OnboardingStepClient } from "./client";

export default async function OnboardingStepPage() {
  const stepData = await loadStepData();

  return (
    <OnboardingStepClient
      initialCoreInfoText={stepData["core-info-text"]}
      initialCoreInfoLocation={stepData["core-info-location"]}
      initialLegal={stepData["legal-n-boring"]}
    />
  );
}
