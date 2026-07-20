import { loadStepData } from "../actions";
import { AddressClient } from "./client";

export default async function AddressPage() {
  const stepData = await loadStepData();
  return <AddressClient initialValues={stepData["core-info-location"]} />;
}
