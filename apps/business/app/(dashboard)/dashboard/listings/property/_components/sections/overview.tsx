"use client";

import * as React from "react";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { saveOverview } from "../../_lib/actions";
import type { AmenityCatalogEntry } from "../../_lib/query";
import { AmenityPicker } from "../amenity-picker";
import { SectionForm } from "../section-form";
import type { SectionProps } from "./props";

const MIN_DESCRIPTION = 120;

export function OverviewSection({
  data,
  amenities,
  onDirtyChange,
}: SectionProps & { amenities: AmenityCatalogEntry[] }) {
  const { property, content, amenityIds } = data;
  const [descriptionLength, setDescriptionLength] = React.useState(
    content.overviewDescription?.length ?? 0,
  );

  return (
    <SectionForm
      sectionId="overview"
      title="Overview"
      description="The pitch guests read after your photos, and the note that closes the page."
      propertyId={property.id}
      initialValues={{
        overviewHeadline: content.overviewHeadline ?? "",
        overviewDescription: content.overviewDescription ?? "",
        ctaHeadline: content.ctaHeadline ?? "",
        ctaBody: content.ctaBody ?? "",
        amenityIds,
      }}
      action={saveOverview}
      onDirtyChange={onDirtyChange}
    >
      {(state, pending) => (
        <FieldGroup className="max-w-3xl">
          <Field data-invalid={!!state.errors?.overviewHeadline}>
            <FieldLabel htmlFor="overviewHeadline">Headline</FieldLabel>
            <Input
              id="overviewHeadline"
              name="overviewHeadline"
              defaultValue={state.values.overviewHeadline}
              disabled={pending}
              aria-invalid={!!state.errors?.overviewHeadline}
              placeholder="Where stillness meets the sea"
            />
            <FieldDescription>One line. It sets the tone for the whole page.</FieldDescription>
            {state.errors?.overviewHeadline && (
              <FieldError>{state.errors.overviewHeadline[0]}</FieldError>
            )}
          </Field>

          <Field data-invalid={!!state.errors?.overviewDescription}>
            <FieldLabel htmlFor="overviewDescription">Description</FieldLabel>
            <InputGroup>
              <InputGroupTextarea
                id="overviewDescription"
                name="overviewDescription"
                defaultValue={state.values.overviewDescription}
                disabled={pending}
                aria-invalid={!!state.errors?.overviewDescription}
                rows={6}
                className="min-h-32 resize-none"
                placeholder="What makes staying here different from staying anywhere else?"
                onChange={(e) => setDescriptionLength(e.target.value.length)}
              />
              <InputGroupAddon align="block-end">
                <InputGroupText className="tabular-nums">
                  {descriptionLength}/{MIN_DESCRIPTION} minimum
                </InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            {state.errors?.overviewDescription && (
              <FieldError>{state.errors.overviewDescription[0]}</FieldError>
            )}
          </Field>

          <FieldSeparator />

          <Field data-invalid={!!state.errors?.amenityIds}>
            <FieldLabel>Amenities</FieldLabel>
            <FieldDescription>
              Shown as pills under your description, and in the full amenities dialog.
            </FieldDescription>
            <AmenityPicker
              amenities={amenities}
              selectedIds={state.values.amenityIds}
              disabled={pending}
            />
            {state.errors?.amenityIds && <FieldError>{state.errors.amenityIds[0]}</FieldError>}
          </Field>

          <FieldSeparator />

          <Field data-invalid={!!state.errors?.ctaHeadline}>
            <FieldLabel htmlFor="ctaHeadline">Closing headline</FieldLabel>
            <Input
              id="ctaHeadline"
              name="ctaHeadline"
              defaultValue={state.values.ctaHeadline}
              disabled={pending}
              aria-invalid={!!state.errors?.ctaHeadline}
              placeholder="Ready to arrive?"
            />
            <FieldDescription>The last thing guests read before the booking button.</FieldDescription>
            {state.errors?.ctaHeadline && <FieldError>{state.errors.ctaHeadline[0]}</FieldError>}
          </Field>

          <Field data-invalid={!!state.errors?.ctaBody}>
            <FieldLabel htmlFor="ctaBody">Closing message</FieldLabel>
            <Textarea
              id="ctaBody"
              name="ctaBody"
              defaultValue={state.values.ctaBody}
              disabled={pending}
              aria-invalid={!!state.errors?.ctaBody}
              rows={3}
              className="resize-none"
              placeholder="Reserve your stay and let us take care of the rest."
            />
            {state.errors?.ctaBody && <FieldError>{state.errors.ctaBody[0]}</FieldError>}
          </Field>
        </FieldGroup>
      )}
    </SectionForm>
  );
}
