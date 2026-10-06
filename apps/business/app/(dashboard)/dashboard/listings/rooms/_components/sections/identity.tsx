"use client";

import * as React from "react";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import { SectionForm } from "../../../_components/section-form";
import { saveRoomIdentity } from "../../_lib/actions";
import { LIMITS } from "../../_lib/constants";
import type { RoomSectionProps } from "./props";

export function IdentitySection({ data, onDirtyChange }: RoomSectionProps) {
  const { room } = data;
  const [descriptionLength, setDescriptionLength] = React.useState(room.description?.length ?? 0);
  const over = descriptionLength > LIMITS.roomDescription.max;

  return (
    <SectionForm
      sectionId="identity"
      title="Identity"
      description="What guests call this room, and the paragraph that sells it."
      entityId={room.id}
      entityField="roomId"
      analyticsEvent="room_section_saved"
      initialValues={{ name: room.name, description: room.description ?? "" }}
      action={saveRoomIdentity}
      onDirtyChange={onDirtyChange}
      onReset={() => setDescriptionLength(room.description?.length ?? 0)}
    >
      {(state, pending) => (
        <FieldGroup className="max-w-2xl">
          <Field data-invalid={!!state.errors?.name}>
            <FieldLabel htmlFor="name">Room name</FieldLabel>
            <Input
              id="name"
              name="name"
              defaultValue={state.values.name}
              disabled={pending}
              aria-invalid={!!state.errors?.name}
              maxLength={LIMITS.roomName.max}
              placeholder="Deluxe King"
              autoComplete="off"
            />
            <FieldDescription>Shown as the room title to guests.</FieldDescription>
            {state.errors?.name && <FieldError>{state.errors.name[0]}</FieldError>}
          </Field>

          <Field data-invalid={!!state.errors?.description || over}>
            <FieldLabel htmlFor="description">Description</FieldLabel>
            <InputGroup>
              <InputGroupTextarea
                id="description"
                name="description"
                defaultValue={state.values.description}
                disabled={pending}
                aria-invalid={!!state.errors?.description || over}
                aria-describedby="description-help"
                rows={5}
                className="min-h-28 resize-none"
                placeholder="A corner room with a king bed, a rain shower and a view over the canal."
                onChange={(e) => setDescriptionLength(e.target.value.length)}
              />
              <InputGroupAddon align="block-end">
                <InputGroupText className={cn("tabular-nums", over && "text-destructive")}>
                  {descriptionLength}/{LIMITS.roomDescription.max}
                </InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription id="description-help">
              Shown on the room card. Keep it under {LIMITS.roomDescription.max} characters.
            </FieldDescription>
            {state.errors?.description && <FieldError>{state.errors.description[0]}</FieldError>}
          </Field>
        </FieldGroup>
      )}
    </SectionForm>
  );
}
