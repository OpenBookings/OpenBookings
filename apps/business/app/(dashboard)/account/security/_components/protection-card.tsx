import { AttentionAlert } from "@/components/dashboard/attention-alert";
import { SectionLabel } from "@/components/dashboard/page-header";
import { AlertDescription } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/status-badge";
import { CircleCheck, CircleDashed } from "lucide-react";
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
          <AttentionAlert role="status" className="gap-x-4 p-4">
            <CircleDashed aria-hidden />
            <div className="col-start-2 flex flex-wrap items-center gap-4">
              <div className="min-w-0 flex-1 basis-56">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {openTask.title}
                  <StatusBadge tone="attention">Recommended</StatusBadge>
                </p>
                <AlertDescription className="mt-1 text-[13px]">{openTask.description}</AlertDescription>
              </div>
              <PendingButton className="max-sm:w-full" onClick={() => onAction(openTask.id)}>
                {openTask.action}
              </PendingButton>
            </div>
          </AttentionAlert>
        ) : null}

        {completed.length > 0 ? (
          <div>
            <SectionLabel>Completed</SectionLabel>
            <ul className="mt-1">
              {completed.map((task) => (
                <li key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 py-2.5 text-sm">
                  <CircleCheck aria-hidden className="size-4 shrink-0 text-state-positive" />
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
