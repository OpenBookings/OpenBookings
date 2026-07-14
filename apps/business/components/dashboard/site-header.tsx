"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { CommandMenu02 } from "@/components/dashboard/command-menu-02";
import { Kbd } from "@/components/ui/kbd";

export function SiteHeader({ title }: { title: string }) {
  const [commandOpen, setCommandOpen] = useState(false);

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <h1 className="text-base font-medium">{title}</h1>
        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className="ml-auto flex w-full max-w-64 items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-muted-foreground text-sm shadow-xs transition-colors hover:bg-accent dark:bg-input/30"
        >
          <Search className="size-4 shrink-0" />
          <span className="flex-1 truncate text-left">Search...</span>
          <Kbd>⌘K</Kbd>
        </button>
      </div>
      <CommandMenu02 open={commandOpen} onOpenChange={setCommandOpen} />
    </header>
  );
}
