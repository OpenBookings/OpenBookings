"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/auth";
import { managedBy } from "@/lib/apps/managed";
import { getCurrentProperty } from "@/lib/current-property";
import { purgePropertyPage } from "@/lib/purge-property-page";
import {
  deleteRuleGroup,
  saveRuleGroup,
  setRuleGroupActive,
  type RuleGroupResult,
  type SaveRuleGroupInput,
} from "./mutations";
import { PRICING_RULES_PATH } from "./rule-model";
import { priceTryStay, type TryStayInput, type TryStayResult } from "./try-stay";

/**
 * Server actions behind the Pricing rules page. The writes live in
 * mutations.ts (ownership checked there); these add the session, refresh the
 * page and R&A (whose grid prices with the rules), and purge the public
 * listing, which shows "from" prices.
 */

const RATES_AVAILABILITY_PATH = "/dashboard/listings/rates-availability";

async function requireSession() {
  const session = await getServerSession();
  if (!session) throw new Error("Not signed in");
  return session;
}

async function afterChange(result: RuleGroupResult): Promise<RuleGroupResult> {
  if (result.ok) {
    revalidatePath(PRICING_RULES_PATH, "layout");
    revalidatePath(RATES_AVAILABILITY_PATH);
    await purgePropertyPage({ propertyId: result.propertyId });
  }
  return result;
}

export async function saveRuleGroupAction(input: SaveRuleGroupInput): Promise<RuleGroupResult> {
  return afterChange(await saveRuleGroup(await requireSession(), input));
}

export async function setRuleGroupActiveAction(groupId: string, active: boolean): Promise<RuleGroupResult> {
  return afterChange(await setRuleGroupActive(await requireSession(), groupId, active));
}

export async function deleteRuleGroupAction(groupId: string): Promise<RuleGroupResult> {
  return afterChange(await deleteRuleGroup(await requireSession(), groupId));
}

export async function tryStayAction(input: TryStayInput): Promise<TryStayResult> {
  // Priced on the current hotel only: a plan of any other hotel is not found.
  const session = await requireSession();
  const propertyId = (await getCurrentProperty())?.propertyId ?? null;
  // SiteMinder prices a managed hotel's nights, so our rules would preview a price no guest pays.
  if (propertyId && (await managedBy(propertyId))) {
    return { ok: false, error: "Not applied to rates managed by SiteMinder." };
  }
  return priceTryStay(session, propertyId, input);
}
