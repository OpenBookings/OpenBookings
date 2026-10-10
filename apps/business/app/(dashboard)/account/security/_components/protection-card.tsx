import { CircleCheck, CircleDashed } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { Protection, ProtectionTaskId } from "@/lib/security-tasks";
import { formatSecurityTimestamp } from "@/lib/security-timestamp";
import { PendingButton } from "./pending-button";
import { ProgressRing } from "./progress-ring";

export function ProtectionCard({
  protection,
  onAction,
}: {
  protection: Protection;
  onAction: (task: ProtectionTaskId) => void;
}) {
  const { openTask, completed } = protection;
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center gap-5 p-6">
        <ProgressRing done={protection.done} total={protection.total} />
        <div className="min-w-0 flex-1 basis-56">
          <h2 className="text-[17px] font-semibold">{protection.headline}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{protection.subline}</p>
        </div>
      </div>

      <div className="flex flex-col gap-4 px-6 pb-6">
        {openTask ? (
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-(--amber-11)/25 bg-(--amber-3) p-4">
            <div className="flex min-w-0 flex-1 basis-56 items-start gap-4">
              <CircleDashed aria-hidden className="mt-0.5 size-5 shrink-0 text-(--amber-11)" />
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {openTask.title}
                  <Badge className="bg-(--accent-3) text-(--accent-11)">Recommended</Badge>
                </p>
                <p className="mt-1 text-[13px] text-muted-foreground">{openTask.description}</p>
              </div>
            </div>
            <PendingButton className="max-sm:w-full" onClick={() => onAction(openTask.id)}>
              {openTask.action}
            </PendingButton>
          </div>
        ) : null}

        {completed.length > 0 ? (
          <div>
            <p className="text-xs font-medium tracking-[0.04em] text-muted-foreground uppercase">Completed</p>
            <ul className="mt-1">
              {completed.map((task) => (
                <li key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 py-2.5 text-sm">
                  <CircleCheck aria-hidden className="size-4 shrink-0 text-(--green-11)" />
                  <span className="text-muted-foreground">{task.label}</span>
                  <span className="ml-auto text-[13px] text-muted-foreground">
                    {task.note ?? formatSecurityTimestamp(task.at)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
