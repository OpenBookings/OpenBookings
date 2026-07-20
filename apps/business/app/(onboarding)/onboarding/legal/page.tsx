import { loadStepData } from "../actions";
import { LegalClient } from "./client";

export default async function LegalPage() {
  const stepData = await loadStepData();
  return <LegalClient initialValues={stepData["legal-n-boring"]} />;
}
