"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { toast } from "sonner";
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
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PendingButton } from "../../_components/pending-button";
import { saveDetails, type SaveState } from "../_lib/actions";
import { Field, INPUT, NativeSelect, PhoneField, Required, type DialCode } from "./fields";
import type { Address } from "../_lib/validate";

const IDLE: SaveState = { status: "idle" };

/** Every field, in page order: the first one with an error gets focus. */
const FIELDS = ["name", "phone", "phoneCountry", "line1", "line2", "postalCode", "city", "country"] as const;
const ADDRESS_FIELDS = ["line1", "line2", "postalCode", "city", "country"] as const;

function values(form: HTMLFormElement): Record<string, string> {
  const data = new FormData(form);
  const now = Object.fromEntries(FIELDS.map((f) => [f, String(data.get(f) ?? "").trim()]));
  // Picking a country for an empty number changes nothing worth saving.
  if (!now.phone) now.phoneCountry = "";
  return now;
}

const snapshot = (form: HTMLFormElement) => JSON.stringify(values(form));

/** A titled card of fields. The rows of cards share the page's one form. */
function DetailsCard({
  id,
  title,
  required = false,
  children,
}: {
  id: string;
  title: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card aria-labelledby={id} role="group" className="gap-4 px-5 py-5 sm:px-6">
      <h2 id={id} className="text-sm font-semibold">
        {title}
        {required ? <Required /> : null}
      </h2>
      {children}
    </Card>
  );
}

/**
 * Warns before unsaved edits are lost: the browser's own prompt for a reload
 * or closed tab, and a dialog for links inside the app (Next's client-side
 * navigation never fires `beforeunload`). The browser's back button is not
 * caught; the App Router has no hook for it.
 */
function useLeaveGuard(dirty: boolean) {
  const router = useRouter();
  const [pendingHref, setPendingHref] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    // Capture phase on document runs before Next's <Link> handler, which skips prevented clicks.
    const intercept = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingHref(url.pathname + url.search + url.hash);
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", intercept, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", intercept, true);
    };
  }, [dirty]);

  const dialog = (
    <AlertDialog open={pendingHref !== null} onOpenChange={(open) => !open && setPendingHref(null)}>
      <AlertDialogContent className="console bg-card text-foreground">
        <AlertDialogHeader>
          <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
          <AlertDialogDescription>Your changes to your personal details will be lost.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (pendingHref) router.push(pendingHref);
              setPendingHref(null);
            }}
          >
            Leave
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return dialog;
}

/**
 * The whole page is one form with one Save. Fields stay uncontrolled; "dirty"
 * compares what's in the form with what was last saved. Submitting goes
 * through onSubmit rather than `<form action>`, so React doesn't reset the
 * fields when a save comes back with errors.
 *
 * `countries` and `dialCodes` come from the server: Node's and the browser's ICU name some
 * countries differently, so building the list here would break hydration.
 */
export function PersonalDetailsForm({
  name,
  phone,
  address,
  countries,
  dialCodes,
}: {
  name: string;
  /** Split for the form by `splitPhone`. */
  phone: { country: string; number: string };
  address: Address | null;
  countries: { code: string; name: string }[];
  dialCodes: DialCode[];
}) {
  const [state, dispatch, pending] = useActionState(saveDetails, IDLE);
  const formRef = React.useRef<HTMLFormElement>(null);
  const saved = React.useRef<string>("");
  const submitted = React.useRef<string>("");
  const [dirty, setDirty] = React.useState(false);
  // An address is all or nothing: its fields turn required once any of them has a value.
  const [addressStarted, setAddressStarted] = React.useState(address !== null);

  React.useEffect(() => {
    if (formRef.current) saved.current = snapshot(formRef.current);
  }, []);

  function sync() {
    const form = formRef.current;
    if (!form) return;
    const now = values(form);
    setDirty(JSON.stringify(now) !== saved.current);
    setAddressStarted(ADDRESS_FIELDS.some((f) => now[f] !== ""));
  }

  const shown = React.useRef<SaveState>(IDLE);
  React.useEffect(() => {
    if (state === shown.current) return;
    shown.current = state;
    if (state.status === "saved") {
      saved.current = submitted.current;
      sync();
      toast.success("Personal details saved");
    } else if (state.status === "error") {
      if (state.message) toast.error(state.message);
      const first = FIELDS.find((f) => state.errors?.[f]);
      if (first) document.getElementById(first)?.focus();
    }
  }, [state]);

  const leaveDialog = useLeaveGuard(dirty);
  const errors = state.errors ?? {};

  return (
    <form
      ref={formRef}
      noValidate
      onInput={sync}
      onChange={sync}
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        submitted.current = snapshot(form);
        const data = new FormData(form);
        React.startTransition(() => dispatch(data));
      }}
      className="flex flex-col gap-4"
    >
      <DetailsCard id="details-name" title="Name" required>
        <Field id="name" label="Full name" labelHidden error={errors.name}>
          <Input id="name" name="name" defaultValue={name} autoComplete="name" maxLength={100} required className={INPUT} />
        </Field>
      </DetailsCard>

      <DetailsCard id="details-phone" title="Phone number">
        <PhoneField country={phone.country} number={phone.number} dialCodes={dialCodes} error={errors.phone} />
      </DetailsCard>

      <DetailsCard id="details-address" title="Address">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Field id="line1" label="Street and number" required={addressStarted} error={errors.line1}>
            <Input id="line1" name="line1" defaultValue={address?.line1 ?? ""} autoComplete="address-line1" maxLength={200} required={addressStarted} className={INPUT} />
          </Field>
          <Field id="line2" label="Apartment or floor" error={errors.line2}>
            <Input id="line2" name="line2" defaultValue={address?.line2 ?? ""} autoComplete="address-line2" maxLength={200} className={INPUT} />
          </Field>
        </div>
        <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-3 sm:grid-cols-[minmax(0,7rem)_minmax(0,1fr)_minmax(0,1fr)]">
          <Field id="postalCode" label="Postcode" required={addressStarted} error={errors.postalCode}>
            <Input id="postalCode" name="postalCode" defaultValue={address?.postalCode ?? ""} autoComplete="postal-code" maxLength={20} required={addressStarted} className={INPUT} />
          </Field>
          <Field id="city" label="City" required={addressStarted} error={errors.city}>
            <Input id="city" name="city" defaultValue={address?.city ?? ""} autoComplete="address-level2" maxLength={100} required={addressStarted} className={INPUT} />
          </Field>
          <Field id="country" label="Country" required={addressStarted} error={errors.country} className="col-span-2 sm:col-span-1">
            <NativeSelect
              id="country"
              name="country"
              defaultValue={address?.country ?? ""}
              autoComplete="country"
              required={addressStarted}
            >
              <option value="">Choose a country</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
      </DetailsCard>

      <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
        <p className="flex max-w-[46ch] items-center gap-2 text-[13px] text-muted-foreground">
          <Lock aria-hidden className="size-3.5 shrink-0" />
          <span>
            Only the properties you book see these details.{" "}
            <br />
            Please read our{" "}
            <Link href="/legal/en/privacy" className="text-foreground underline underline-offset-2">
              privacy policy
            </Link>
            {" "}for more information.
          </span>
        </p>
        <PendingButton type="submit" disabled={!dirty} pending={pending} className="w-full px-5 sm:w-auto">
          Save changes
        </PendingButton>
      </div>
      {leaveDialog}
    </form>
  );
}
