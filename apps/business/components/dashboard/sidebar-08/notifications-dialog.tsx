"use client";

import { BellOff } from "lucide-react";

import { NOTIFICATIONS } from "@/components/dashboard/sidebar-08/use-nav-attention";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

export function NotificationsDialog({
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
          <DialogTitle>Notifications</DialogTitle>
          <DialogDescription>
            Recent activity across your property.
          </DialogDescription>
        </DialogHeader>
        {NOTIFICATIONS.length === 0 ? (
          <Empty className="gap-2 border py-12 md:py-12">
            <EmptyHeader className="gap-1">
              <EmptyMedia className="mb-0 text-muted-foreground">
                <BellOff className="size-5" />
              </EmptyMedia>
              <EmptyDescription>You&apos;re all caught up.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="-mx-2 max-h-96 divide-y overflow-y-auto">
            {NOTIFICATIONS.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-1 px-2 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium">{entry.title}</p>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {dateFormatter.format(new Date(entry.date))}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{entry.body}</p>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
