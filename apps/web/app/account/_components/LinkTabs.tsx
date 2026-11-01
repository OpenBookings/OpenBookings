import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Tabs that are links, so the selected tab lives in the URL and the server
 * renders only its panel. Looks like apps/business's `TabsList`/`TabsTrigger`.
 */
export function LinkTabs({
  label,
  tabs,
}: {
  label: string;
  tabs: { href: string; title: string; count?: number; current: boolean }[];
}) {
  return (
    <nav aria-label={label} className="inline-flex h-9 w-fit items-center rounded-lg bg-muted p-[3px] text-muted-foreground">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          scroll={false}
          aria-current={tab.current ? "page" : undefined}
          className={cn(
            "inline-flex h-[calc(100%-1px)] items-center justify-center gap-1.5 rounded-md border border-transparent px-3 py-1 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            tab.current
              ? "border-input bg-input/30 text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.title}
          {tab.count !== undefined ? (
            <span className="rounded-md bg-secondary px-1.5 text-xs leading-5 text-secondary-foreground tabular-nums">
              {tab.count}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
