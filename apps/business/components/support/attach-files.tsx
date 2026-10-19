"use client";

import { FileText, ImageIcon, Paperclip, X } from "lucide-react";
import * as React from "react";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Button } from "@/components/ui/button";
import { ATTACHMENT_ACCEPT, ATTACHMENT_LIMITS, attachmentProblem } from "@/lib/support/attachments";

export type PickedFile = { id: string; file: File; problem: string | null };

/** Files that will actually be sent: the rejected ones stay as error chips. */
export function sendableFiles(files: PickedFile[]): File[] {
  return files.filter((f) => !f.problem).map((f) => f.file);
}

export function toPicked(files: File[]): PickedFile[] {
  return files.map((file, i) => ({ id: `${Date.now()}-${i}-${file.name}`, file, problem: attachmentProblem(file) }));
}

/** A compact Attach button; the chips render separately (see AttachmentChips). */
export function AttachButton({
  files,
  onChange,
  disabled,
  variant = "ghost",
}: {
  files: PickedFile[];
  onChange: (files: PickedFile[]) => void;
  disabled?: boolean;
  variant?: "ghost" | "outline";
}) {
  const input = React.useRef<HTMLInputElement>(null);
  const full = sendableFiles(files).length >= ATTACHMENT_LIMITS.maxFiles;
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={variant === "ghost" ? "icon-sm" : "sm"}
        aria-label="Attach files"
        disabled={disabled || full}
        onClick={() => input.current?.click()}
      >
        <Paperclip />
        {variant === "outline" ? "Attach" : null}
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const picked = toPicked(Array.from(event.target.files ?? []));
          event.target.value = "";
          const room = ATTACHMENT_LIMITS.maxFiles - sendableFiles(files).length;
          let accepted = 0;
          onChange([
            ...files,
            ...picked.map((p) =>
              p.problem || accepted++ < room ? p : { ...p, problem: `At most ${ATTACHMENT_LIMITS.maxFiles} files.` },
            ),
          ]);
        }}
      />
    </>
  );
}

export function AttachmentChips({
  files,
  onRemove,
}: {
  files: PickedFile[];
  onRemove: (id: string) => void;
}) {
  if (files.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Attachments">
      {files.map((f) => (
        <li key={f.id}>
          <Attachment size="xs" state={f.problem ? "error" : "done"} className="max-w-full min-w-0">
            <AttachmentMedia>{f.file.type.startsWith("image/") ? <ImageIcon /> : <FileText />}</AttachmentMedia>
            <AttachmentContent className="min-w-0">
              <AttachmentTitle className="max-w-40 truncate">{f.file.name}</AttachmentTitle>
              {f.problem ? (
                <AttachmentDescription className="text-destructive" role="alert">
                  {f.problem}
                </AttachmentDescription>
              ) : null}
            </AttachmentContent>
            <AttachmentActions>
              <AttachmentAction aria-label={`Remove ${f.file.name}`} onClick={() => onRemove(f.id)}>
                <X />
              </AttachmentAction>
            </AttachmentActions>
          </Attachment>
        </li>
      ))}
    </ul>
  );
}
