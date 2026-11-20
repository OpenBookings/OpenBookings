import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import { BreadcrumbLabel } from "@/components/dashboard/breadcrumb-labels";
import { RulesPage } from "./_components/rules-page";
import { NoProperty, PricingRulesLoading } from "./_components/states";
import { loadPricingRules } from "./_lib/query";

interface PageProps {
  searchParams: Promise<{ property?: string }>;
}

export default function PricingRulesPage({ searchParams }: PageProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Suspense fallback={<PricingRulesLoading />}>
        <PricingRulesContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function PricingRulesContent({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const { property } = await searchParams;
  const data = await loadPricingRules(session, property);
  if (!data) return <NoProperty />;

  return (
    <>
      <BreadcrumbLabel segment="pricing-rules" label="Pricing rules" />
      <RulesPage data={data} />
    </>
  );
}
