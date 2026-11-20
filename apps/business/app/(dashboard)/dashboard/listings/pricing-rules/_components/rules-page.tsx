"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { setRuleGroupActiveAction } from "../_lib/actions";
import type { PricingRulesData } from "../_lib/query";
import {
  amountLabel,
  guestLabel,
  PRICING_RULES_PATH,
  scopeLabel,
  sectionOf,
  whenLabel,
  type RuleGroup,
  type RuleSection,
} from "../_lib/rule-model";
import { TryAStay } from "./try-a-stay";

const ALL = "all";

/**
 * The Pricing rules page: price adjustments (always apply) and discounts
 * (one per stay, the biggest wins) for the whole property, each on the rate
 * plans the host chose. Beside them, how a guest's price is built and a
 * "Try a stay" that prices one stay with the real engine.
 */
export function RulesPage({ data }: { data: PricingRulesData }) {
  const router = useRouter();
  const params = useSearchParams();
  const planFilter = params.get("plan");
  const filterPlan = data.plans.find((p) => p.id === planFilter) ?? null;

  const visible = filterPlan
    ? data.rules.filter((r) => r.appliesToAll || r.ratePlanIds.includes(filterPlan.id))
    : data.rules;
  const bySection = (section: RuleSection) => visible.filter((r) => sectionOf(r) === section);

  const setFilter = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value === ALL) next.delete("plan");
    else next.set("plan", value);
    const query = next.toString();
    router.replace(query ? `${PRICING_RULES_PATH}?${query}` : PRICING_RULES_PATH, { scroll: false });
  };

  const newHref = (section: RuleSection) => {
    const next = new URLSearchParams({ section });
    if (filterPlan) next.set("plan", filterPlan.id);
    if (params.get("property")) next.set("property", params.get("property")!);
    return `${PRICING_RULES_PATH}/new?${next.toString()}`;
  };

  return (
    <div className="flex flex-col gap-6 px-4 lg:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="font-semibold text-2xl tracking-tight">Pricing rules</h1>
          <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
            Rules change the price of every night they match, on the rate plans you choose. They work on top of your
            base rate and on prices you set for a single date.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="rules-plan-filter" className="text-muted-foreground text-sm">
            Show rules for
          </Label>
          <Select value={filterPlan?.id ?? ALL} onValueChange={setFilter}>
            <SelectTrigger id="rules-plan-filter" className="min-w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All rate plans</SelectItem>
              {data.plans.map((plan) => (
                <SelectItem key={plan.id} value={plan.id}>
                  {plan.roomName} · {plan.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" asChild>
            <Link href="/dashboard/listings/rates-availability">Open Rates &amp; availability</Link>
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_600px] flex-col gap-8">
          <RulesSection
            section="adjustment"
            title="Price adjustments"
            description="Always apply, to every night they match."
            addLabel="Add price adjustment"
            addHref={newHref("adjustment")}
            rules={bySection("adjustment")}
            data={data}
          />
          <RulesSection
            section="discount"
            title="Discounts"
            description="One per stay. If a stay qualifies for more than one, the guest gets the biggest."
            addLabel="Add discount"
            addHref={newHref("discount")}
            rules={bySection("discount")}
            data={data}
          />
        </div>

        <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
          <PriceBuildCard />
          {data.plans.length > 0 && <TryAStay plans={data.plans} defaultPlanId={filterPlan?.id ?? data.plans[0].id} />}
        </aside>
      </div>
    </div>
  );
}

function RulesSection({
  section,
  title,
  description,
  addLabel,
  addHref,
  rules,
  data,
}: {
  section: RuleSection;
  title: string;
  description: string;
  addLabel: string;
  addHref: string;
  rules: RuleGroup[];
  data: PricingRulesData;
}) {
  const isDiscount = section === "discount";
  return (
    <section aria-labelledby={`rules-${section}`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id={`rules-${section}`} className="font-semibold text-lg">
            {title}
          </h2>
          <p className="mt-1 text-muted-foreground text-sm">{description}</p>
        </div>
        <Button variant="outline" asChild>
          <Link href={addHref}>
            <Plus className="size-4" aria-hidden />
            {addLabel}
          </Link>
        </Button>
      </div>

      {rules.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
          {isDiscount
            ? "No discounts yet. Guests pay the full price for every stay."
            : "No price adjustments yet. Every night sells at its own price."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table className={isDiscount ? "min-w-[760px]" : "min-w-[620px]"}>
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead className="w-24">{isDiscount ? "Discount" : "Change"}</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Rate plans</TableHead>
                {isDiscount && <TableHead>Guests see</TableHead>}
                <TableHead className="w-16">On</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">Edit</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((rule) => (
                <RuleRow key={rule.id} rule={rule} data={data} isDiscount={isDiscount} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

function RuleRow({ rule, data, isDiscount }: { rule: RuleGroup; data: PricingRulesData; isDiscount: boolean }) {
  const [active, setActive] = React.useState(rule.active);
  const [busy, setBusy] = React.useState(false);
  // A refresh after the write hands down the saved state; it wins.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setActive(rule.active), [rule.active]);

  const href = `${PRICING_RULES_PATH}/${rule.id}`;
  const when = whenLabel(rule);

  const toggle = async (on: boolean) => {
    setActive(on);
    setBusy(true);
    try {
      const result = await setRuleGroupActiveAction(rule.id, on);
      if (!result.ok) {
        setActive(!on);
        toast.error("Could not change the rule", { description: result.error });
      }
    } catch {
      setActive(!on);
      toast.error("Could not change the rule");
    } finally {
      setBusy(false);
    }
  };

  return (
    <TableRow className={cn(!active && "text-muted-foreground")}>
      <TableCell className={cn("font-semibold text-base", isDiscount && active && "text-(--green-11)")}>
        <Link href={href} className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          {amountLabel(rule)}
        </Link>
      </TableCell>
      <TableCell>{when}</TableCell>
      <TableCell className="whitespace-normal text-muted-foreground">{scopeLabel(rule, data.plans)}</TableCell>
      {isDiscount && <TableCell className="text-muted-foreground">{guestLabel(rule)}</TableCell>}
      <TableCell>
        <Switch
          checked={active}
          disabled={busy}
          onCheckedChange={(on) => void toggle(on)}
          aria-label={`${active ? "Turn off" : "Turn on"}: ${when}`}
        />
      </TableCell>
      <TableCell>
        <Link
          href={href}
          aria-label={`Edit: ${when}`}
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      </TableCell>
    </TableRow>
  );
}

function PriceBuildCard() {
  const steps = [
    { title: "Each night's price", detail: "Your base rate, or the price you set for that date" },
    { title: "+ Price adjustments", detail: "Every one that matches the night" },
    { title: "− One discount", detail: "The biggest the stay qualifies for" },
    { title: "+ Extra guests", detail: "Never discounted" },
  ];
  return (
    <section aria-labelledby="price-build" className="flex flex-col gap-3 rounded-xl border bg-card p-5">
      <h2 id="price-build" className="font-semibold">
        How a guest&apos;s price is built
      </h2>
      <ol className="flex flex-col gap-3">
        {steps.map((step, i) => (
          <li key={step.title} className="grid grid-cols-[24px_1fr] items-start gap-2.5 text-sm">
            <span
              aria-hidden
              className="flex size-6 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground text-xs"
            >
              {i + 1}
            </span>
            <span>
              {step.title}
              <span className="block text-muted-foreground">{step.detail}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="border-t pt-3 text-sm">= What the guest pays, with tourist tax from your tourist tax rules on top.</p>
    </section>
  );
}
