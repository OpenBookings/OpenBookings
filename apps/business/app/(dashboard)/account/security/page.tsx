import { SiteHeader } from "@/components/dashboard/site-header";
import { SecurityPanel } from "./security-panel";
import { CookieSettingsButton } from "@/components/CookieSettingsButton";

export default function SecurityPage() {
  return (
    <>
      <SiteHeader title="Security" />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="@container/main flex min-h-0 flex-1 flex-col gap-2">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-12 sm:px-8">
            <div className="mx-auto flex w-full max-w-[880px] flex-col gap-10">
              <SecurityPanel />
              {/* The landing-page footer is the only other place this lives, and
                  signed-in hosts never see that. */}
              <p className="text-xs text-muted-foreground">
                Analytics cookies:{" "}
                <CookieSettingsButton className="underline underline-offset-2 hover:text-foreground" />
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
