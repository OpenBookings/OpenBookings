import { SiteHeader } from "@/components/dashboard/site-header";

/**
 * The header and scroll area both Finance pages share, so it is already on
 * screen while a page's loader runs. No loading.tsx here or above: each page
 * has its own, with the logo loader.
 */
export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader title="Finance" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="@container/main flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto py-4 md:gap-6 md:py-6">
            {children}
          </div>
        </div>
      </div>
    </>
  );
}
