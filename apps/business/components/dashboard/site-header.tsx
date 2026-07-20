"use client";

import { Search } from "lucide-react";
import * as React from "react";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CommandMenu02 } from "@/components/dashboard/command-menu-02";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Kbd } from "@/components/ui/kbd";

function formatSegment(segment: string): string {
  return segment
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function SiteHeader({ title }: { title: string }) {
  const [commandOpen, setCommandOpen] = useState(false);
  const pathname = usePathname();

  // The section root is the first two segments (e.g. /dashboard/bookings);
  // `title` labels it and deeper segments become the rest of the trail.
  const segments = pathname.split("/").filter(Boolean);
  const sectionHref = `/${segments.slice(0, 2).join("/")}`;
  const trail = segments.slice(2).map((segment, index) => ({
    label: formatSegment(segment),
    href: `${sectionHref}/${segments.slice(2, index + 3).join("/")}`,
  }));

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              {trail.length === 0 ? (
                <BreadcrumbPage className="text-base font-medium">
                  {title}
                </BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <Link href={sectionHref}>{title}</Link>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
            {trail.map((crumb, index) => (
              <React.Fragment key={crumb.href}>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {index === trail.length - 1 ? (
                    <BreadcrumbPage className="text-base font-medium">
                      {crumb.label}
                    </BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link href={crumb.href}>{crumb.label}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </React.Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
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
