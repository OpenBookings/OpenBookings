"use client";

import * as React from "react";
import Form from "next/form";
import Link from "next/link";
import { toast } from "sonner";
import posthog from "posthog-js";
import { AlertCircleIcon, ArrowUpRightIcon } from "lucide-react";
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
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { saveRate } from "../_lib/actions";
import {
  LIMITS,
  MAX_ADVANCE_OPTIONS,
  MIN_ADVANCE_OPTIONS,
  RATE_EXTRAS,
} from "../_lib/constants";
import { maxAdvanceLabel, mealLabel, minAdvanceLabel } from "../_lib/derive";
import type { RateValues } from "../_lib/mutations";
import type { RatePlanRecord } from "../_lib/types";

interface RateSheetProps {
  open: boolean;
  /** null = a new rate. */
  rate: RatePlanRecord | null;
  roomId: string;
  roomName: string;
  pricingHref: string;
  onClose: () => void;
}

/**
 * Create or edit one rate's terms. Shaped like the R&A detail Sheet — right
 * side, same width, header / scrolling body / pinned footer — but modal: this
 * is a form with a Save, not a panel to compare against the grid behind it.
 *
 * Nothing here is a price, an availability figure or a stay rule. Those live
 * in R&A; the Pricing block says so and links there.
 */
export function RateSheet(props: RateSheetProps) {
  const { open, rate } = props;
  const [dirty, setDirty] = React.useState(false);
  const [confirmClose, setConfirmClose] = React.useState(false);

  function requestClose() {
    if (dirty) setConfirmClose(true);
    else props.onClose();
  }

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && requestClose()}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-[380px]">
          {open && (
            <RateForm
              // A different rate is a different form: fresh state, fresh values.
              key={rate?.id ?? "new"}
              {...props}
              onDirtyChange={setDirty}
              onSaved={() => {
                setDirty(false);
                props.onClose();
              }}
              onCancel={requestClose}
            />
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have edits to this rate that have not been saved. Closing now loses them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDirty(false);
                props.onClose();
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">{title}</h3>
      {children}
    </section>
  );
}

function initialValues(rate: RatePlanRecord | null, roomId: string): RateValues {
  return {
    ratePlanId: rate?.id ?? "",
    roomId,
    name: rate?.name ?? "",
    description: rate?.description ?? "",
    breakfast: rate?.breakfast ?? false,
    lunch: rate?.lunch ?? false,
    dinner: rate?.dinner ?? false,
    extras: rate?.extras ?? [],
    otherInclusion: rate?.otherInclusion ?? "",
    minAdvanceDays: String(rate?.minAdvanceDays ?? 0),
    maxAdvanceDays: rate?.maxAdvanceDays == null ? "none" : String(rate.maxAdvanceDays),
    cancellationText: rate?.cancellationText ?? "",
    // New rates start inactive: they have no price until R&A sets one.
    active: rate?.active ?? false,
  };
}

function RateForm({
  rate,
  roomId,
  roomName,
  pricingHref,
  onDirtyChange,
  onSaved,
  onCancel,
}: RateSheetProps & {
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [state, formAction, pending] = React.useActionState(saveRate, {
    values: initialValues(rate, roomId),
    errors: null,
    success: false,
  });
  const v = state.values;
  const formRef = React.useRef<HTMLFormElement>(null);

  // Controlled where the Sheet derives something live from the value, or
  // where the control is not a native input the form can read.
  const [meals, setMeals] = React.useState({ breakfast: v.breakfast, lunch: v.lunch, dinner: v.dinner });
  const [extras, setExtras] = React.useState(() => new Set(v.extras));
  const [minAdvance, setMinAdvance] = React.useState(v.minAdvanceDays);
  const [maxAdvance, setMaxAdvance] = React.useState(v.maxAdvanceDays);
  const [active, setActive] = React.useState(v.active);
  const [descriptionLength, setDescriptionLength] = React.useState(v.description.length);
  const [policyLength, setPolicyLength] = React.useState(v.cancellationText.length);

  const isNew = rate === null;
  const canActivate = !isNew && rate.priced;

  const markDirty = React.useCallback(() => onDirtyChange(true), [onDirtyChange]);

  React.useEffect(() => {
    if (!state.success) return;
    onDirtyChange(false);
    toast.success(isNew ? "Rate added" : "Rate saved", {
      description: isNew
        ? "Set its price in Rates & Availability, then switch it on."
        : `${state.values.name} is up to date.`,
    });
    posthog.capture(isNew ? "rate_created" : "rate_saved");
    onSaved();
    // Fires once per successful save; the callbacks are stable for that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  const errorEntries = Object.entries(state.errors ?? {}).filter(([, m]) => (m?.length ?? 0) > 0);

  // Same as SectionForm: take the host to the first problem, and announce it.
  React.useEffect(() => {
    if (errorEntries.length === 0) return;
    const el = formRef.current?.querySelector<HTMLElement>(`[data-field="${errorEntries[0][0]}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.errors]);

  const err = (name: keyof RateValues) => state.errors?.[name]?.[0];

  return (
    <>
      <SheetHeader className="gap-1 pb-3">
        <SheetDescription className="text-xs">{roomName}</SheetDescription>
        <SheetTitle className="text-lg">{isNew ? "New rate" : rate.name}</SheetTitle>
      </SheetHeader>

      <Form
        ref={formRef}
        action={formAction}
        id="rate-form"
        onChange={markDirty}
        className="flex-1 space-y-5 overflow-y-auto px-4 pb-6"
      >
        <input type="hidden" name="ratePlanId" value={rate?.id ?? ""} />
        <input type="hidden" name="roomId" value={roomId} />

        {errorEntries.length > 0 && (
          <Alert variant="destructive" role="alert">
            <AlertCircleIcon />
            <AlertTitle>
              {errorEntries.length === 1
                ? "One field needs your attention"
                : `${errorEntries.length} fields need your attention`}
            </AlertTitle>
          </Alert>
        )}

        <Section title="Basics">
          <FieldGroup className="gap-4">
            <Field data-invalid={!!err("name")}>
              <FieldLabel htmlFor="rate-name">Name</FieldLabel>
              <Input
                id="rate-name"
                name="name"
                data-field="name"
                defaultValue={v.name}
                disabled={pending}
                aria-invalid={!!err("name")}
                maxLength={LIMITS.rateName.max}
                placeholder="Bed & Breakfast"
                autoComplete="off"
              />
              {err("name") && <FieldError>{err("name")}</FieldError>}
            </Field>

            <Field data-invalid={!!err("description")}>
              <FieldLabel htmlFor="rate-description">Description</FieldLabel>
              <InputGroup>
                <InputGroupTextarea
                  id="rate-description"
                  name="description"
                  data-field="description"
                  defaultValue={v.description}
                  disabled={pending}
                  aria-invalid={!!err("description")}
                  rows={3}
                  className="min-h-20 resize-none"
                  placeholder="Optional"
                  onChange={(e) => setDescriptionLength(e.target.value.length)}
                />
                <InputGroupAddon align="block-end">
                  <InputGroupText
                    className={cn(
                      "tabular-nums",
                      descriptionLength > LIMITS.rateDescription.max && "text-destructive",
                    )}
                  >
                    {descriptionLength}/{LIMITS.rateDescription.max}
                  </InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription>Shown to guests under the rate name.</FieldDescription>
              {err("description") && <FieldError>{err("description")}</FieldError>}
            </Field>
          </FieldGroup>
        </Section>

        <Separator />

        <Section title="What's included">
          <FieldGroup className="gap-4">
            <Field>
              <FieldTitle>Meals</FieldTitle>
              <div className="flex flex-wrap gap-x-5 gap-y-2" role="group" aria-label="Meals">
                {(["breakfast", "lunch", "dinner"] as const).map((meal) => (
                  <div key={meal} className="flex items-center gap-2">
                    {meals[meal] && <input type="hidden" name={meal} value="on" />}
                    <Checkbox
                      id={`rate-${meal}`}
                      checked={meals[meal]}
                      disabled={pending}
                      onCheckedChange={(c) => {
                        setMeals((m) => ({ ...m, [meal]: c === true }));
                        markDirty();
                      }}
                    />
                    <FieldLabel htmlFor={`rate-${meal}`} className="font-normal capitalize">
                      {meal}
                    </FieldLabel>
                  </div>
                ))}
              </div>
              <FieldDescription aria-live="polite">
                Guests see <span className="text-foreground">{mealLabel(meals)}</span>.
              </FieldDescription>
            </Field>

            <Field>
              <FieldTitle>Extras</FieldTitle>
              <div className="flex flex-col gap-2" role="group" aria-label="Extras">
                {RATE_EXTRAS.map((extra) => (
                  <div key={extra.key} className="flex items-center gap-2">
                    {extras.has(extra.key) && <input type="hidden" name="extras" value={extra.key} />}
                    <Checkbox
                      id={`rate-extra-${extra.key}`}
                      checked={extras.has(extra.key)}
                      disabled={pending}
                      onCheckedChange={(c) => {
                        setExtras((prev) => {
                          const next = new Set(prev);
                          if (c === true) next.add(extra.key);
                          else next.delete(extra.key);
                          return next;
                        });
                        markDirty();
                      }}
                    />
                    <FieldLabel htmlFor={`rate-extra-${extra.key}`} className="font-normal">
                      {extra.label}
                    </FieldLabel>
                  </div>
                ))}
              </div>
            </Field>

            <Field data-invalid={!!err("otherInclusion")}>
              <FieldLabel htmlFor="rate-other">Other</FieldLabel>
              <Input
                id="rate-other"
                name="otherInclusion"
                data-field="otherInclusion"
                defaultValue={v.otherInclusion}
                disabled={pending}
                aria-invalid={!!err("otherInclusion")}
                maxLength={LIMITS.otherInclusion.max}
                placeholder="Optional, e.g. a bottle of wine on arrival"
              />
              {err("otherInclusion") && <FieldError>{err("otherInclusion")}</FieldError>}
            </Field>
          </FieldGroup>
        </Section>

        <Separator />

        <Section title="Conditions">
          <FieldGroup className="gap-4">
            <Field data-invalid={!!err("minAdvanceDays")}>
              <FieldLabel htmlFor="rate-min-advance">Book at least</FieldLabel>
              <Select
                name="minAdvanceDays"
                value={minAdvance}
                onValueChange={(val) => {
                  setMinAdvance(val);
                  markDirty();
                }}
                disabled={pending}
              >
                <SelectTrigger id="rate-min-advance" data-field="minAdvanceDays" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MIN_ADVANCE_OPTIONS.map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {minAdvanceLabel(d)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {err("minAdvanceDays") && <FieldError>{err("minAdvanceDays")}</FieldError>}
            </Field>

            <Field data-invalid={!!err("maxAdvanceDays")}>
              <FieldLabel htmlFor="rate-max-advance">Book at most</FieldLabel>
              <Select
                name="maxAdvanceDays"
                value={maxAdvance}
                onValueChange={(val) => {
                  setMaxAdvance(val);
                  markDirty();
                }}
                disabled={pending}
              >
                <SelectTrigger id="rate-max-advance" data-field="maxAdvanceDays" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAX_ADVANCE_OPTIONS.map((d) => (
                    <SelectItem key={d ?? "none"} value={d === null ? "none" : String(d)}>
                      {maxAdvanceLabel(d)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>Minimum and maximum stay are set in Rates &amp; Availability.</FieldDescription>
              {err("maxAdvanceDays") && <FieldError>{err("maxAdvanceDays")}</FieldError>}
            </Field>
          </FieldGroup>
        </Section>

        <Separator />

        <Section title="Cancellation">
          <Field data-invalid={!!err("cancellationText")}>
            <FieldLabel htmlFor="rate-cancellation">Cancellation policy</FieldLabel>
            <InputGroup>
              <InputGroupTextarea
                id="rate-cancellation"
                name="cancellationText"
                data-field="cancellationText"
                defaultValue={v.cancellationText}
                disabled={pending}
                aria-invalid={!!err("cancellationText")}
                rows={5}
                className="min-h-28 resize-none"
                onChange={(e) => setPolicyLength(e.target.value.length)}
              />
              <InputGroupAddon align="block-end">
                <InputGroupText
                  className={cn(
                    "tabular-nums",
                    policyLength > LIMITS.cancellation.max && "text-destructive",
                  )}
                >
                  {policyLength}/{LIMITS.cancellation.max}
                </InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription>
              Describe what happens when a guest cancels. Shown to guests with this rate.
            </FieldDescription>
            {err("cancellationText") && <FieldError>{err("cancellationText")}</FieldError>}
          </Field>
        </Section>

        <Separator />

        <Section title="Pricing">
          <p className="text-sm">
            Prices and availability are managed in Rates &amp; Availability.{" "}
            <Link href={pricingHref} className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:no-underline">
              Open R&amp;A
              <ArrowUpRightIcon className="size-3.5" aria-hidden />
            </Link>
          </p>
          {!isNew && !rate.priced && (
            <p className="text-muted-foreground text-sm">This rate has no base rate yet.</p>
          )}
        </Section>

        <Separator />

        <Section title="Status">
          <Field orientation="horizontal" data-invalid={!!err("active")}>
            <FieldContent>
              <FieldLabel htmlFor="rate-active">Active</FieldLabel>
              <FieldDescription>
                {isNew
                  ? "Save the rate, set its price in R&A, then switch it on."
                  : !rate.priced
                    ? "Set a price in R&A before switching this rate on."
                    : "Guests can book active rates on a published room."}
              </FieldDescription>
              {err("active") && <FieldError>{err("active")}</FieldError>}
            </FieldContent>
            {active && <input type="hidden" name="active" value="on" />}
            <Switch
              id="rate-active"
              data-field="active"
              checked={active}
              // Switching off is never blocked here; the server decides
              // whether this is a published room's last active rate.
              disabled={pending || (!active && !canActivate)}
              onCheckedChange={(c) => {
                setActive(c);
                markDirty();
              }}
            />
          </Field>
        </Section>
      </Form>

      {/* Pinned, like the R&A Sheet's actions. */}
      <div className="flex items-center justify-end gap-2 border-t bg-(--ari-group) p-4">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" form="rate-form" disabled={pending}>
          {pending && <Spinner />}
          Save
        </Button>
      </div>
    </>
  );
}
