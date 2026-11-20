import { BuildingIcon } from "lucide-react";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";

/** While the rules load: a quiet spinner, never a skeleton (business app rule). */
export function PricingRulesLoading() {
  return (
    <div role="status" className="flex flex-1 items-center justify-center gap-2 p-8 text-muted-foreground text-sm">
      <Spinner />
      Loading pricing rules
    </div>
  );
}

/** Same dead end as the Rooms page: rules hang off rate plans of a property onboarding creates. */
export function NoProperty() {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BuildingIcon />
        </EmptyMedia>
        <EmptyTitle>No listing yet</EmptyTitle>
        <EmptyDescription>
          Your property has not been set up. Finish onboarding, or contact support if you have already completed it.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <a href="/support" className="text-sm underline underline-offset-2 hover:no-underline">
          Contact support
        </a>
      </EmptyContent>
    </Empty>
  );
}
