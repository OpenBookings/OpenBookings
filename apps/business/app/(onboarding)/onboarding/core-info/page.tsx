import { loadStepData } from "../actions";
import { CoreInfoClient } from "./client";

export default async function CoreInfoPage() {
  const stepData = await loadStepData();
  return <CoreInfoClient initialValues={stepData["core-info-text"]} />;
}
