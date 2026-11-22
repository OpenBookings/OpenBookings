import type * as React from "react";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/**
 * An Alert in the attention (amber) state: something the host should look at,
 * not an error. Errors use `<Alert variant="destructive">`.
 */
export function AttentionAlert({ className, ...props }: React.ComponentProps<typeof Alert>) {
  return (
    <Alert
      className={cn("border-state-attention/30 bg-state-attention/8 [&>svg]:text-state-attention", className)}
      {...props}
    />
  );
}
