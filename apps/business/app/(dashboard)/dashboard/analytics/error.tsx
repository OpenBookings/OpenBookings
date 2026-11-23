"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

/**
 * A figure that cannot be read shows no figures: wrong numbers are worse than
 * none. The error itself reaches Sentry through onRequestError; this only
 * keeps the dashboard chrome and offers a retry (`retry`, not the older `reset`).
 */
export default function AnalyticsError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <Empty className="gap-5 md:p-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlert aria-hidden />
        </EmptyMedia>
        <EmptyTitle>Analytics couldn&apos;t load</EmptyTitle>
        <EmptyDescription>
          Something went wrong while reading your figures. Try again in a moment.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={() => retry()}>Try again</Button>
      </EmptyContent>
    </Empty>
  );
}
