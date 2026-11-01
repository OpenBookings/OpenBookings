import * as React from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * The page's button: 44px tall, and while its action runs the label gives way
 * to a spinner without the button changing width.
 */
export function PendingButton({
  pending = false,
  disabled,
  className,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { pending?: boolean }) {
  return (
    <Button
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cn("relative h-11", className)}
      {...props}
    >
      <span className={cn("inline-flex items-center gap-2", pending && "invisible")}>{children}</span>
      {pending ? <Spinner className="absolute" /> : null}
    </Button>
  );
}

/** Outlined, in the danger colour: Remove and Sign out. Never filled. */
export const DANGER_OUTLINE =
  "border-(--red-5) text-(--red-11) hover:text-(--red-11) dark:border-(--red-5)";
