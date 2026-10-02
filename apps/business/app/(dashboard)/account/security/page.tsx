import { SiteHeader } from "@/components/dashboard/site-header";
import { SecurityPanel } from "./security-panel";
import { CookieSettingsButton } from "@/components/CookieSettingsButton";

export default function SecurityPage() {
  return (
    <>
      <SiteHeader title="Security" />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="@container/main flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-4 md:gap-6 md:py-6">
            <SecurityPanel />
            {/* The landing-page footer is the only other place this lives, and
                signed-in hosts never see that. */}
            <p className="px-4 text-xs text-muted-foreground lg:px-6">
              Analytics cookies:{" "}
              <CookieSettingsButton className="underline underline-offset-2 hover:text-foreground" />
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
