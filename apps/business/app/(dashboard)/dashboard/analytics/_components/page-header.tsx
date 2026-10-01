"use client";

import type { PeriodPreset } from "@/lib/analytics/period";
import type { AnyPageData } from "@/lib/analytics/types";
import { ExportButton } from "./export-button";
import { PeriodControl } from "./period-control";

interface PageHeaderProps {
  title: string;
  description: string;
  preset: PeriodPreset;
  data: AnyPageData;
  exportDisabledReason: string | null;
}

/** The same on every page: what this is on the left, period and export on the right. */
export function PageHeader({ title, description, preset, data, exportDisabledReason }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-4 lg:px-6">
      <div className="min-w-0">
        <h1 className="font-semibold text-lg">{title}</h1>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PeriodControl
          preset={preset}
          range={data.range}
          compare={data.compare}
          canCompareLastYear={data.canCompareLastYear}
        />
        <ExportButton data={data} disabledReason={exportDisabledReason} />
      </div>
    </div>
  );
}
