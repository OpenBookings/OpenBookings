"use client";

// The section tree renders on the client. Every widget hands WidgetFrame a
// render prop and every chart a formatter, and a function cannot cross a
// server-to-client boundary — React rejects it at render. The seam the spec
// cares about is untouched: getAnalytics() still derives on the server and only
// the finished view model is serialized, never the fact rows.

import { formatCount, formatPercent } from "@/lib/analytics/format";
import type { AnalyticsData } from "@/lib/analytics/types";
import { KpiValue } from "./kpi-card";
import { RankedList } from "./ranked-list";
import { KpiGrid, SectionShell } from "./section-shell";
import { WidgetFrame } from "./widget-frame";

export function GuestsSectionView({ data }: { data: AnalyticsData }) {
  const { guests } = data;

  return (
    <SectionShell
      id="guests"
      title="Guests"
      description="Countries with fewer than five bookings are grouped as Other, so no single guest can be identified."
      data={data}
    >
      <KpiGrid>
        <WidgetFrame
          title="Average party size"
          definition="Average guests per booking, adults and children together."
          widget={guests.averagePartySize}
        >
          {(size) => (
            <KpiValue value={size === null ? "—" : size.toFixed(1)} />
          )}
        </WidgetFrame>

        <WidgetFrame
          title="Repeat guests"
          definition="Share of bookings from guests who had stayed with you before — measured across all your history, not just this period."
          widget={guests.repeatGuestPct}
        >
          {(pct) => <KpiValue value={formatPercent(pct)} />}
        </WidgetFrame>
      </KpiGrid>

      <WidgetFrame
        title="Country of origin"
        definition="Bookings per country. Countries with fewer than five bookings are grouped as Other."
        widget={guests.countries}
        bookingsInPeriod={data.bookingsInPeriod}
        requiresDetail
      >
        {(rows) => (
          <RankedList rows={rows} format={(count) => `${formatCount(count)} bookings`} />
        )}
      </WidgetFrame>
    </SectionShell>
  );
}
