"use client";

import { CHANGELOG } from "@/components/dashboard/sidebar-08/use-nav-attention";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function WhatsNewDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>What&apos;s new</DialogTitle>
          <DialogDescription>
            The latest changes to your dashboard.
          </DialogDescription>
        </DialogHeader>
        <ol className="max-h-96 space-y-5 overflow-y-auto">
          {CHANGELOG.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                {dateFormatter.format(new Date(entry.date))}
              </span>
              <p className="text-sm font-medium">{entry.title}</p>
              <p className="text-sm text-muted-foreground">{entry.body}</p>
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}
