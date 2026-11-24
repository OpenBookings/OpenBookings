"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BuildingIcon,
  CircleAlert,
  Copy,
  Lock,
  PencilLine,
  Percent,
  Plug,
  Send,
  Users,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader, SectionHeader, SectionLabel } from "@/components/dashboard/page-header";
import { useEditAccess, ViewOnlyHint } from "@/components/dashboard/edit-access";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { appMoment } from "@/lib/apps/managed-view";
import { connectChannelManager, disconnectChannelManager } from "../_lib/actions";
import type { ChannelManagerData } from "../_lib/data";

/**
 * The Channel manager page (concept A10, D2–D6): one card that connects
 * SiteMinder, then walks the hotel through finishing in SiteMinder, then
 * shows four facts. Disconnect sits apart at the bottom, behind a confirm.
 */
export function ChannelManagerView({
  data,
  propertyId,
  hotelName,
}: {
  data: ChannelManagerData | null;
  propertyId: string | null;
  hotelName: string | null;
}) {
  return (
    <div className="flex flex-col gap-6 px-4 lg:px-6">
      <PageHeader
        title="Channel manager"
        description="Connect SiteMinder to run this hotel's rates and availability from there."
      />
      {!data || !propertyId ? (
        <NoProperty />
      ) : !data.connected ? (
        <ConnectCard data={data} propertyId={propertyId} />
      ) : (
        <>
          {data.lastUpdateAt === null ? <SettingUpCard data={data} /> : <ConnectedCard data={data} hotelName={hotelName} />}
          <Separator className="max-w-2xl" />
          <DisconnectSection propertyId={propertyId} />
        </>
      )}
    </div>
  );
}

const WHAT_CHANGES: { icon: LucideIcon; text: string }[] = [
  { icon: Lock, text: "Rates & availability becomes read-only. Prices, rooms to sell and restrictions come from SiteMinder." },
  { icon: Percent, text: "Pricing rules stop applying. Run promotions in SiteMinder instead." },
  { icon: Users, text: "Extra-adult and extra-child fees come from SiteMinder. Guests included, cots and extra beds stay here." },
  { icon: CircleAlert, text: "A room goes on sale once SiteMinder has sent it a price and availability." },
  { icon: Send, text: "Every booking, change and cancellation goes to SiteMinder. Each booking shows whether it arrived." },
  { icon: PencilLine, text: "Rooms, rate plans, photos and descriptions stay here, as now." },
];

function CardHead({ badge, description }: { badge: React.ReactNode; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
        <Plug className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-[15px] leading-snug">SiteMinder</h2>
          {badge}
        </div>
        <p className="mt-0.5 text-muted-foreground text-sm">{description}</p>
      </div>
    </div>
  );
}

function ConnectCard({ data, propertyId }: { data: ChannelManagerData; propertyId: string }) {
  const router = useRouter();
  const { canEdit } = useEditAccess();
  const [sendUpcoming, setSendUpcoming] = React.useState(true);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();
  const n = data.upcomingCount;

  const connect = async () => {
    if (!canEdit || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await connectChannelManager({ propertyId, sendUpcoming: n > 0 && sendUpcoming });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError("SiteMinder connection is not available right now. Try again in a few minutes.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Card className="max-w-2xl gap-5 p-5">
      <CardHead
        badge={<StatusBadge tone="neutral">Not connected</StatusBadge>}
        description="Channel manager. Sends your rates, availability and restrictions to OpenBookings, and gets every booking back."
      />
      <div className="flex flex-col gap-3">
        <SectionLabel>What changes once connected</SectionLabel>
        <ul className="flex flex-col gap-2.5">
          {WHAT_CHANGES.map(({ icon: Icon, text }) => (
            <li key={text} className="grid grid-cols-[16px_minmax(0,1fr)] gap-2.5 text-sm">
              <Icon className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </div>
      <Separator />
      {n > 0 && (
        <div className="flex items-start gap-2.5">
          <Checkbox
            id="send-upcoming"
            checked={sendUpcoming}
            disabled={!canEdit || pending}
            onCheckedChange={(v) => setSendUpcoming(v === true)}
            className="mt-0.5"
          />
          <div className="grid gap-0.5">
            <Label htmlFor="send-upcoming" className="font-medium">
              Send your {n} upcoming booking{n === 1 ? "" : "s"} to SiteMinder
            </Label>
            <p className="text-muted-foreground text-sm">
              Bookings that haven&apos;t checked out yet. Untick this if you&apos;ve already added them to SiteMinder or
              your PMS by hand. They&apos;ll be marked &ldquo;Not sent&rdquo;.
            </p>
          </div>
        </div>
      )}
      {error && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <ViewOnlyHint>
          <Button onClick={() => void connect()} disabled={!canEdit || pending}>
            {pending ? <Spinner /> : <Plug className="size-4" aria-hidden />}
            {pending ? "Connecting…" : "Connect SiteMinder"}
          </Button>
        </ViewOnlyHint>
        <span className="text-muted-foreground text-xs">You can disconnect at any time.</span>
      </div>
    </Card>
  );
}

/** The hotel code and Copy, as SiteMinder asks for it. */
function useCopyCode(code: string) {
  return async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Hotel code copied");
    } catch {
      toast.error("Could not copy. Select the code and copy it by hand.");
    }
  };
}

function CodeRow({ code }: { code: string }) {
  const copy = useCopyCode(code);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border bg-background px-3 py-2.5">
      <div>
        <p className="text-muted-foreground text-xs">Hotel code</p>
        <span className="select-all font-mono text-sm">{code}</span>
      </div>
      <Button variant="outline" size="sm" onClick={() => void copy()}>
        <Copy className="size-4" aria-hidden />
        Copy
      </Button>
    </div>
  );
}

function Step({
  n,
  title,
  description,
  badge,
  children,
}: {
  n: number;
  title: string;
  description: string;
  badge?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <li className="grid grid-cols-[24px_minmax(0,1fr)] items-start gap-2.5">
      <span
        aria-hidden
        className="flex size-6 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground text-xs"
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <span className="font-medium text-sm">{title}</span>
          {badge}
        </div>
        <p className="text-muted-foreground text-sm">{description}</p>
        {children}
      </div>
    </li>
  );
}

function connectedLine(data: ChannelManagerData): string {
  if (!data.connectedAt) return "Finish the setup in SiteMinder.";
  const { day, time } = appMoment(data.connectedAt, data.timezone);
  return `Connected ${day ? `on ${day}` : "today"} at ${time}. Finish the setup in SiteMinder.`;
}

function roomsLinkedLabel(data: ChannelManagerData): string {
  return `${data.roomsLinked} of ${data.roomsTotal} room${data.roomsTotal === 1 ? "" : "s"} linked`;
}

function SettingUpCard({ data }: { data: ChannelManagerData }) {
  const allLinked = data.roomsTotal > 0 && data.roomsLinked === data.roomsTotal;
  return (
    <Card className="max-w-2xl gap-5 p-5">
      <CardHead badge={<StatusBadge tone="attention">Waiting for SiteMinder</StatusBadge>} description={connectedLine(data)} />
      <SectionLabel>Finish in SiteMinder</SectionLabel>
      <ol className="flex flex-col gap-4">
        <Step
          n={1}
          title="Add OpenBookings as a channel"
          description="In SiteMinder, add the OpenBookings channel and enter this hotel code."
        >
          {data.propertyCode && <CodeRow code={data.propertyCode} />}
        </Step>
        <Step
          n={2}
          title="Link your rooms and rate plans"
          description="Match each room and rate plan in SiteMinder to the one here."
          badge={<StatusBadge tone={allLinked ? "positive" : "attention"}>{roomsLinkedLabel(data)}</StatusBadge>}
        />
        <Step
          n={3}
          title="First update from SiteMinder"
          description="SiteMinder sends prices and availability once rooms are linked. Each room goes on sale as its data arrives."
          badge={<StatusBadge tone="neutral">Waiting</StatusBadge>}
        />
      </ol>
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-sm first:pt-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-2 font-medium">{children}</dd>
    </div>
  );
}

function ConnectedCard({ data, hotelName }: { data: ChannelManagerData; hotelName: string | null }) {
  const copy = useCopyCode(data.propertyCode ?? "");
  const last = data.lastUpdateAt ? appMoment(data.lastUpdateAt, data.timezone) : null;
  const n = data.needsAttentionCount;
  return (
    <Card className="max-w-2xl gap-5 p-5">
      <CardHead
        badge={<StatusBadge tone="positive">Connected</StatusBadge>}
        description={`SiteMinder runs rates, availability and restrictions for ${hotelName ?? "this hotel"}.`}
      />
      <dl className="flex flex-col divide-y">
        {data.propertyCode && (
          <Fact label="Hotel code">
            <span className="select-all font-mono">{data.propertyCode}</span>
            <Button variant="ghost" size="icon-xs" aria-label="Copy hotel code" onClick={() => void copy()}>
              <Copy aria-hidden />
            </Button>
          </Fact>
        )}
        <Fact label="Rooms linked">
          {data.roomsLinked} of {data.roomsTotal}
        </Fact>
        {last && (
          <Fact label="Last update from SiteMinder">
            {last.day ?? "Today"}, {last.time}
          </Fact>
        )}
        {n > 0 && (
          <Fact label="Needs attention">
            <StatusBadge tone="attention">
              {n} booking{n === 1 ? "" : "s"}
            </StatusBadge>
          </Fact>
        )}
      </dl>
      <Separator />
      <p className="text-muted-foreground text-sm">
        While connected,{" "}
        <Link href="/dashboard/listings/rates-availability" className="text-foreground underline underline-offset-2 hover:no-underline">
          Rates &amp; availability
        </Link>{" "}
        is read-only and pricing rules don&apos;t apply.
      </p>
    </Card>
  );
}

function DisconnectSection({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const { canEdit } = useEditAccess();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [, startTransition] = React.useTransition();

  const disconnect = async () => {
    setPending(true);
    try {
      const result = await disconnectChannelManager({ propertyId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
      toast.success("SiteMinder disconnected");
      startTransition(() => router.refresh());
    } catch {
      toast.error("Could not disconnect SiteMinder right now. Try again in a few minutes.");
    } finally {
      setPending(false);
    }
  };

  return (
    <section aria-label="Disconnect SiteMinder" className="max-w-2xl">
      <SectionHeader
        title="Disconnect SiteMinder"
        description="Rates, availability and restrictions come back to you here, starting from the last values SiteMinder sent. Pricing rules apply again. New bookings are no longer sent."
        actions={
          <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
            <ViewOnlyHint>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={!canEdit}>
                  Disconnect
                </Button>
              </AlertDialogTrigger>
            </ViewOnlyHint>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect SiteMinder?</AlertDialogTitle>
                <AlertDialogDescription>
                  Rates, availability and restrictions come back to OpenBookings, starting from the last values
                  SiteMinder sent. Pricing rules apply again and new bookings are no longer sent.
                </AlertDialogDescription>
                <AlertDialogDescription>
                  Also remove OpenBookings as a channel in SiteMinder, or it keeps sending updates we&apos;ll ignore.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>Keep connected</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={pending}
                  onClick={(e) => {
                    // Stay open until the answer is in: a refusal must be readable.
                    e.preventDefault();
                    void disconnect();
                  }}
                >
                  {pending && <Spinner />}
                  Disconnect
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        }
      />
    </section>
  );
}

/** Same dead end as the other listing pages: a connection hangs off a property onboarding creates. */
function NoProperty() {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BuildingIcon />
        </EmptyMedia>
        <EmptyTitle>No listing yet</EmptyTitle>
        <EmptyDescription>
          Your property has not been set up. Finish onboarding, or contact support if you have already completed it.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <a href="/support" className="text-sm underline underline-offset-2 hover:no-underline">
          Contact support
        </a>
      </EmptyContent>
    </Empty>
  );
}
