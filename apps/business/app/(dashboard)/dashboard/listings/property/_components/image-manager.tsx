"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon, ImageIcon, StarIcon, Trash2Icon, UploadCloudIcon } from "lucide-react";
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
import type { ImageGroup, PropertyImageRecord } from "../_lib/types";

type UploadState = "idle" | "uploading" | "processing" | "error" | "done";

interface PendingUpload {
  key: string;
  name: string;
  previewUrl: string;
  state: UploadState;
}

interface ImageManagerProps {
  propertyId: string;
  group: ImageGroup;
  images: PropertyImageRecord[];
  /** Gallery images carry alt text and reordering; hero and logo do not. */
  showAltText?: boolean;
  showReorder?: boolean;
  showSetHero?: boolean;
  label: string;
  description: string;
}

/**
 * Uploads run presign → PUT → confirm. The Attachment component's `state` prop
 * takes exactly that lifecycle, so a row in flight looks in flight and a failed
 * row keeps a retry instead of disappearing.
 */
export function ImageManager({
  propertyId,
  group,
  images,
  showAltText = false,
  showReorder = false,
  showSetHero = false,
  label,
  description,
}: ImageManagerProps) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [pending, setPending] = React.useState<PendingUpload[]>([]);

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
        body: JSON.stringify({ key: storageKey, propertyId, group }),
      });
      if (!confirm.ok) throw new Error("confirm failed");

      setState("done");
      posthog.capture("property_image_uploaded", { group });
      setPending((p) => p.filter((u) => u.key !== key));
      URL.revokeObjectURL(previewUrl);
      router.refresh();
    } catch (err: any) {
      console.error("Upload error:", err);
      setState("error");
      toast.error("Upload failed", { description: err.message || `${file.name} was not saved. Try again.` });
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/property-images/${id}`, {
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
    const res = await fetch(`/api/property-images/${id}`, { method: "DELETE" });
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
      fetch(`/api/property-images/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: b.sortOrder }),
      }),
      fetch(`/api/property-images/${b.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: a.sortOrder }),
      }),
    ]);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="space-y-1">
        <p className="font-medium text-base">{label}</p>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>

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
    </div>
  );
}
