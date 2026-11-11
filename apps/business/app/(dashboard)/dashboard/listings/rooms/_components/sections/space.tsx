"use client";

import * as React from "react";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Switch } from "@/components/ui/switch";
import type { FormState } from "../../../_lib/editor";
import { SectionForm } from "../../../_components/section-form";
import { saveRoomSpace } from "../../_lib/actions";
import { BED_TYPES, LIMITS, type BedConfig, type BedTypeKey } from "../../_lib/constants";
import { bedLabel, totalBeds } from "../../_lib/derive";
import type { SpaceValues } from "../../_lib/mutations";
import type { RoomEditorData } from "../../_lib/types";
import { Stepper } from "../stepper";
import type { RoomSectionProps } from "./props";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground text-xs uppercase tracking-wide">{children}</p>;
}

export function SpaceSection({ data, onDirtyChange }: RoomSectionProps) {
  const { room } = data;
  // Steppers hold their counts in React state, which a form reset cannot
  // reach. Remounting the fields is what makes Discard put them back.
  const [resetKey, setResetKey] = React.useState(0);

  const initialValues = {
    sizeM2: room.sizeM2 === null ? "" : String(room.sizeM2),
    maxAdults: String(room.maxAdults),
    maxChildren: String(room.maxChildren),
    units: String(room.units),
    baseOccupancy: String(room.baseOccupancy),
    extraAdultFee: room.extraAdultFee === null ? "" : String(room.extraAdultFee),
    extraChildFee: room.extraChildFee === null ? "" : String(room.extraChildFee),
    cotsOn: room.cotsMax > 0 ? "on" : "",
    cotsMax: String(room.cotsMax),
    cotFee: room.cotFee === null ? "" : String(room.cotFee),
    extraBedsOn: room.extraBedsMax > 0 ? "on" : "",
    extraBedsMax: String(room.extraBedsMax),
    extraBedFee: room.extraBedFee === null ? "" : String(room.extraBedFee),
    cotAndExtraBedTogether: room.cotAndExtraBedTogether ? "on" : "",
    ...Object.fromEntries(BED_TYPES.map(({ key }) => [`bed_${key}`, String(room.beds[key] ?? 0)])),
  } as SpaceValues;

  return (
    <SectionForm
      sectionId="space"
      title="Space"
      description="How big the room is, who it sleeps, and how many of it you have."
      entityId={room.id}
      entityField="roomId"
      analyticsEvent="room_section_saved"
      initialValues={initialValues}
      action={saveRoomSpace}
      onDirtyChange={onDirtyChange}
      onReset={() => setResetKey((k) => k + 1)}
    >
      {(state, pending, markDirty) => (
        <SpaceFields key={resetKey} data={data} state={state} pending={pending} markDirty={markDirty} />
      )}
    </SectionForm>
  );
}

function SpaceFields({
  state,
  pending,
  markDirty,
}: {
  data: RoomEditorData;
  state: FormState<SpaceValues>;
  pending: boolean;
  markDirty: () => void;
}) {
  const v = state.values;
  const [beds, setBeds] = React.useState<BedConfig>(() =>
    Object.fromEntries(BED_TYPES.map(({ key }) => [key, Number(v[`bed_${key}`]) || 0])),
  );
  const [adults, setAdults] = React.useState(Number(v.maxAdults) || LIMITS.adults.min);
  const [children, setChildren] = React.useState(Number(v.maxChildren) || 0);
  const [included, setIncluded] = React.useState(Number(v.baseOccupancy) || LIMITS.adults.min);
  const [cotsOn, setCotsOn] = React.useState(v.cotsOn === "on");
  const [cots, setCots] = React.useState(Math.max(1, Number(v.cotsMax) || 0));
  const [bedsOn, setBedsOn] = React.useState(v.extraBedsOn === "on");
  const [extraBeds, setExtraBeds] = React.useState(Math.max(1, Number(v.extraBedsMax) || 0));
  const [together, setTogether] = React.useState(v.cotAndExtraBedTogether === "on");
  const maxGuests = adults + children;
  // A fee only shows where it can be charged; the schema drops a hidden one.
  const adultCanBeExtra = adults > included;
  const childCanBeExtra = children > 0 && maxGuests > included;

  const label = bedLabel(beds);
  const bedsInvalid = !!state.errors?.beds;

  function setBed(key: BedTypeKey, n: number) {
    setBeds((b) => ({ ...b, [key]: n }));
    markDirty();
  }

  return (
    <FieldGroup className="max-w-2xl">
      <Field data-invalid={!!state.errors?.sizeM2}>
        <FieldLabel htmlFor="sizeM2">Size</FieldLabel>
        {/* Wrapped: a vertical Field stretches its direct children full width. */}
        <div>
          <InputGroup className="w-40">
            <InputGroupInput
              id="sizeM2"
              name="sizeM2"
              type="number"
              inputMode="decimal"
              min={0}
              step={0.5}
              defaultValue={v.sizeM2}
              disabled={pending}
              aria-invalid={!!state.errors?.sizeM2}
              placeholder="35"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupText>m²</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
        </div>
        <FieldDescription>Floor area of one room, in square metres.</FieldDescription>
        {state.errors?.sizeM2 && <FieldError>{state.errors.sizeM2[0]}</FieldError>}
      </Field>

      <FieldSeparator />
      <SectionHeading>Beds</SectionHeading>

      <Field data-invalid={bedsInvalid}>
        <div className="divide-y rounded-lg border">
          {BED_TYPES.map(({ key, label: bed, plural }) => (
            <Field key={key} orientation="horizontal" className="px-4 py-2.5">
              <FieldLabel htmlFor={`bed-${key}`} className="font-normal">
                {bed}
              </FieldLabel>
              <Stepper
                id={`bed-${key}`}
                name={`bed_${key}`}
                label={plural}
                value={beds[key] ?? 0}
                min={0}
                max={LIMITS.bedsPerType.max}
                onChange={(n) => setBed(key, n)}
                disabled={pending}
                invalid={bedsInvalid}
              />
            </Field>
          ))}
        </div>
        <FieldDescription aria-live="polite">
          {totalBeds(beds) > 0 ? (
            <>
              Guests see <span className="text-foreground">{label}</span>.
            </>
          ) : (
            "Add at least one bed."
          )}
        </FieldDescription>
        {state.errors?.beds && <FieldError>{state.errors.beds[0]}</FieldError>}
      </Field>

      <FieldSeparator />
      <SectionHeading>Occupancy</SectionHeading>

      <Field orientation="horizontal" data-invalid={!!state.errors?.maxAdults}>
        <FieldContent>
          <FieldLabel htmlFor="maxAdults">Max adults</FieldLabel>
          {state.errors?.maxAdults && <FieldError>{state.errors.maxAdults[0]}</FieldError>}
        </FieldContent>
        <Stepper
          id="maxAdults"
          name="maxAdults"
          label="Adults"
          value={adults}
          min={LIMITS.adults.min}
          max={LIMITS.adults.max}
          onChange={(n) => {
            setAdults(n);
            markDirty();
          }}
          disabled={pending}
          invalid={!!state.errors?.maxAdults}
        />
      </Field>

      <Field orientation="horizontal" data-invalid={!!state.errors?.maxChildren}>
        <FieldContent>
          <FieldLabel htmlFor="maxChildren">Max children</FieldLabel>
          {state.errors?.maxChildren && <FieldError>{state.errors.maxChildren[0]}</FieldError>}
        </FieldContent>
        <Stepper
          id="maxChildren"
          name="maxChildren"
          label="Children"
          value={children}
          min={LIMITS.children.min}
          max={LIMITS.children.max}
          onChange={(n) => {
            setChildren(n);
            markDirty();
          }}
          disabled={pending}
          invalid={!!state.errors?.maxChildren}
        />
      </Field>

      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="maxGuests">Max guests</FieldLabel>
          <FieldDescription>Adults and children together. Infants (under 2) don&apos;t count.</FieldDescription>
        </FieldContent>
        <Input
          id="maxGuests"
          value={maxGuests}
          readOnly
          disabled
          className="w-20 text-center tabular-nums"
        />
      </Field>

      <Field orientation="horizontal" data-invalid={!!state.errors?.baseOccupancy}>
        <FieldContent>
          <FieldLabel htmlFor="baseOccupancy">Guests included in the price</FieldLabel>
          <FieldDescription>Your rate is for this many guests. Anyone above it pays the fee below.</FieldDescription>
          {state.errors?.baseOccupancy && <FieldError>{state.errors.baseOccupancy[0]}</FieldError>}
        </FieldContent>
        <Stepper
          id="baseOccupancy"
          name="baseOccupancy"
          label="Guests included"
          value={included}
          min={1}
          // Never below the saved value, so lowering max guests shows the
          // error on save instead of quietly changing the price.
          max={Math.max(included, maxGuests)}
          onChange={(n) => {
            setIncluded(n);
            markDirty();
          }}
          disabled={pending}
          invalid={!!state.errors?.baseOccupancy || included > maxGuests}
        />
      </Field>

      {(adultCanBeExtra || childCanBeExtra) && (
        <div className="ml-1 flex flex-col gap-4 border-l-2 pl-4">
          {adultCanBeExtra && (
            <FeeField
              id="extraAdultFee"
              label="Each extra adult"
              description="Ages 13 or above. Leave empty for free."
              defaultValue={v.extraAdultFee}
              error={state.errors?.extraAdultFee?.[0]}
              disabled={pending}
            />
          )}
          {childCanBeExtra && (
            <FeeField
              id="extraChildFee"
              label="Each extra child"
              description="Ages 2–12. Leave empty for free."
              defaultValue={v.extraChildFee}
              error={state.errors?.extraChildFee?.[0]}
              disabled={pending}
            />
          )}
        </div>
      )}

      <FieldSeparator />
      <SectionHeading>Cots &amp; extra beds</SectionHeading>
      <p className="text-muted-foreground text-sm">
        Guests add these when they book and pay you for them at check-in. They aren&apos;t part of the
        online payment.
      </p>

      <ExtraToggle
        id="cotsOn"
        label="Cots"
        description="For infants under 2."
        on={cotsOn}
        onChange={(on) => {
          setCotsOn(on);
          markDirty();
        }}
        disabled={pending}
      >
        <Field orientation="horizontal" data-invalid={!!state.errors?.cotsMax}>
          <FieldContent>
            <FieldLabel htmlFor="cotsMax" className="font-normal">How many fit</FieldLabel>
            {state.errors?.cotsMax && <FieldError>{state.errors.cotsMax[0]}</FieldError>}
          </FieldContent>
          <Stepper
            id="cotsMax"
            name="cotsMax"
            label="Cots"
            value={cots}
            min={1}
            max={LIMITS.cots.max}
            onChange={(n) => {
              setCots(n);
              markDirty();
            }}
            disabled={pending}
          />
        </Field>
        <FeeField
          id="cotFee"
          label="Price"
          description="Leave empty for free."
          defaultValue={v.cotFee}
          error={state.errors?.cotFee?.[0]}
          disabled={pending}
        />
      </ExtraToggle>

      <ExtraToggle
        id="extraBedsOn"
        label="Extra beds"
        description="A rollaway or sofa bed for an extra guest. It doesn't raise max guests."
        on={bedsOn}
        onChange={(on) => {
          setBedsOn(on);
          markDirty();
        }}
        disabled={pending}
      >
        <Field orientation="horizontal" data-invalid={!!state.errors?.extraBedsMax}>
          <FieldContent>
            <FieldLabel htmlFor="extraBedsMax" className="font-normal">How many fit</FieldLabel>
            {state.errors?.extraBedsMax && <FieldError>{state.errors.extraBedsMax[0]}</FieldError>}
          </FieldContent>
          <Stepper
            id="extraBedsMax"
            name="extraBedsMax"
            label="Extra beds"
            value={extraBeds}
            min={1}
            max={LIMITS.extraBeds.max}
            onChange={(n) => {
              setExtraBeds(n);
              markDirty();
            }}
            disabled={pending}
          />
        </Field>
        <FeeField
          id="extraBedFee"
          label="Price"
          description="Leave empty for free."
          defaultValue={v.extraBedFee}
          error={state.errors?.extraBedFee?.[0]}
          disabled={pending}
        />
      </ExtraToggle>

      {cotsOn && bedsOn && (
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="cotAndExtraBedTogether">A cot and an extra bed can be in the room together</FieldLabel>
            <FieldDescription>When off, a guest can add one or the other.</FieldDescription>
          </FieldContent>
          {together && <input type="hidden" name="cotAndExtraBedTogether" value="on" />}
          <Switch
            id="cotAndExtraBedTogether"
            checked={together}
            onCheckedChange={(on) => {
              setTogether(on);
              markDirty();
            }}
            disabled={pending}
          />
        </Field>
      )}

      <FieldSeparator />
      <SectionHeading>Inventory</SectionHeading>

      <Field data-invalid={!!state.errors?.units}>
        <FieldLabel htmlFor="units">Number of units</FieldLabel>
        <div>
          <Input
            id="units"
            name="units"
            type="number"
            inputMode="numeric"
            min={LIMITS.units.min}
            max={LIMITS.units.max}
            step={1}
            defaultValue={v.units}
            disabled={pending}
            aria-invalid={!!state.errors?.units}
            className="w-24"
          />
        </div>
        <FieldDescription>
          How many of this room you have. Every rate on this room sells from the same units, and
          availability per date is managed in Rates &amp; Availability.
        </FieldDescription>
        {state.errors?.units && <FieldError>{state.errors.units[0]}</FieldError>}
      </Field>
    </FieldGroup>
  );
}

/** A switch that opens its settings below it. Posts "on" through a hidden input while on. */
function ExtraToggle({
  id,
  label,
  description,
  on,
  onChange,
  disabled,
  children,
}: {
  id: string;
  label: string;
  description: string;
  on: boolean;
  onChange: (on: boolean) => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <FieldDescription>{description}</FieldDescription>
        </FieldContent>
        {on && <input type="hidden" name={id} value="on" />}
        <Switch id={id} checked={on} onCheckedChange={onChange} disabled={disabled} />
      </Field>
      {on && <div className="ml-1 flex flex-col gap-4 border-l-2 pl-4">{children}</div>}
    </>
  );
}

/** Whole euros per night; empty is free. */
function FeeField({
  id,
  label,
  description,
  defaultValue,
  error,
  disabled,
}: {
  id: string;
  label: string;
  description: string;
  defaultValue: string;
  error?: string;
  disabled: boolean;
}) {
  return (
    <Field orientation="horizontal" data-invalid={!!error}>
      <FieldContent>
        <FieldLabel htmlFor={id} className="font-normal">
          {label}
        </FieldLabel>
        <FieldDescription>{description}</FieldDescription>
        {error && <FieldError>{error}</FieldError>}
      </FieldContent>
      <InputGroup className="w-40 shrink-0">
        <InputGroupAddon>
          <InputGroupText>€</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          name={id}
          type="number"
          inputMode="numeric"
          min={0}
          max={LIMITS.fee.max}
          step={1}
          defaultValue={defaultValue}
          placeholder="Free"
          disabled={disabled}
          aria-invalid={!!error}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText>/ night</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    </Field>
  );
}
