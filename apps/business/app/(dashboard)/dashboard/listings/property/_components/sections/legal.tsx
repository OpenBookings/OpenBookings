"use client";

import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { saveLegal } from "../../_lib/actions";
import { SectionForm } from "../section-form";
import type { SectionProps } from "./props";

export function LegalSection({ data, onDirtyChange }: SectionProps) {
  const { property, content } = data;

  return (
    <SectionForm
      sectionId="legal"
      title="Legal & business details"
      description="Shown to guests under 'View business details'. Your booking is a direct contract with this entity, so it has to be right."
      propertyId={property.id}
      initialValues={{
        legalCompanyName: content.legalCompanyName ?? "",
        contactEmail: content.contactEmail ?? "",
        contactPhone: content.contactPhone ?? "",
        companyRegistration: content.companyRegistration ?? "",
        vatNumber: content.vatNumber ?? "",
      }}
      action={saveLegal}
      onDirtyChange={onDirtyChange}
    >
      {(state, pending) => (
        <FieldGroup className="max-w-2xl">
          <Field data-invalid={!!state.errors?.legalCompanyName}>
            <FieldLabel htmlFor="legalCompanyName">Legal company name</FieldLabel>
            <Input
              id="legalCompanyName"
              name="legalCompanyName"
              defaultValue={state.values.legalCompanyName}
              disabled={pending}
              aria-invalid={!!state.errors?.legalCompanyName}
            />
            <FieldDescription>
              The entity guests contract with — not your trading name, if they differ.
            </FieldDescription>
            {state.errors?.legalCompanyName && (
              <FieldError>{state.errors.legalCompanyName[0]}</FieldError>
            )}
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field data-invalid={!!state.errors?.contactEmail}>
              <FieldLabel htmlFor="contactEmail">Contact email</FieldLabel>
              <Input
                id="contactEmail"
                name="contactEmail"
                type="email"
                defaultValue={state.values.contactEmail}
                disabled={pending}
                aria-invalid={!!state.errors?.contactEmail}
              />
              {state.errors?.contactEmail && <FieldError>{state.errors.contactEmail[0]}</FieldError>}
            </Field>

            <Field data-invalid={!!state.errors?.contactPhone}>
              <FieldLabel htmlFor="contactPhone">Contact phone</FieldLabel>
              <Input
                id="contactPhone"
                name="contactPhone"
                type="tel"
                defaultValue={state.values.contactPhone}
                disabled={pending}
                aria-invalid={!!state.errors?.contactPhone}
              />
              {state.errors?.contactPhone && <FieldError>{state.errors.contactPhone[0]}</FieldError>}
            </Field>

            <Field data-invalid={!!state.errors?.companyRegistration}>
              <FieldLabel htmlFor="companyRegistration">Company registration</FieldLabel>
              <Input
                id="companyRegistration"
                name="companyRegistration"
                defaultValue={state.values.companyRegistration}
                disabled={pending}
                aria-invalid={!!state.errors?.companyRegistration}
              />
              {state.errors?.companyRegistration && (
                <FieldError>{state.errors.companyRegistration[0]}</FieldError>
              )}
            </Field>

            <Field data-invalid={!!state.errors?.vatNumber}>
              <FieldLabel htmlFor="vatNumber">VAT number</FieldLabel>
              <Input
                id="vatNumber"
                name="vatNumber"
                defaultValue={state.values.vatNumber}
                disabled={pending}
                aria-invalid={!!state.errors?.vatNumber}
              />
              {state.errors?.vatNumber && <FieldError>{state.errors.vatNumber[0]}</FieldError>}
            </Field>
          </div>

          <Field>
            <FieldLabel>Registered address</FieldLabel>
            <FieldDescription>
              Guests see the address from your Location section — {property.addressLine1},{" "}
              {property.postalCode} {property.city}. Change it there rather than entering it twice.
            </FieldDescription>
          </Field>
        </FieldGroup>
      )}
    </SectionForm>
  );
}
