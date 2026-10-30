"use client";

import * as React from "react";
import type { TouristTaxRule } from "@openbookings/pricing";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { exampleStay } from "../../_lib/tourist-tax-view";

const eur = new Intl.NumberFormat("en-NL", { style: "currency", currency: "EUR" });

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
  const [rooms, setRooms] = React.useState("1");

  const result = exampleStay({
    rules,
    commissionRate,
    arrival,
    nights: Number(nights),
    pricePerNight: Number(price),
    adults: Number(adults),
    children: Number(children),
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
    <div className="flex flex-col gap-5 rounded-xl border p-5">
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
          min: 0,
          step: "0.01",
          inputMode: "decimal",
        })}
        {field("adults", "Adults", adults, setAdults, "col-span-2", { min: 1, max: 20 })}
        {field("children", "Children", children, setChildren, "col-span-2", { min: 0, max: 20 })}
        {field("rooms", "Rooms", rooms, setRooms, "col-span-2", { min: 1, max: 20 })}
      </div>

      <Separator />

      <dl className="flex flex-col gap-2 text-sm">
        <Row label="Room price" value={eur.format(result.stay)} />
        {result.touristTax.lines.map((line, i) => (
          <Row
            key={`${line.effectiveFrom}-${i}`}
            label={<span className="text-muted-foreground">Tourist tax · {line.label}</span>}
            value={eur.format(line.amount)}
          />
        ))}
        {result.touristTax.lines.length === 0 && (
          <Row label={<span className="text-muted-foreground">Tourist tax</span>} value={eur.format(0)} />
        )}
        <Separator className="my-1" />
        <Row
          label={<span className="font-medium">Guest pays (all-in)</span>}
          value={<span className="font-medium">{eur.format(result.guestTotal)}</span>}
        />
        <Row
          label={
            <span className="text-muted-foreground">
              OpenBookings commission · {percent(commissionRate)} of the room price
            </span>
          }
          value={`−${eur.format(result.commission)}`}
        />
        <Separator className="my-1" />
        <Row
          label={<span className="font-medium">You receive</span>}
          value={<span className="font-medium">{eur.format(result.hostReceives)}</span>}
        />
      </dl>

      <p className="text-muted-foreground text-xs">
        Before Stripe&apos;s payment fees. The {eur.format(result.touristTax.total)} tourist tax is
        yours to pay to your town; OpenBookings never takes commission on it.
      </p>
    </div>
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
