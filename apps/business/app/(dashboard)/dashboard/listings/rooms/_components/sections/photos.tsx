"use client";

import { CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ImageManager } from "../../../_components/image-manager";
import { sectionStatus } from "../../_lib/completion";
import { LIMITS } from "../../_lib/constants";
import type { RoomSectionProps } from "./props";

/**
 * The Property editor's Photos section, for a room: the same ImageManager,
 * gallery only. Uploads commit as they finish, so there is no Save. The room
 * has no separate hero — its first photo is the cover on the guest card.
 */
export function PhotosSection({ data }: RoomSectionProps) {
  const { room, photos } = data;
  const status = sectionStatus("photos", data);

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

        <div className="pb-12">
          <ImageManager
            target={{ kind: "room", roomId: room.id }}
            images={photos}
            showAltText
            showReorder
            markFirstAsCover
            label="Gallery"
            description={`The room's photo carousel, in this order. The first photo is the cover. At least ${LIMITS.minPhotos}, each with alt text so the page works without images.`}
          />
        </div>
      </div>
    </div>
  );
}
