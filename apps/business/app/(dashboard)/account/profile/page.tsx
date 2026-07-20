import { SiteHeader } from "@/components/dashboard/site-header";
import { ComingSoon } from "@/components/dashboard/coming-soon";

export default function ProfilePage() {
  return (
    <>
      <SiteHeader title="Profile" />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
            <ComingSoon title="Profile" />
          </div>
        </div>
      </div>
    </>
  );
}
