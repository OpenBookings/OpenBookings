"use client";

import * as React from "react";
import { AGE_RANGES, type TouristTaxRule } from "@openbookings/pricing";
import { formatCents, parseEuroInput } from "@openbookings/pricing/money";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { exampleStay } from "../../_lib/tourist-tax-view";

const money = (cents: number) => formatCents(cents, { whole: "always-decimals" });

const percent = (rate: number) =>
  `${(rate * 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}%`;

interface ExampleCalculatorProps {
  rules: TouristTaxRule[];
  commissionRate: number;
  /** First arrival date shown; the host can change it. */
  defaultArrival: string;
}

/**
 * Try a stay against the rules and see how the money splits. Every number
 * comes from the same calculator and commission maths a real booking uses.
 * Laid out for a sidebar of roughly 24rem.
 */
export function ExampleCalculator({ rules, commissionRate, defaultArrival }: ExampleCalculatorProps) {
  const id = React.useId();
  // Follows the default (a new rule's start date) until the host picks a date.
  const [pickedArrival, setArrival] = React.useState<string | null>(null);
  const arrival = pickedArrival ?? defaultArrival;
  const [nights, setNights] = React.useState("3");
  const [price, setPrice] = React.useState("120");
  const [adults, setAdults] = React.useState("2");
  const [children, setChildren] = React.useState("0");
  const [infants, setInfants] = React.useState("0");
  const [rooms, setRooms] = React.useState("1");

  // "120", "120.50" or "120,50"; anything else prices nothing.
  const priceRead = parseEuroInput(price);
  const result = exampleStay({
    rules,
    commissionRate,
    arrival,
    nights: Number(nights),
    pricePerNightCents: priceRead.ok ? priceRead.cents : Number.NaN,
    adults: Number(adults),
    children: Number(children),
    infants: Number(infants),
    rooms: Number(rooms),
  });

  const field = (
    key: string,
    label: string,
    value: string,
    set: (v: string) => void,
    className: string,
    props: React.ComponentProps<typeof Input> = {},
  ) => (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={`${id}-${key}`} className="text-muted-foreground text-xs">
        {label}
      </Label>
      <Input
        id={`${id}-${key}`}
        value={value}
        onChange={(e) => set(e.target.value)}
        type="number"
        inputMode="numeric"
        className="h-8"
        {...props}
      />
    </div>
  );

  return (
    <Card className="gap-5 p-5">
      <div>
        <h3 className="font-medium">Example booking</h3>
        <p className="text-muted-foreground text-sm">
          Try a stay to see what the guest pays and what you receive.
        </p>
      </div>

      <div className="grid grid-cols-6 gap-3">
        {field("arrival", "Arrival", arrival, setArrival, "col-span-4", {
          type: "date",
          inputMode: undefined,
        })}
        {field("nights", "Nights", nights, setNights, "col-span-2", { min: 1, max: 60 })}
        {field("price", "Room price per night", price, setPrice, "col-span-6", {
          type: "text",
          inputMode: "decimal",
        })}
        {field("adults", "Adults", adults, setAdults, "col-span-3", { min: 1, max: 20 })}
        {field("children", `Children (${AGE_RANGES.children})`, children, setChildren, "col-span-3", { min: 0, max: 20 })}
        {field("infants", `Infants (${AGE_RANGES.infants})`, infants, setInfants, "col-span-3", { min: 0, max: 20 })}
        {field("rooms", "Rooms", rooms, setRooms, "col-span-3", { min: 1, max: 20 })}
      </div>

      <Separator />

      <dl className="flex flex-col gap-2 text-sm">
        <Row label="Room price" value={money(result.stayCents)} />
        {result.touristTax.lines.map((line, i) => (
          <Row
            key={`${line.effectiveFrom}-${i}`}
            label={<span className="text-muted-foreground">Tourist tax · {line.label}</span>}
            value={money(line.amountCents)}
          />
        ))}
        {result.touristTax.lines.length === 0 && (
          <Row label={<span className="text-muted-foreground">Tourist tax</span>} value={money(0)} />
        )}
        <Separator className="my-1" />
        <Row
          label={<span className="font-medium">Guest pays (all-in)</span>}
          value={<span className="font-medium">{money(result.guestTotalCents)}</span>}
        />
        <Row
          label={
            <span className="text-muted-foreground">
              OpenBookings commission · {percent(commissionRate)} of the room price
            </span>
          }
          value={`−${money(result.commissionCents)}`}
        />
        <Separator className="my-1" />
        <Row
          label={<span className="font-medium">You receive</span>}
          value={<span className="font-medium">{money(result.hostReceivesCents)}</span>}
        />
      </dl>

      <p className="text-muted-foreground text-xs">
        Before Stripe&apos;s payment fees. The {money(result.touristTax.totalCents)} tourist tax is
        yours to pay to your town; OpenBookings never takes commission on it.
      </p>
    </Card>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt>{label}</dt>
      <dd className="shrink-0 tabular-nums">{value}</dd>
    </div>
  );
}
