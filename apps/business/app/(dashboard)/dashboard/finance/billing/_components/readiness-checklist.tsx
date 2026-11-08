import Link from "next/link";
import { Check, Circle } from "lucide-react";
import type { ReadinessItem } from "@openbookings/billing/readiness";
import type { PropertyChecklist } from "@/lib/billing/queries";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Where each missing item is fixed. */
function fixLink(item: ReadinessItem, propertyId: string): string {
  switch (item) {
    case "stripe_account":
    case "stripe_charges":
      return "/dashboard/finance";
    case "rates_confirmed":
      return `/dashboard/listings/rates-availability?property=${propertyId}`;
    case "legal_details":
      return `/dashboard/listings/property?property=${propertyId}`;
    case "billing_profile":
    case "vat_id_verified":
      return "#billing-details";
  }
}

/** Per property, what is still needed before it can go live and take bookings. */
export function ReadinessChecklist({ properties }: { properties: PropertyChecklist[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ready to take bookings</CardTitle>
        <CardDescription>
          A property can only be published and booked once these are in place, so every commission invoice has the
          details it needs.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {properties.length === 0 ? <p className="text-muted-foreground">You have no properties yet.</p> : null}
        {properties.map((p) => (
          <div key={p.propertyId} className="flex flex-col gap-1.5">
            <p className="font-medium">{p.name}</p>
            {p.missing.length === 0 ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Check className="size-4" aria-hidden /> Everything is in place.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {p.missing.map((m) => (
                  <li key={m.item} className="flex items-center gap-2">
                    <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <Link href={fixLink(m.item, p.propertyId)} className="underline underline-offset-2">
                      {m.text}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
