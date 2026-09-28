"use client";

import * as React from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { csvFilename, sectionCsv, type SectionId } from "@/lib/analytics/csv";
import type { AnalyticsData } from "@/lib/analytics/types";

/**
 * Client-side Blob rather than a route handler: the view model is already here,
 * so a round trip could only fetch data that might have moved on and produce a
 * file that disagrees with the screen.
 */
export function ExportButton({
  data,
  section,
  label,
}: {
  data: AnalyticsData;
  section: SectionId;
  label: string;
}) {
  const [busy, setBusy] = React.useState(false);

  const download = () => {
    setBusy(true);
    try {
      const blob = new Blob([sectionCsv(data, section)], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = csvFilename(data, section);
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={download}
      disabled={busy}
      aria-label={`Export ${label} as CSV`}
    >
      <Download aria-hidden />
      Export CSV
    </Button>
  );
}
