"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ImageIcon,
  RefreshCwIcon,
  StarIcon,
  Trash2Icon,
  UploadCloudIcon,
} from "lucide-react";
import { toast } from "sonner";
import posthog from "posthog-js";
import {
  Attachment,
  AttachmentActions,
  AttachmentAction,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
} from "@/components/ui/attachment";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { ImageGroup } from "../property/_lib/types";

type UploadState = "idle" | "uploading" | "processing" | "error" | "done";

interface PendingUpload {
  key: string;
  name: string;
  previewUrl: string;
  state: UploadState;
}

/** One stored photo, as either editor loads it. */
export interface ManagedImage {
  id: string;
  url: string;
  sortOrder: number;
  altText: string | null;
}

/**
 * Where uploads land and which routes edit them. A property photo belongs to a
 * group (hero, logo, gallery); a room photo is always part of one gallery.
 */
export type ImageTarget =
  | { kind: "property"; propertyId: string; group: ImageGroup }
  | { kind: "room"; roomId: string };

interface ImageManagerProps {
  target: ImageTarget;
  images: ManagedImage[];
  /** Gallery images carry alt text and reordering; hero and logo do not. */
  showAltText?: boolean;
  showReorder?: boolean;
  showSetHero?: boolean;
  /** Label the first photo as the cover. A room's cover is simply its first photo. */
  markFirstAsCover?: boolean;
  /**
   * Hero and logo hold exactly one image: the confirm route deletes the old
   * row on upload. The slot shows that image with a "Replace" affordance on it
   * instead of an "Add" card, which read as "you can have several".
   */
  single?: { aspect: "wide" | "square" };
  label: string;
  description: string;
}

/**
 * Uploads run presign → PUT → confirm. The Attachment component's `state` prop
 * takes exactly that lifecycle, so a row in flight looks in flight and a failed
 * row keeps a retry instead of disappearing.
 */
export function ImageManager({
  target,
  images,
  showAltText = false,
  showReorder = false,
  showSetHero = false,
  markFirstAsCover = false,
  single,
  label,
  description,
}: ImageManagerProps) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [pending, setPending] = React.useState<PendingUpload[]>([]);

  const group = target.kind === "property" ? target.group : "gallery";
  const imagesRoute = target.kind === "property" ? "/api/property-images" : "/api/room-images";
  const confirmBody =
    target.kind === "property"
      ? { propertyId: target.propertyId, group: target.group }
      : { roomId: target.roomId };
  const uploadedEvent = target.kind === "property" ? "property_image_uploaded" : "room_image_uploaded";

  async function upload(file: File) {
    const key = `${file.name}-${Date.now()}-${Math.random()}`;
    const previewUrl = URL.createObjectURL(file);
    setPending((p) => [...p, { key, name: file.name, previewUrl, state: "uploading" }]);

    const setState = (state: UploadState) =>
      setPending((p) => p.map((u) => (u.key === key ? { ...u, state } : u)));

    try {
      const presign = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType: file.type }),
      });
      if (!presign.ok) throw new Error("presign failed");
      const { uploadUrl, key: storageKey } = await presign.json();

      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error("upload failed");

      setState("processing");

      const confirm = await fetch("/api/upload/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: storageKey, ...confirmBody }),
      });
      if (!confirm.ok) throw new Error("confirm failed");

      setState("done");
      posthog.capture(uploadedEvent, { group });
      setPending((p) => p.filter((u) => u.key !== key));
      URL.revokeObjectURL(previewUrl);
      router.refresh();
    } catch (err) {
      console.error("Upload error:", err);
      setState("error");
      const message = err instanceof Error ? err.message : "";
      toast.error("Upload failed", { description: message || `${file.name} was not saved. Try again.` });
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`${imagesRoute}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      toast.error("Could not update that photo.");
      return;
    }
    router.refresh();
  }

  async function remove(id: string) {
    const res = await fetch(`${imagesRoute}/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Could not remove that photo.");
      return;
    }
    router.refresh();
  }

  /** Swap sort_order with the neighbour, rather than renumbering the whole list. */
  async function move(index: number, direction: -1 | 1) {
    const a = images[index];
    const b = images[index + direction];
    if (!a || !b) return;
    await Promise.all([
      fetch(`${imagesRoute}/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: b.sortOrder }),
      }),
      fetch(`${imagesRoute}/${b.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: a.sortOrder }),
      }),
    ]);
    router.refresh();
  }

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      multiple={group === "gallery"}
      hidden
      onChange={(e) => {
        Array.from(e.target.files ?? []).forEach(upload);
        e.target.value = "";
      }}
    />
  );

  const header = (
    <div className="space-y-1">
      <p className="font-medium text-base">{label}</p>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  );

  if (single) {
    // An upload in flight wins over the stored image: it is what the slot is
    // about to hold, and showing both would bring back the "two images" read.
    const inFlight = pending.at(-1);
    const current = images[0];
    const busy = !!inFlight && inFlight.state !== "error";
    const src = (busy ? inFlight.previewUrl : undefined) ?? current?.url;

    return (
      <div className="flex flex-col gap-5">
        {header}

        <div
          className={cn(
            "group/slot relative overflow-hidden rounded-xl border bg-muted",
            single.aspect === "wide" ? "aspect-video w-full max-w-md" : "aspect-square w-40",
            !src && "border-dashed",
            inFlight?.state === "error" && "border-destructive/40",
          )}
        >
          {src && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt=""
              className={cn(
                "size-full",
                single.aspect === "wide" ? "object-cover" : "object-contain p-3",
                busy && "opacity-60",
              )}
            />
          )}

          {/* The whole slot is the button; the label sits on the image itself. */}
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            aria-label={src ? `Replace ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}
            className={cn(
              "absolute inset-0 flex items-center justify-center text-sm outline-none transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
              src
                ? "items-end justify-end p-3 hover:bg-black/30"
                : "flex-col gap-1.5 text-muted-foreground hover:bg-muted-foreground/5 hover:text-foreground",
              busy && "cursor-wait items-center justify-center bg-black/30 p-0",
            )}
          >
            {busy ? (
              <span className="flex items-center gap-2 rounded-full bg-background/90 px-3 py-1.5 font-medium text-foreground text-xs shadow-sm">
                <Spinner className="size-3.5" />
                {inFlight.state === "processing" ? "Saving…" : "Uploading…"}
              </span>
            ) : src ? (
              <span className="flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1.5 font-medium text-foreground text-xs shadow-sm">
                <RefreshCwIcon className="size-3.5" />
                Replace image
              </span>
            ) : (
              <>
                <UploadCloudIcon className="size-5" />
                Upload image
              </>
            )}
          </button>
        </div>

        {current && !busy && (
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => remove(current.id)}
            >
              <Trash2Icon />
              Remove {label.toLowerCase()}
            </Button>
          </div>
        )}
        {inFlight?.state === "error" && (
          <p className="text-destructive text-sm">That upload failed. Choose the image again to retry.</p>
        )}

        {fileInput}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {header}

      <AttachmentGroup className="flex-wrap">
        {images.map((image, index) => (
          <Attachment key={image.id} state="done" size="default" orientation="vertical">
            <AttachmentMedia variant="image">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.url} alt={image.altText ?? ""} />
            </AttachmentMedia>
            <AttachmentContent>
              {showAltText && (
                <Input
                  aria-label={`Alt text for photo ${index + 1}`}
                  defaultValue={image.altText ?? ""}
                  placeholder="Describe this photo"
                  className="h-8 text-sm"
                  onBlur={(e) => {
                    if (e.target.value !== (image.altText ?? "")) {
                      patch(image.id, { altText: e.target.value });
                    }
                  }}
                />
              )}
              {!showAltText && <AttachmentDescription>{group}</AttachmentDescription>}
              {markFirstAsCover && index === 0 && (
                <AttachmentDescription>Cover photo</AttachmentDescription>
              )}
            </AttachmentContent>
            <AttachmentActions>
              {showReorder && (
                <>
                  <AttachmentAction
                    aria-label={`Move photo ${index + 1} earlier`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ChevronLeftIcon />
                  </AttachmentAction>
                  <AttachmentAction
                    aria-label={`Move photo ${index + 1} later`}
                    disabled={index === images.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ChevronRightIcon />
                  </AttachmentAction>
                </>
              )}
              {showSetHero && (
                <AttachmentAction
                  aria-label={`Use photo ${index + 1} as the hero image`}
                  onClick={() => patch(image.id, { group: "hero-image" })}
                >
                  <StarIcon />
                </AttachmentAction>
              )}
              <AttachmentAction
                aria-label={`Remove photo ${index + 1}`}
                onClick={() => remove(image.id)}
              >
                <Trash2Icon />
              </AttachmentAction>
            </AttachmentActions>
          </Attachment>
        ))}

        {pending.map((u) => (
          <Attachment key={u.key} state={u.state} size="default" orientation="vertical">
            <AttachmentMedia variant="image">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u.previewUrl} alt="" />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentDescription>
                {u.state === "error" ? "Failed" : u.state === "processing" ? "Saving…" : "Uploading…"}
              </AttachmentDescription>
            </AttachmentContent>
          </Attachment>
        ))}

        <Attachment state="idle" size="default" orientation="vertical">
          <AttachmentMedia>
            <ImageIcon />
          </AttachmentMedia>
          <AttachmentContent>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => inputRef.current?.click()}
            >
              <UploadCloudIcon />
              Add
            </Button>
          </AttachmentContent>
        </Attachment>
      </AttachmentGroup>

      {fileInput}
    </div>
  );
}
