"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import posthog from "posthog-js";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface PublishToggleProps {
  published: boolean;
  /** Labels of the sections still incomplete. Empty means publishable. */
  incomplete: string[];
  setPublished: (published: boolean) => Promise<{ ok: boolean; error?: string }>;
  /** posthog event prefix: `${eventPrefix}_published` / `_unpublished`. */
  eventPrefix: string;
  copy: {
    published: { title: string; description: string };
    unpublished: { title: string; description: string };
  };
}

/**
 * Publishing is gated on every section being complete, and the same rule is
 * re-checked server-side by `setPublished`. Un-publishing is never gated: a
 * host must always be able to take their listing down.
 */
export function PublishToggle({
  published,
  incomplete,
  setPublished,
  eventPrefix,
  copy,
}: PublishToggleProps) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const blocked = incomplete.length > 0;

  async function toggle(next: boolean) {
    setPending(true);
    const result = await setPublished(next);
    setPending(false);

    if (!result.ok) {
      toast.error(next ? "Not published" : "Not unpublished", { description: result.error });
      return;
    }

    posthog.capture(next ? `${eventPrefix}_published` : `${eventPrefix}_unpublished`);
    const message = next ? copy.published : copy.unpublished;
    toast.success(message.title, { description: message.description });
    router.refresh();
  }

  const control = (
    <div className="flex items-center gap-2">
      <Switch
        id="publish"
        checked={published}
        // Never block taking a listing down, only putting one up.
        disabled={pending || (blocked && !published)}
        onCheckedChange={toggle}
      />
      <Label htmlFor="publish" className="font-normal text-sm">
        {published ? "Published" : "Not published"}
      </Label>
    </div>
  );

  if (!blocked || published) return control;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div>{control}</div>
      </TooltipTrigger>
      <TooltipContent side="right">
        <p className="font-medium">Finish these first</p>
        <ul className="mt-1 flex flex-col gap-0.5">
          {incomplete.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
