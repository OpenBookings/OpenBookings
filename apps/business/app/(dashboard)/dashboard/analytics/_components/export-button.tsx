"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { csvFilename, pageCsv } from "@/lib/analytics/csv";
import type { AnyPageData } from "@/lib/analytics/types";

/**
 * Built in the browser from the view model already on screen, so the file
 * cannot disagree with the page and carries the same suppression. Disabled
 * with a reason in demo mode: demo numbers must never reach a host's books.
 */
export function ExportButton({
  data,
  disabledReason,
}: {
  data: AnyPageData;
  disabledReason: string | null;
}) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([pageCsv(data)], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = csvFilename(data);
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const button = (
    <Button variant="outline" size="sm" onClick={download} disabled={disabledReason !== null}>
      <Download aria-hidden />
      Export CSV
    </Button>
  );

  if (disabledReason === null) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{button}</span>
      </TooltipTrigger>
      <TooltipContent>{disabledReason}</TooltipContent>
    </Tooltip>
  );
}
