import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import { pageAccess } from "@/lib/page-access";
import { NoAccessPage } from "@/components/dashboard/no-access-page";
import { EditAccessProvider } from "@/components/dashboard/edit-access";
import { BreadcrumbLabel } from "@/components/dashboard/breadcrumb-labels";
import { RuleForm } from "../_components/rule-form";
import { NoProperty, PricingRulesLoading } from "../_components/states";
import { loadPricingRules } from "../_lib/query";

interface PageProps {
  searchParams: Promise<{ section?: string; plan?: string }>;
}

export default function NewPricingRulePage({ searchParams }: PageProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Suspense fallback={<PricingRulesLoading />}>
        <NewRuleContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function NewRuleContent({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const params = await searchParams;
  const access = await pageAccess("pricingRules");
  if (access.level === "none") return <NoAccessPage navKey="pricingRules" current={access.current} />;
  const { current } = access;
  const data = await loadPricingRules(session, current?.propertyId ?? null);
  if (!data) return <NoProperty />;

  const section = params.section === "discount" ? "discount" : "adjustment";
  const planId = data.plans.some((p) => p.id === params.plan) ? params.plan! : null;

  return (
    <>
      <BreadcrumbLabel segment="pricing-rules" label="Pricing rules" />
      <BreadcrumbLabel segment="new" label={section === "discount" ? "Add discount" : "Add price adjustment"} />
      <EditAccessProvider canEdit={access.level === "edit"} hotelName={current?.propertyName}>
        <RuleForm
          key={section}
          section={section}
          propertyId={data.property.id}
          plans={data.plans}
          rules={data.rules}
          rule={null}
          planId={planId}
        />
      </EditAccessProvider>
    </>
  );
}
