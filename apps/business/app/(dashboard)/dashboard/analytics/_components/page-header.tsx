"use client";

import { PageHeader as ConsolePageHeader } from "@/components/dashboard/page-header";
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
    <ConsolePageHeader
      title={title}
      description={description}
      className="px-4 lg:px-6"
      actions={
        <>
          <PeriodControl
            preset={preset}
            range={data.range}
            compare={data.compare}
            canCompareLastYear={data.canCompareLastYear}
          />
          <ExportButton data={data} disabledReason={exportDisabledReason} />
        </>
      }
    />
  );
}
