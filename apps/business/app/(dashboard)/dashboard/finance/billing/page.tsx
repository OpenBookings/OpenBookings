import { redirect } from "next/navigation";
import { roleAllows } from "@openbookings/authz/permissions";
import { getBillingProfile } from "@openbookings/billing/profiles";
import { countryNameOf } from "@openbookings/billing/render/document";
import { EU_COUNTRY_CODES, vatTreatmentFor } from "@openbookings/billing/vat";
import { getServerSession } from "@/lib/auth";
import { billingAccess } from "@/lib/billing/scope";
import { listInvoices, organizationReadiness, upcomingInvoice } from "@/lib/billing/queries";
import { SiteHeader } from "@/components/dashboard/site-header";
import { Card, CardContent } from "@/components/ui/card";
import { BillingDetailsForm, type VatStatus } from "./_components/billing-details-form";
import { InvoiceList } from "./_components/invoice-list";
import { ReadinessChecklist } from "./_components/readiness-checklist";
import { UpcomingInvoiceCard } from "./_components/upcoming-invoice";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function checkedOn(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return `${get("day")} ${MONTHS[get("month") - 1]} ${get("year")}`;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader title="Finance" />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="@container/main flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-4 md:gap-6 md:py-6">{children}</div>
        </div>
      </div>
    </>
  );
}

export default async function BillingPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  // Access is decided here on every request, not by the layout.
  const scope = await billingAccess(session, { billing: ["read"] });
  if (!scope) {
    return (
      <Shell>
        <div className="px-4 lg:px-6">
          <Card>
            <CardContent className="text-sm text-muted-foreground">
              Billing is visible to owners, general managers and back office.
            </CardContent>
          </Card>
        </div>
      </Shell>
    );
  }

  const canUpdate = roleAllows(scope.memberRole, { billing: ["update"] }, false);
  const [profile, invoices, upcoming, properties] = await Promise.all([
    getBillingProfile(scope.db, scope.organizationId),
    listInvoices(scope),
    upcomingInvoice(scope, new Date()),
    organizationReadiness(scope),
  ]);

  let vatStatus: VatStatus = { state: "none", checkedOn: null };
  if (profile?.vatId && profile.countryCode) {
    let reverse = false;
    try {
      reverse = vatTreatmentFor(profile.countryCode) === "EU_REVERSE_CHARGE";
    } catch {
      reverse = true;
    }
    if (!reverse) vatStatus = { state: "not_needed", checkedOn: null };
    else if (profile.vatIdValid === true) vatStatus = { state: "verified", checkedOn: profile.vatIdCheckedAt ? checkedOn(profile.vatIdCheckedAt) : null };
    else if (profile.vatIdValid === false) vatStatus = { state: "invalid", checkedOn: null };
    else vatStatus = { state: "unverified", checkedOn: null };
  }

  const countries = EU_COUNTRY_CODES.map((code) => ({ code, name: countryNameOf(code) })).sort((a, b) => a.name.localeCompare(b.name));
  const values = {
    legalName: profile?.legalName ?? "",
    addressLine1: profile?.addressLine1 ?? "",
    addressLine2: profile?.addressLine2 ?? "",
    postalCode: profile?.postalCode ?? "",
    city: profile?.city ?? "",
    countryCode: profile?.countryCode ?? "",
    vatId: profile?.vatId ?? "",
    kvkNumber: profile?.kvkNumber ?? "",
    billingEmail: profile?.billingEmail ?? "",
  };

  return (
    <Shell>
      <div className="flex flex-col gap-4 px-4 md:gap-6 lg:px-6">
        <UpcomingInvoiceCard upcoming={upcoming} />
        <InvoiceList invoices={invoices} />
        <BillingDetailsForm values={values} countries={countries} vatStatus={vatStatus} canUpdate={canUpdate} />
        <ReadinessChecklist properties={properties} />
      </div>
    </Shell>
  );
}
