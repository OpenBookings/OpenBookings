"use client";

import { useCallback, useRef, useState } from "react";
import Uppy, {
  type Body,
  type Meta,
  type UppyFile,
} from "@uppy/core";
import XHRUpload from "@uppy/xhr-upload";
import { useUppyEvent, useUppyState } from "@uppy/react";
import { Upload, X, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface RoomImage {
  id: string;
  url: string;
}

interface Props {
  roomId: string;
  existingImages?: RoomImage[];
}

function createUppy(roomId: string) {
  const uppy = new Uppy<Meta, Body>({
    restrictions: {
      maxFileSize: 10 * 1024 * 1024,
      allowedFileTypes: ["image/jpeg", "image/png", "image/webp"],
    },
    autoProceed: false,
  });

  uppy.use(XHRUpload, {
    endpoint: async (fileOrBundle: UppyFile<Meta, Body> | UppyFile<Meta, Body>[]) => {
      const file = Array.isArray(fileOrBundle) ? fileOrBundle[0] : fileOrBundle;
      const res = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name ?? "upload",
          contentType: file.type ?? "image/jpeg",
        }),
      });
      if (!res.ok) throw new Error("Failed to get upload URL");
      const { uploadUrl, gcsKey } = (await res.json()) as {
        uploadUrl: string;
        gcsKey: string;
      };
      uppy.setFileMeta(file.id, { gcsKey, roomId });
      return uploadUrl;
    },
    method: "PUT",
    formData: false,
    headers: (file: UppyFile<Meta, Body>) => ({
      "Content-Type": file.type ?? "image/jpeg",
    }),
  });

  return uppy;
}

export function RoomImageUploader({ roomId, existingImages = [] }: Props) {
  const [uppy] = useState(() => createUppy(roomId));
  const [confirmedImages, setConfirmedImages] = useState<RoomImage[]>(existingImages);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const files = useUppyState(uppy, (s) => s.files);
  const fileList = Object.values(files);

  useUppyEvent(uppy, "upload-success", async (file) => {
    if (!file) return;
    const gcsKey = file.meta.gcsKey as string | undefined;
    const fileRoomId = file.meta.roomId as string | undefined;
    if (!gcsKey || !fileRoomId) return;

    const res = await fetch("/api/upload/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gcsKey, roomId: fileRoomId }),
    });
    if (!res.ok) return;

    const data = (await res.json()) as { id: string; url: string };
    setConfirmedImages((prev) => [...prev, { id: data.id, url: data.url }]);
    uppy.removeFile(file.id);
  });

  const addFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;
      Array.from(fileList).forEach((file) => {
        try {
          uppy.addFile({ name: file.name, type: file.type, data: file });
        } catch {
          // Uppy throws on duplicate files or restriction violations
        }
      });
    },
    [uppy]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  return (
    <div className="space-y-4">
      {confirmedImages.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {confirmedImages.map((img) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={img.id}
              src={img.url}
              alt=""
              className="aspect-square w-full rounded-md object-cover"
            />
          ))}
        </div>
      )}

      <div
        className={cn(
          "rounded-lg border-2 border-dashed p-8 text-center transition-colors",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-muted-foreground/50"
        )}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
      >
        <ImageIcon className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          Drop images here or{" "}
          <span className="text-primary underline-offset-2 hover:underline">
            browse
          </span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground/60">
          JPEG, PNG, WebP — max 10 MB
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>

      {fileList.length > 0 && (
        <div className="space-y-2">
          {fileList.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
            >
              <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {file.progress?.uploadComplete
                  ? "done"
                  : file.progress?.uploadStarted
                    ? `${Math.round(file.progress.percentage ?? 0)}%`
                    : "queued"}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  uppy.removeFile(file.id);
                }}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={() => uppy.upload()}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Upload className="h-4 w-4" />
            Upload {fileList.length} {fileList.length === 1 ? "image" : "images"}
          </button>
        </div>
      )}
    </div>
  );
}
