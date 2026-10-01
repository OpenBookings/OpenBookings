import Link from "next/link";
import { Circle, CircleCheck, CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isReady, type ReadinessItem, type ReadinessState } from "@/lib/analytics/readiness";

const ICONS: Record<ReadinessState, typeof Circle> = {
  done: CircleCheck,
  todo: Circle,
  unknown: CircleHelp,
};

/**
 * The message for a host with no bookings yet. The checklist is the useful
 * part: a host in this state usually wants to know why, and every item on it
 * is something they can fix today.
 */
export function ReadinessCard({ readiness, demoHref }: { readiness: ReadinessItem[]; demoHref: string }) {
  const ready = isReady(readiness);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your analytics start with your first booking</CardTitle>
        <CardDescription>
          {ready
            ? "Everything is set up, so bookings will appear here as they come in."
            : "This page fills in as guests book."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {ready ? null : (
          <div>
            <p className="font-medium text-sm">Before your first booking</p>
            <ul className="mt-2 space-y-2">
              {readiness.map((item) => {
                const Icon = ICONS[item.state];
                return (
                  <li key={item.key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon
                        className={item.state === "done" ? "size-4 shrink-0 text-(--green-11)" : "size-4 shrink-0 text-muted-foreground"}
                        aria-hidden
                      />
                      <span className={item.state === "done" ? "text-muted-foreground" : undefined}>
                        {item.label}
                      </span>
                    </span>
                    {item.state === "done" ? (
                      <span className="shrink-0 text-muted-foreground text-xs">Done</span>
                    ) : (
                      <Link href={item.href} className="shrink-0 underline underline-offset-4">
                        {item.state === "unknown" ? "Check" : item.action}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <Button asChild>
          <Link href={demoHref}>Preview with demo data</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
