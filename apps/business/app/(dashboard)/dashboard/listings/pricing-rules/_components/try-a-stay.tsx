"use client";

import * as React from "react";
import { SectionHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { tryStayAction } from "../_lib/actions";
import { TRY_STAY_MAX_NIGHTS, type PlanOption } from "../_lib/rule-model";
import type { TryStayResult } from "../_lib/try-stay";

const euro = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
const money = (n: number) => euro.format(n);
const signed = (n: number) => (n < 0 ? `−${money(-n)}` : `+${money(n)}`);

/** Today in the browser's calendar, as YYYY-MM-DD. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Prices one stay with the same engine checkout uses, so a host can see what
 * their rules do together, and which discount wins. Changes nothing.
 */
export function TryAStay({ plans, defaultPlanId }: { plans: PlanOption[]; defaultPlanId: string }) {
  const [planId, setPlanId] = React.useState(defaultPlanId);
  const [bookedOn, setBookedOn] = React.useState(today);
  const [arrival, setArrival] = React.useState(() => addDays(today(), 30));
  const [nights, setNights] = React.useState("3");
  const [result, setResult] = React.useState<TryStayResult | null>(null);
  const [pending, setPending] = React.useState(false);

  // Follow the page's rate plan filter.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setPlanId(defaultPlanId), [defaultPlanId]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    try {
      setResult(await tryStayAction({ ratePlanId: planId, arrival, nights: Number(nights), bookedOn }));
    } catch {
      setResult({ ok: false, error: "Something went wrong. Please try again." });
    } finally {
      setPending(false);
    }
  };

  return (
    <Card role="region" aria-label="Try a stay" className="gap-3 p-5">
      <SectionHeader title="Try a stay" description="See what a guest would pay, rule by rule." />
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="try-plan">Room and rate plan</Label>
          <Select value={planId} onValueChange={setPlanId}>
            <SelectTrigger id="try-plan" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {plans.map((plan) => (
                <SelectItem key={plan.id} value={plan.id}>
                  {plan.roomName} · {plan.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="try-arrival">Arrival</Label>
            <Input id="try-arrival" type="date" value={arrival} min={bookedOn} onChange={(e) => setArrival(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="try-nights">Nights</Label>
            <Input
              id="try-nights"
              type="number"
              inputMode="numeric"
              min={1}
              max={TRY_STAY_MAX_NIGHTS}
              value={nights}
              onChange={(e) => setNights(e.target.value)}
              required
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="try-booked">Booked on</Label>
          <Input id="try-booked" type="date" value={bookedOn} max={arrival} onChange={(e) => setBookedOn(e.target.value)} required />
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending && <Spinner />}
          Work out the price
        </Button>
      </form>

      {result && !result.ok && (
        <p role="alert" className="text-(--red-9) text-sm">
          {result.error}
        </p>
      )}
      {result?.ok && (
        <div aria-live="polite" className="flex flex-col gap-1.5 border-t pt-3 text-sm">
          <Line
            label={`${result.nights} ${result.nights === 1 ? "night" : "nights"}${result.hasDatePrices ? ", with prices set for some dates" : ""}`}
            value={money(result.base)}
          />
          {result.adjustments.map((line) => (
            <Line key={line.label} label={line.label} value={signed(line.amount)} />
          ))}
          {result.discount && (
            <Line label={result.discount.label} value={signed(result.discount.amount)} className="text-(--green-11)" />
          )}
          {result.discount && result.beaten.length > 0 && (
            <p className="text-muted-foreground text-xs">
              Beats {result.beaten.map((b) => `${b.label} (${signed(b.amount)})`).join(", ")}. Only the biggest applies.
            </p>
          )}
          <Line label="Guest pays" value={money(result.total)} className="mt-1 border-t pt-2 font-semibold" />
          <p className="text-muted-foreground text-xs">Plus tourist tax. Priced for the room&apos;s standard occupancy.</p>
        </div>
      )}
    </Card>
  );
}

function Line({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={`flex justify-between gap-3 ${className ?? ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
