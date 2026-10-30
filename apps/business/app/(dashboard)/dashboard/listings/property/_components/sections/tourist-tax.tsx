"use client";

import * as React from "react";
import { ChevronDownIcon, LandmarkIcon, PlusIcon, Trash2Icon } from "lucide-react";
import posthog from "posthog-js";
import { toast } from "sonner";
import { describeCharge } from "@openbookings/pricing";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { deleteTouristTaxRule } from "../../_lib/actions";
import { groupRules } from "../../_lib/tourist-tax-view";
import type { TouristTaxRuleRecord } from "../../_lib/types";
import { ExampleCalculator } from "../tourist-tax/example-calculator";
import { RuleDialog } from "../tourist-tax/rule-dialog";
import type { SectionProps } from "./props";

/** "1 January 2027". A date has no time zone, so it is formatted as UTC. */
const longDate = (value: string) =>
  new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

/**
 * Not a SectionForm: a rule is a dated record that saves on its own, not a
 * field held until Save. Started rules are history and stay read-only; a host
 * changes their tourist tax by adding a rule with a later date.
 */
export function TouristTaxSection({ data }: SectionProps) {
  const { property, touristTax } = data;
  const { rules, commissionRate, today } = touristTax;
  const [adding, setAdding] = React.useState(false);
  const groups = groupRules(rules, today);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start justify-between gap-4 border-b px-6 py-5">
        <div>
          <h2 className="font-medium text-lg">Tourist tax</h2>
          <p className="text-muted-foreground text-sm">
            Added on top of your room prices. Guests see one all-in price, and OpenBookings never
            takes commission on tourist tax. You pay it to your town.
          </p>
        </div>
        {rules.length > 0 && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <PlusIcon />
            New rule
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {rules.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LandmarkIcon />
              </EmptyMedia>
              <EmptyTitle>No tourist tax set up</EmptyTitle>
              <EmptyDescription>
                If your town charges tourist tax, add it here so it is included in what guests
                pay. A percentage, an amount per person or room, per night, or a mix.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setAdding(true)}>
                <PlusIcon />
                Set up tourist tax
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
            <div className="flex flex-col gap-4">
              {groups.current ? (
                <RuleCard propertyId={property.id} rule={groups.current} status="current" today={today} />
              ) : (
                <p className="rounded-lg border border-dashed p-4 text-muted-foreground text-sm">
                  No rule applies yet. Guests pay no tourist tax until your first rule starts.
                </p>
              )}

              {groups.upcoming.map((rule) => (
                <RuleCard key={rule.id} propertyId={property.id} rule={rule} status="upcoming" today={today} />
              ))}

              {groups.previous.length > 0 && (
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="group self-start">
                      Earlier rules ({groups.previous.length})
                      <ChevronDownIcon className="transition-transform group-data-[state=open]:rotate-180" />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-3 flex flex-col gap-4">
                    {groups.previous.map((rule) => (
                      <RuleCard key={rule.id} propertyId={property.id} rule={rule} status="previous" today={today} />
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>

            <div className="lg:sticky lg:top-0 lg:self-start">
              <ExampleCalculator rules={rules} commissionRate={commissionRate} defaultArrival={today} />
            </div>
          </div>
        )}
      </div>

      <RuleDialog
        propertyId={property.id}
        today={today}
        waitingFrom={groups.upcoming[0]?.effectiveFrom ?? null}
        commissionRate={commissionRate}
        open={adding}
        onOpenChange={setAdding}
      />
    </div>
  );
}

const STATUS = {
  current: { label: "Current", variant: "default" },
  upcoming: { label: "Upcoming", variant: "secondary" },
  previous: { label: "Ended", variant: "outline" },
} as const;

function RuleCard({
  propertyId,
  rule,
  status,
  today,
}: {
  propertyId: string;
  rule: TouristTaxRuleRecord;
  status: keyof typeof STATUS;
  today: string;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  // Same line the save path draws: no night has been charged under it yet.
  const deletable = rule.effectiveFrom >= today;

  const options = [
    rule.childrenExempt && "Children don't pay",
    rule.maxNights && `At most ${rule.maxNights} ${rule.maxNights === 1 ? "night" : "nights"} taxed`,
  ].filter(Boolean) as string[];

  function remove() {
    startTransition(async () => {
      const result = await deleteTouristTaxRule(propertyId, rule.id);
      if (!result.ok) {
        toast.error("Could not delete this rule", { description: result.error });
        return;
      }
      toast.success("Tourist tax rule deleted");
      posthog.capture("tourist_tax_rule_deleted");
      setConfirming(false);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Badge variant={STATUS[status].variant}>{STATUS[status].label}</Badge>
            <span className="font-medium">
              {status === "upcoming" ? "Starts" : "From"} {longDate(rule.effectiveFrom)}
            </span>
          </div>
        </div>
        {deletable && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete the rule starting ${longDate(rule.effectiveFrom)}`}
            onClick={() => setConfirming(true)}
          >
            <Trash2Icon />
          </Button>
        )}
      </div>

      {rule.charges.length === 0 ? (
        <p className="text-sm">No tourist tax.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {rule.charges.map((charge, i) => (
            <li key={i}>{describeCharge(charge)}</li>
          ))}
        </ul>
      )}

      {options.length > 0 && (
        <ul className="flex flex-col gap-1 text-muted-foreground text-sm">
          {options.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
      )}

      <AlertDialog open={confirming} onOpenChange={(o) => !pending && setConfirming(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this rule?</AlertDialogTitle>
            <AlertDialogDescription>
              The rule starting {longDate(rule.effectiveFrom)} will not apply. Bookings already
              made keep the tourist tax they were charged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                remove();
              }}
              disabled={pending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
