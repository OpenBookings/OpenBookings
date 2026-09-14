"use client";

import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Button } from "@/components/ui/button";
import { saveIdentity } from "../../_lib/actions";
import { SectionForm } from "../section-form";
import type { SectionProps } from "./props";

export function IdentitySection({ data, onDirtyChange }: SectionProps) {
  const { property } = data;

  return (
    <SectionForm
      sectionId="identity"
      title="Identity"
      description="How your property is named on OpenBookings."
      propertyId={property.id}
      initialValues={{ name: property.name, subtitle: property.subtitle ?? "" }}
      action={saveIdentity}
      onDirtyChange={onDirtyChange}
    >
      {(state, pending) => (
        <FieldGroup className="max-w-2xl">
          <Field data-invalid={!!state.errors?.name}>
            <FieldLabel htmlFor="name">Property name</FieldLabel>
            <Input
              id="name"
              name="name"
              defaultValue={state.values.name}
              disabled={pending}
              aria-invalid={!!state.errors?.name}
              placeholder="Grand Hotel Amsterdam"
              autoComplete="off"
            />
            <FieldDescription>The headline guests see over your hero photo.</FieldDescription>
            {state.errors?.name && <FieldError>{state.errors.name[0]}</FieldError>}
          </Field>

          <Field data-invalid={!!state.errors?.subtitle}>
            <FieldLabel htmlFor="subtitle">Tagline</FieldLabel>
            <Input
              id="subtitle"
              name="subtitle"
              defaultValue={state.values.subtitle}
              disabled={pending}
              aria-invalid={!!state.errors?.subtitle}
              placeholder="Where the city slows down"
              autoComplete="off"
            />
            <FieldDescription>One line, shown directly beneath the name.</FieldDescription>
            {state.errors?.subtitle && <FieldError>{state.errors.subtitle[0]}</FieldError>}
          </Field>

          <Field>
            <FieldLabel htmlFor="slug">Public address</FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <InputGroupText>openbookings.co/p/</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput id="slug" value={property.slug} readOnly disabled />
            </InputGroup>
            <FieldDescription>
              Changing this breaks every link you have already shared, so it is fixed once your
              listing is created.{" "}
              <Button variant="link" size="sm" asChild className="h-auto p-0">
                <a href="/support">Contact support</a>
              </Button>{" "}
              if you need it changed.
            </FieldDescription>
          </Field>
        </FieldGroup>
      )}
    </SectionForm>
  );
}
