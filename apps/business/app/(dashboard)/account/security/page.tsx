import { SiteHeader } from "@/components/dashboard/site-header";
import { ComingSoon } from "@/components/dashboard/coming-soon";

export default function SecurityPage() {
  return (
    <>
      <SiteHeader title="Security" />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="@container/main flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-4 md:gap-6 md:py-6">
            <ComingSoon title="Security" />
          </div>
        </div>
      </div>
    </>
  );
}
