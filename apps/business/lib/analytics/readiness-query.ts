import { queryOne } from "@openbookings/db";
import { retrieveConnectAccount } from "@openbookings/stripe";
import { createReadinessLoader } from "./readiness-loader";

/** The readiness checklist for the signed-in host, wired to the real database and Stripe. */
export const getReadiness = createReadinessLoader({
  queryOne,
  retrieveAccount: retrieveConnectAccount,
});
