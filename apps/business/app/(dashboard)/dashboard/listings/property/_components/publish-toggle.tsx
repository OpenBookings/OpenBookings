"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import posthog from "posthog-js";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { setPublished } from "../_lib/actions";
import type { SectionStatus } from "../_lib/completion";
import { SECTION_IDS, SECTION_LABELS, type PropertyEditorData, type SectionId } from "../_lib/types";

interface PublishToggleProps {
  data: PropertyEditorData;
  statuses: Record<SectionId, SectionStatus>;
}

/**
 * Publishing is gated on every section being complete, and the same rule is
 * re-checked server-side in setPublished. Un-publishing is never gated: a host
 * must always be able to take their listing down.
 */
export function PublishToggle({ data, statuses }: PublishToggleProps) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  const incomplete = SECTION_IDS.filter((id) => !statuses[id].complete);
  const blocked = incomplete.length > 0;
  const published = data.property.isActive;

  async function toggle(next: boolean) {
    setPending(true);
    const result = await setPublished(data.property.id, next);
    setPending(false);

    if (!result.ok) {
      toast.error("Not published", { description: result.error });
      return;
    }

    posthog.capture(next ? "property_published" : "property_unpublished");
    toast.success(next ? "Your listing is live" : "Your listing is hidden", {
      description: next
        ? "Guests can find and book it now."
        : "Guests can no longer see or book it.",
    });
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
          {incomplete.map((id) => (
            <li key={id}>{SECTION_LABELS[id]}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
