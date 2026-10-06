"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import posthog from "posthog-js";
import {
  ArchiveIcon,
  ArrowRightIcon,
  CircleAlertIcon,
  CopyIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { archiveRate, duplicateRate, setRateActive } from "../../_lib/actions";
import { cancellationPreview, conditionsSummary, includesSummary } from "../../_lib/derive";
import type { RatePlanRecord } from "../../_lib/types";
import { RateSheet } from "../rate-sheet";
import type { RoomSectionProps } from "./props";

/**
 * The rates sold on this room. Each rate saves from its own Sheet, so this
 * section has no footer. The Sheet is addressed by `?rate=<id>` or
 * `?rate=new`, which makes it linkable and lets it survive a refresh.
 */
export function RatesSection({ data }: RoomSectionProps) {
  const { room, rates, property } = data;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [notice, setNotice] = React.useState<string | null>(null);
  const [togglingId, setTogglingId] = React.useState<string | null>(null);
  const [archiving, setArchiving] = React.useState<RatePlanRecord | null>(null);

  const rateParam = searchParams.get("rate");
  const sheetRate = rateParam && rateParam !== "new" ? rates.find((r) => r.id === rateParam) ?? null : null;
  // An id that is not one of this room's live rates (archived, another
  // room's, made up) opens nothing rather than an empty form.
  const sheetOpen = rateParam === "new" || sheetRate !== null;

  const pricingHref = `/dashboard/listings/rates-availability?property=${property.id}`;

  function setRateParam(value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("rate", value);
    else params.delete("rate");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  async function toggle(rate: RatePlanRecord, active: boolean) {
    setTogglingId(rate.id);
    setNotice(null);
    const result = await setRateActive(room.id, rate.id, active);
    setTogglingId(null);
    if (!result.ok) {
      // Explained inline, not just toasted: it is a rule, not a glitch.
      setNotice(result.error);
      return;
    }
    posthog.capture(active ? "rate_activated" : "rate_deactivated");
    router.refresh();
  }

  async function duplicate(rate: RatePlanRecord) {
    const result = await duplicateRate(room.id, rate.id);
    if (!result.ok) {
      toast.error("Not duplicated", { description: result.error });
      return;
    }
    posthog.capture("rate_duplicated");
    toast.success("Rate duplicated", { description: "The copy is switched off until you review it." });
    router.refresh();
  }

  const activeCount = rates.filter((r) => r.active).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-6 py-5">
        <h2 className="font-medium text-lg">Rates</h2>
        <p className="text-muted-foreground text-sm">
          What guests can book on this room, and on what terms. Each rate saves on its own.
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-6">
        {activeCount === 0 && (
          <Alert role="alert">
            <CircleAlertIcon />
            <AlertTitle>This section is not finished</AlertTitle>
            <AlertDescription>
              A room needs at least one active rate before it can be published. A rate can be
              switched on once it has a price in Rates &amp; Availability.
            </AlertDescription>
          </Alert>
        )}

        {notice && (
          <Alert variant="destructive" role="alert">
            <CircleAlertIcon />
            <AlertTitle>That change was not made</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={pricingHref}
            className="inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
          >
            Pricing is set in R&amp;A
            <ArrowRightIcon className="size-3.5" aria-hidden />
          </Link>
          <Button size="sm" onClick={() => setRateParam("new")}>
            <PlusIcon />
            Add rate
          </Button>
        </div>

        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Includes</TableHead>
                <TableHead>Conditions</TableHead>
                <TableHead>Cancellation</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No rates yet. Add one to start selling this room.
                  </TableCell>
                </TableRow>
              ) : (
                rates.map((rate) => {
                  const policy = cancellationPreview(rate.cancellationText);
                  // Switching on needs a price; switching off is always offered
                  // and the server explains if it is refused.
                  const lockedOff = !rate.active && !rate.priced;
                  const statusSwitch = (
                    <Switch
                      checked={rate.active}
                      disabled={togglingId === rate.id || lockedOff}
                      onCheckedChange={(c) => toggle(rate, c)}
                      aria-label={`${rate.name} active`}
                    />
                  );
                  return (
                    <TableRow key={rate.id}>
                      <TableCell className="max-w-48">
                        <button
                          type="button"
                          onClick={() => setRateParam(rate.id)}
                          className="block max-w-full truncate rounded-sm text-left font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                          {rate.name}
                        </button>
                        {!rate.priced && (
                          <Badge variant="outline" className="mt-1">
                            No price yet
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-48 truncate text-sm">{includesSummary(rate)}</TableCell>
                      <TableCell className="text-sm">
                        {conditionsSummary(rate.minAdvanceDays, rate.maxAdvanceDays)}
                      </TableCell>
                      <TableCell className="max-w-56 truncate text-sm">
                        {policy ?? <span className="text-muted-foreground">Not set</span>}
                      </TableCell>
                      <TableCell>
                        {lockedOff ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">{statusSwitch}</span>
                            </TooltipTrigger>
                            <TooltipContent>Set a price in R&amp;A first</TooltipContent>
                          </Tooltip>
                        ) : (
                          statusSwitch
                        )}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${rate.name}`}>
                              <MoreHorizontalIcon />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setRateParam(rate.id)}>
                              <PencilIcon />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void duplicate(rate)}>
                              <CopyIcon />
                              Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={() => setArchiving(rate)}>
                              <ArchiveIcon />
                              Archive
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <RateSheet
        open={sheetOpen}
        rate={sheetRate}
        roomId={room.id}
        roomName={room.name}
        pricingHref={pricingHref}
        onClose={() => setRateParam(null)}
      />

      <ArchiveRateDialog
        roomId={room.id}
        rate={archiving}
        onClose={() => setArchiving(null)}
        onDeactivate={(rate) => toggle(rate, false)}
      />
    </div>
  );
}

/**
 * Archive is a soft delete, refused while bookings still hold the rate. The
 * refusal offers the alternative that is always safe: switch it off, which
 * stops new bookings and leaves existing ones alone.
 */
function ArchiveRateDialog({
  roomId,
  rate,
  onClose,
  onDeactivate,
}: {
  roomId: string;
  rate: RatePlanRecord | null;
  onClose: () => void;
  onDeactivate: (rate: RatePlanRecord) => Promise<void>;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [blocked, setBlocked] = React.useState<{ message: string; offerOff: boolean } | null>(null);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (rate) setBlocked(null);
  }, [rate]);

  async function archive() {
    if (!rate) return;
    setPending(true);
    const result = await archiveRate(roomId, rate.id);
    setPending(false);
    if (!result.ok) {
      setBlocked({
        message: result.error,
        offerOff: result.code === "future_bookings" && rate.active,
      });
      return;
    }
    posthog.capture("rate_archived");
    toast.success("Rate archived", { description: `${rate.name} is no longer offered.` });
    onClose();
    router.refresh();
  }

  return (
    <AlertDialog open={rate !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {blocked ? "This rate cannot be archived yet" : `Archive ${rate?.name ?? "this rate"}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {blocked?.message ??
              "Guests will no longer be offered it, and it leaves Rates & Availability. Past bookings keep it on record."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{blocked ? "Close" : "Cancel"}</AlertDialogCancel>
          {!blocked && (
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                void archive();
              }}
            >
              {pending && <Spinner />}
              Archive
            </AlertDialogAction>
          )}
          {blocked?.offerOff && rate && (
            <AlertDialogAction
              disabled={pending}
              onClick={async (e) => {
                e.preventDefault();
                setPending(true);
                await onDeactivate(rate);
                setPending(false);
                onClose();
              }}
            >
              {pending && <Spinner />}
              Switch off instead
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
