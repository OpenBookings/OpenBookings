"use client";

import type { SwitchableProperty } from "@openbookings/authz";
import { roleLabel } from "@openbookings/authz/role-guide";
import { Check, ChevronsUpDown } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { listSentence } from "@/components/dashboard/no-access";
import { SwitchingLoader } from "@/components/dashboard/page-loaders";
import { BrandLockup, SidebarBrand } from "@/components/dashboard/sidebar-08/sidebar-brand";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";
import { safeReturnTo, sectionIndex } from "@/lib/section-index";
import { switchProperty } from "@/lib/switch-property";

/** From this many hotels the list gets a search field. */
const SEARCH_FROM = 8;

/** member.role may be comma-separated: "Owner and Back office". */
function roleText(role: string): string {
  return listSentence(
    role
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean)
      .map(roleLabel),
  );
}

/**
 * The hotels by company, in the order they come (own companies first, the
 * demo company last). One company needs no heading.
 */
function byCompany(properties: SwitchableProperty[]) {
  const groups = new Map<string, SwitchableProperty[]>();
  for (const p of properties) {
    const group = groups.get(p.organizationId);
    if (group) group.push(p);
    else groups.set(p.organizationId, [p]);
  }
  const headed = groups.size > 1;
  return [...groups.values()].map((hotels) => ({
    organizationId: hotels[0]!.organizationId,
    heading: headed ? hotels[0]!.organizationName : undefined,
    hotels,
  }));
}

/** Plain substring search over the hotel and company names (cmdk's own is fuzzy). */
function matches(_value: string, search: string, keywords?: string[]): number {
  return (keywords ?? []).join(" ").toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0;
}

/** The open switcher: every hotel the user can reach, with their role at each. */
export function PropertyList({
  properties,
  currentId,
  onSelect,
}: {
  properties: SwitchableProperty[];
  currentId: string;
  onSelect: (property: SwitchableProperty) => void;
}) {
  return (
    <Command filter={matches}>
      {properties.length >= SEARCH_FROM ? <CommandInput placeholder="Find a hotel" /> : null}
      <CommandList>
        <CommandEmpty>No hotel matches.</CommandEmpty>
        {byCompany(properties).map(({ organizationId, heading, hotels }) => (
          <CommandGroup key={organizationId} heading={heading}>
            {hotels.map((p) => (
              <CommandItem
                key={p.propertyId}
                value={p.propertyId}
                keywords={[p.propertyName, p.organizationName]}
                onSelect={() => onSelect(p)}
              >
                <span className="grid min-w-0 flex-1 leading-tight">
                  <span className="truncate font-medium">{p.propertyName}</span>
                  <span className="truncate text-xs text-muted-foreground">{roleText(p.role)}</span>
                </span>
                {p.propertyId === currentId ? (
                  <>
                    <Check className="ml-auto text-foreground" aria-hidden />
                    <span className="sr-only">Current hotel</span>
                  </>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
}

/**
 * The sidebar header. With two or more hotels it is the switcher: the current
 * hotel and its company plus a chevron, opening the list. Picking another
 * hotel switches on the server (which checks access) and lands on the same
 * section there, under the logo loader until the new hotel's page is in.
 */
export function PropertySwitcher({
  properties,
  current,
}: {
  properties: SwitchableProperty[];
  current: SwitchableProperty | null;
}) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<SwitchableProperty | null>(null);
  const [switching, startSwitch] = useTransition();

  if (!current || properties.length < 2) return <SidebarBrand hotel={current} />;

  const select = (property: SwitchableProperty) => {
    setOpen(false);
    if (property.propertyId === current.propertyId) return;
    setOpenMobile(false);
    setTarget(property);
    startSwitch(async () => {
      // A switch redirects; a result means the server refused (access gone).
      const result = await switchProperty(property.propertyId, pathname);
      if (result?.ok === false) toast.error(`Couldn't switch to ${property.propertyName}.`);
    });
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <SidebarMenuButton
            size="lg"
            className="group-data-[collapsible=icon]:hidden data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <BrandLockup hotel={current} />
            <ChevronsUpDown className="ml-auto text-muted-foreground" />
            <span className="sr-only">Switch hotel</span>
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent
          className="w-(--radix-popover-trigger-width) min-w-72 p-0"
          side="bottom"
          align="start"
          sideOffset={4}
        >
          <PropertyList properties={properties} currentId={current.propertyId} onSelect={select} />
        </PopoverContent>
      </Popover>
      {switching && target
        ? createPortal(
            <SwitchingLoader hotelName={target.propertyName} to={sectionIndex(safeReturnTo(pathname))} />,
            document.body,
          )
        : null}
    </>
  );
}
