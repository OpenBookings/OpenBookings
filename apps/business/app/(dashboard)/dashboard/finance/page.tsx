import { SiteHeader } from "@/components/dashboard/site-header";
import { ComingSoon } from "@/components/dashboard/coming-soon";

export default function FinancePage() {
  return (
    <>
      <SiteHeader title="Finance" />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
            <ComingSoon title="Finance" />
          </div>
        </div>
      </div>
    </>
  );
}
