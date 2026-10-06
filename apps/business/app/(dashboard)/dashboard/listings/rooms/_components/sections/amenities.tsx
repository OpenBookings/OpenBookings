"use client";

import * as React from "react";
import { StarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSet, FieldLegend } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import type { FormState } from "../../../_lib/editor";
import { SectionForm } from "../../../_components/section-form";
import { saveRoomAmenities } from "../../_lib/actions";
import { MAX_FEATURED_AMENITIES, ROOM_AMENITIES, ROOM_AMENITY_GROUPS } from "../../_lib/constants";
import type { RoomSectionProps } from "./props";

type AmenityValues = { amenityKeys: string[]; featuredAmenityKeys: string[] };

export function AmenitiesSection({ data, onDirtyChange }: RoomSectionProps) {
  const { room } = data;
  const [resetKey, setResetKey] = React.useState(0);

  return (
    <SectionForm
      sectionId="amenities"
      title="Amenities"
      description="What is in this room. Facilities the whole property shares belong on the Property page."
      entityId={room.id}
      entityField="roomId"
      analyticsEvent="room_section_saved"
      initialValues={{
        amenityKeys: room.amenityKeys,
        featuredAmenityKeys: room.featuredAmenityKeys,
      }}
      action={saveRoomAmenities}
      onDirtyChange={onDirtyChange}
      onReset={() => setResetKey((k) => k + 1)}
    >
      {(state, pending, markDirty) => (
        <AmenityFields key={resetKey} state={state} pending={pending} markDirty={markDirty} />
      )}
    </SectionForm>
  );
}

/**
 * A grouped checklist with a star on each selected row. The star is the same
 * ghost icon button the Photos tiles use for "make this the hero", here
 * meaning "show this on the room card". Unselecting an amenity unfeatures it,
 * so the featured set is always a subset of the selection.
 */
function AmenityFields({
  state,
  pending,
  markDirty,
}: {
  state: FormState<AmenityValues>;
  pending: boolean;
  markDirty: () => void;
}) {
  const [selected, setSelected] = React.useState(() => new Set(state.values.amenityKeys));
  const [featured, setFeatured] = React.useState(() => new Set(state.values.featuredAmenityKeys));
  const full = featured.size >= MAX_FEATURED_AMENITIES;

  function toggle(key: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
    if (!on) {
      setFeatured((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
    markDirty();
  }

  function toggleFeatured(key: string) {
    setFeatured((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else if (next.size < MAX_FEATURED_AMENITIES) next.add(key);
      return next;
    });
    markDirty();
  }

  return (
    <FieldGroup className="max-w-3xl">
      {/* Mirrored for formData.getAll(), in catalogue order. */}
      {ROOM_AMENITIES.filter((a) => selected.has(a.key)).map((a) => (
        <input key={a.key} type="hidden" name="amenityKeys" value={a.key} />
      ))}
      {ROOM_AMENITIES.filter((a) => featured.has(a.key)).map((a) => (
        <input key={a.key} type="hidden" name="featuredAmenityKeys" value={a.key} />
      ))}

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-muted-foreground text-sm tabular-nums" aria-live="polite">
          {selected.size} selected · {featured.size} of {MAX_FEATURED_AMENITIES} featured
        </p>
        <p className="flex items-center gap-1.5 text-muted-foreground text-sm">
          <StarIcon className="size-3.5" aria-hidden />
          Star up to {MAX_FEATURED_AMENITIES} to show them on the room card.
        </p>
      </div>
      {state.errors?.amenityKeys && <FieldError>{state.errors.amenityKeys[0]}</FieldError>}
      {state.errors?.featuredAmenityKeys && <FieldError>{state.errors.featuredAmenityKeys[0]}</FieldError>}

      {ROOM_AMENITY_GROUPS.map((group) => (
        <FieldSet key={group}>
          <FieldLegend variant="label" className="text-muted-foreground text-xs uppercase tracking-wide">
            {group}
          </FieldLegend>
          <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            {ROOM_AMENITIES.filter((a) => a.group === group).map((a) => {
              const on = selected.has(a.key);
              const star = featured.has(a.key);
              return (
                <Field key={a.key} orientation="horizontal" className="min-h-9 items-center py-0.5">
                  <Checkbox
                    id={`amenity-${a.key}`}
                    checked={on}
                    onCheckedChange={(v) => toggle(a.key, v === true)}
                    disabled={pending}
                  />
                  <FieldLabel htmlFor={`amenity-${a.key}`} className="flex-1 font-normal">
                    {a.label}
                  </FieldLabel>
                  {on && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-pressed={star}
                      aria-label={star ? `Stop featuring ${a.label}` : `Feature ${a.label} on the room card`}
                      title={!star && full ? `You can feature up to ${MAX_FEATURED_AMENITIES}` : undefined}
                      disabled={pending || (!star && full)}
                      onClick={() => toggleFeatured(a.key)}
                    >
                      <StarIcon className={cn(star && "fill-current text-foreground")} />
                    </Button>
                  )}
                </Field>
              );
            })}
          </div>
        </FieldSet>
      ))}

      <FieldDescription>
        Featured amenities appear as chips on the guest room card, in the order listed here.
      </FieldDescription>
    </FieldGroup>
  );
}
