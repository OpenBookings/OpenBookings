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
          <FieldDescription>Adults and children together.</FieldDescription>
        </FieldContent>
        <Input
          id="maxGuests"
          value={adults + children}
          readOnly
          disabled
          className="w-20 text-center tabular-nums"
        />
      </Field>

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
