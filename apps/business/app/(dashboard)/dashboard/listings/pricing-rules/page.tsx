import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import { getCurrentProperty } from "@/lib/current-property";
import { BreadcrumbLabel } from "@/components/dashboard/breadcrumb-labels";
import { RulesPage } from "./_components/rules-page";
import { NoProperty, PricingRulesLoading } from "./_components/states";
import { loadPricingRules } from "./_lib/query";

export default function PricingRulesPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Suspense fallback={<PricingRulesLoading />}>
        <PricingRulesContent />
      </Suspense>
    </div>
  );
}

async function PricingRulesContent() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const current = await getCurrentProperty();
  const data = await loadPricingRules(session, current?.propertyId ?? null);
  if (!data) return <NoProperty />;

  return (
    <>
      <BreadcrumbLabel segment="pricing-rules" label="Pricing rules" />
      <RulesPage data={data} />
    </>
  );
}
