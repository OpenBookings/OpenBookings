import Link from "next/link";
import { ChartNoAxesColumn, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * Shown for a property that has never taken a booking — not for one having a
 * quiet fortnight. There is nothing to arrange on the page yet, so the sections
 * are hidden rather than filled with dashes.
 */
export function NewPropertyAlert({ showDemoLink }: { showDemoLink: boolean }) {
  return (
    <Alert className="mx-4 lg:mx-6">
      <ChartNoAxesColumn />
      <AlertTitle>No analytics yet</AlertTitle>
      <AlertDescription>
        <p>Your analytics will appear once you receive your first booking.</p>
        {showDemoLink ? (
          <p>
            {/* Without this the demo is discoverable only to whoever knows the
                flag, which makes the whole tab look unbuilt. */}
            <Link href="?demo=1" className="underline underline-offset-4">
              Preview with demo data
            </Link>{" "}
            to see what this page will show you.
          </p>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

/**
 * Unmissable, because every figure below it is invented. Mirrors the banner on
 * the rates-availability grid, for the same reason: a host must never mistake
 * demo numbers for their own.
 */
export function DemoBanner() {
  return (
    <div className="flex items-center gap-2 border-(--amber-11)/30 border-b bg-(--amber-3) px-4 py-2 text-(--amber-11) text-sm lg:px-6">
      <TriangleAlert className="size-4 shrink-0" aria-hidden />
      <span>
        Demo data — none of these numbers are yours.{" "}
        <Link href="/dashboard/analytics" className="underline">
          Switch to your own analytics
        </Link>
        .
      </span>
    </div>
  );
}
