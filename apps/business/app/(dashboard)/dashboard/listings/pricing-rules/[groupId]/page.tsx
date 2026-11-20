import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import { BreadcrumbLabel } from "@/components/dashboard/breadcrumb-labels";
import { RuleForm } from "../_components/rule-form";
import { PricingRulesLoading } from "../_components/states";
import { loadRuleGroup } from "../_lib/query";
import { sectionOf } from "../_lib/rule-model";

interface PageProps {
  params: Promise<{ groupId: string }>;
}

export default function EditPricingRulePage({ params }: PageProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Suspense fallback={<PricingRulesLoading />}>
        <EditRuleContent params={params} />
      </Suspense>
    </div>
  );
}

async function EditRuleContent({ params }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const { groupId } = await params;
  // Host-scoped: another host's rule and a made-up id are the same 404.
  const loaded = await loadRuleGroup(session, groupId);
  if (!loaded) notFound();
  const section = sectionOf(loaded.rule);

  return (
    <>
      <BreadcrumbLabel segment="pricing-rules" label="Pricing rules" />
      <BreadcrumbLabel segment={groupId} label={section === "discount" ? "Edit discount" : "Edit price adjustment"} />
      <RuleForm
        section={section}
        propertyId={loaded.data.property.id}
        plans={loaded.data.plans}
        rules={loaded.data.rules}
        rule={loaded.rule}
        planId={null}
      />
    </>
  );
}
