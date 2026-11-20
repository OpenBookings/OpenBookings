import { ObGlobe } from "@/components/dashboard/ob-globe";
import { cn } from "@/lib/utils";

/**
 * The logo loader for one part of a page, such as a message thread or a list
 * inside a card: the animated globe alone, small, where grey placeholder
 * blocks would otherwise go. Whole pages use PageLoading (page-loaders.tsx).
 */
export function InlineLoader({ label, size = "md", className }: { label: string; size?: "sm" | "md"; className?: string }) {
  return (
    <div role="status" className={cn("flex items-center justify-center", size === "md" && "py-10", className)}>
      <span className="sr-only">{label}</span>
      <ObGlobe animated className={size === "sm" ? "h-5 w-auto" : "h-9 w-auto"} />
    </div>
  );
}
