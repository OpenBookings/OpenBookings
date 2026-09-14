"use client";

import { CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { sectionStatus } from "../../_lib/completion";
import { ImageManager } from "../image-manager";
import type { SectionProps } from "./props";

/**
 * Photos do not use SectionForm: an upload is a file transfer that commits as
 * it completes, not a form field held until a Save press. The status alert
 * gives the section the same "what is still missing" affordance the form
 * sections get from their error summary.
 */
export function PhotosSection({ data }: SectionProps) {
  const { property, images } = data;
  const status = sectionStatus("photos", data);

  const hero = images.filter((i) => i.group === "hero-image");
  const gallery = images.filter((i) => i.group === "gallery");
  const logo = images.filter((i) => i.group === "logo");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-6 py-5">
        <h2 className="font-medium text-lg">Photos</h2>
        <p className="text-muted-foreground text-sm">
          Changes here save as soon as each upload finishes.
        </p>
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto px-8 py-8">
        {!status.complete && (
          <div className="mb-10">
            <Alert role="alert">
              <CircleAlertIcon />
              <AlertTitle>This section is not finished</AlertTitle>
              <AlertDescription>
                <ul className="flex flex-col gap-1">
                  {status.missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          </div>
        )}

        <div className="flex flex-col divide-y divide-border pb-12">
          <div className="pb-12">
            <ImageManager
              propertyId={property.id}
              group="hero-image"
              images={hero}
              label="Hero image"
              description="The full-screen photo behind your property name. A new upload replaces the current one."
            />
          </div>

          <div className="py-12">
            <ImageManager
              propertyId={property.id}
              group="gallery"
              images={gallery}
              showAltText
              showReorder
              showSetHero
              label="Gallery"
              description="The strip beneath the hero, in this order. At least three, each with alt text so the page works without images."
            />
          </div>

          <div className="pt-12">
            <ImageManager
              propertyId={property.id}
              group="logo"
              images={logo}
              label="Logo"
              description="Optional. Shown in the page footer; without one your property name is used instead."
            />
          </div>
        </div>
      </div>
    </div>
  );
}
