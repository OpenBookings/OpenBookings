"use client";

import {
  IconArrowRight,
  IconAt,
  IconBuilding,
  IconCalendarEvent,
  IconDeviceDesktop,
  IconFileSearch,
  IconLogin,
  IconLogout,
  IconMessage,
  IconPlus,
  IconSettings,
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type CommandMenuAction,
  commandMenuGroups,
  searchReservations,
} from "@/components/dashboard/command-menu-data";
import type { MockReservationStatus } from "@/components/dashboard/mock-reservations";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

// Resolves the string icon names used in the JSON config to components.
const iconRegistry: Record<string, React.ComponentType<{ className?: string }>> = {
  "arrow-right": IconArrowRight,
  at: IconAt,
  building: IconBuilding,
  "device-desktop": IconDeviceDesktop,
  "file-search": IconFileSearch,
  login: IconLogin,
  logout: IconLogout,
  message: IconMessage,
  plus: IconPlus,
  settings: IconSettings,
};

const statusLabels: Record<MockReservationStatus, string> = {
  confirmed: "Confirmed",
  checked_in: "In house",
  checked_out: "Checked out",
  pending: "Pending",
};

const statusDotClasses: Record<MockReservationStatus, string> = {
  confirmed: "bg-emerald-500",
  checked_in: "bg-blue-500",
  checked_out: "bg-muted-foreground",
  pending: "bg-amber-500",
};

type CommandMenu02Props = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function CommandMenu02({ open: controlledOpen, onOpenChange }: CommandMenu02Props = {}) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = useCallback((value: boolean) => {
    if (isControlled) {
      onOpenChange?.(value);
    } else {
      setInternalOpen(value);
    }
  }, [isControlled, onOpenChange]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(!open);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, setOpen]);

  const reservationResults = useMemo(
    () => searchReservations(inputValue),
    [inputValue]
  );

  const runAction = useCallback((action: CommandMenuAction) => {
    setOpen(false);
    if (action.type === "navigate" && action.href !== "#") {
      router.push(action.href);
    }
    // "command" actions are not wired up yet; they only close the menu.
  }, [router, setOpen]);

  return (
    <>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogHeader className="sr-only">
          <DialogTitle>Command Menu</DialogTitle>
          <DialogDescription>
            Use the command menu to navigate through the app.
          </DialogDescription>
        </DialogHeader>
        <DialogContent
          className="gap-0 overflow-hidden rounded-xl border-border/50 p-0 shadow-lg sm:max-w-lg"
          showCloseButton={false}
        >
          <Command className="flex h-full w-full flex-col overflow-hidden bg-popover **:data-[slot=command-input-wrapper]:h-auto **:data-[slot=command-input-wrapper]:grow **:data-[slot=command-input-wrapper]:border-0 **:data-[slot=command-input-wrapper]:px-0">
            <div className="flex h-12 items-center gap-2 border-border/50 border-b px-4">
              <CommandInput
                className="h-10 text-[15px]"
                onValueChange={setInputValue}
                placeholder="Search reservations or type a command..."
                value={inputValue}
              />
              <button
                className="flex shrink-0 items-center"
                onClick={() => setOpen(false)}
                type="button"
              >
                <Kbd>Esc</Kbd>
              </button>
            </div>

            <CommandList className="max-h-100 py-2">
              <CommandEmpty>No results found.</CommandEmpty>

              {reservationResults.length > 0 && (
                <CommandGroup heading="Reservations">
                  {reservationResults.map((reservation) => (
                    <CommandItem
                      className="mx-2 rounded-lg py-2.5"
                      key={reservation.id}
                      onSelect={() =>
                        runAction({
                          type: "navigate",
                          href: `/dashboard/bookings/reservations?id=${reservation.id}`,
                        })
                      }
                      value={`${reservation.id} ${reservation.guestName}`}
                    >
                      <IconCalendarEvent aria-hidden />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">
                          <strong className="font-semibold">
                            {reservation.guestName}
                          </strong>
                          <span className="text-muted-foreground">
                            &nbsp;· {reservation.id}
                          </span>
                        </span>
                        <span className="truncate text-muted-foreground text-xs">
                          {reservation.roomName} · {reservation.checkInDate} →{" "}
                          {reservation.checkOutDate}
                        </span>
                      </span>
                      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs">
                        <span
                          aria-hidden
                          className={cn(
                            "size-1.5 rounded-full",
                            statusDotClasses[reservation.status]
                          )}
                        />
                        {statusLabels[reservation.status]}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {commandMenuGroups.map((group, groupIndex) => (
                <CommandGroup
                  heading={group.heading}
                  key={group.heading ?? groupIndex}
                >
                  {group.items.map((item) => {
                    const Icon = iconRegistry[item.icon] ?? IconArrowRight;
                    return (
                      <CommandItem
                        className="mx-2 rounded-lg py-2.5"
                        key={item.label}
                        keywords={item.keywords}
                        onSelect={() => runAction(item.action)}
                      >
                        <Icon aria-hidden />
                        {item.label.startsWith("Go to ") ? (
                          <span>
                            Go to&nbsp;
                            <strong className="font-semibold">
                              {item.label.slice("Go to ".length)}
                            </strong>
                          </span>
                        ) : (
                          item.label
                        )}
                        {item.shortcut && (
                          <KbdGroup className="ml-auto">
                            {item.shortcut.map((key) => (
                              <Kbd key={key}>{key}</Kbd>
                            ))}
                          </KbdGroup>
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
