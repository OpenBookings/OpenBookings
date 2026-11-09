"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { examplePhone, flag } from "../_lib/phone";

/**
 * The personal details fields, shared by the account page and checkout's
 * details card so both look and validate the same.
 */

export function Required() {
  return (
    <span aria-hidden className="ml-0.5 text-(--red-11)">
      *
    </span>
  );
}

export function Field({
  id,
  label,
  labelHidden = false,
  required = false,
  error,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  /** For a card's only field: the card title already names it on screen. */
  labelHidden?: boolean;
  /** Shows the red asterisk; the input itself carries `required`. */
  required?: boolean;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactElement<{ "aria-invalid"?: boolean; "aria-describedby"?: string }>;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={id} className={cn("gap-0 text-[13px] font-normal text-muted-foreground", labelHidden && "sr-only")}>
        {label}
        {required && !labelHidden ? <Required /> : null}
      </Label>
      {React.cloneElement(children, { "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {error ? (
        <p id={`${id}-error`} className="text-[13px] text-(--red-11)">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[13px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const INPUT = "h-10";

/**
 * A native select (keeps autofill and plain form data) with our own chevron:
 * the browser's arrow sits too close to the right edge. Props go to the
 * <select>, so Field's aria attributes land on the control.
 */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative min-w-0">
      <select
        {...props}
        className={cn(
          "h-10 w-full min-w-0 appearance-none rounded-md border border-input bg-input/30 pr-9 pl-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive",
          className,
        )}
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

export type DialCode = { code: string; name: string; dial: string };

/**
 * Country picker and number side by side. The picker is a native select laid
 * invisibly over a flag-and-code label: the closed state stays compact, the
 * open list is the platform's own (searchable by typing a country name).
 */
export function PhoneField({
  country: initialCountry,
  number,
  dialCodes,
  error,
  showLabel = false,
  required = false,
}: {
  country: string;
  number: string;
  dialCodes: DialCode[];
  error?: string;
  /** The account page's card title names the field; elsewhere the label shows. */
  showLabel?: boolean;
  /** Shows the red asterisk on a visible label, and marks the input required. */
  required?: boolean;
}) {
  const [country, setCountry] = React.useState(initialCountry);
  const dial = dialCodes.find((c) => c.code === country)?.dial ?? "";
  const placeholder = React.useMemo(() => examplePhone(country), [country]);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label
        htmlFor="phone"
        className={cn(showLabel ? "gap-0 text-[13px] font-normal text-muted-foreground" : "sr-only")}
      >
        Phone number
        {required && showLabel ? <Required /> : null}
      </Label>
      <div className="flex gap-2">
        <div className="relative h-10 shrink-0 rounded-md border border-input bg-input/30 shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
          <span aria-hidden className="flex h-full items-center gap-2 pr-9 pl-3 text-sm tabular-nums">
            <span className="text-base leading-none">{flag(country)}</span>+{dial}
          </span>
          <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <select
            id="phoneCountry"
            name="phoneCountry"
            aria-label="Country code"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="absolute inset-0 w-full cursor-pointer appearance-none opacity-0"
          >
            {dialCodes.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} +{c.dial}
              </option>
            ))}
          </select>
        </div>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          defaultValue={number}
          autoComplete="tel-national"
          placeholder={placeholder}
          maxLength={24}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "phone-error" : undefined}
          className={cn(INPUT, "min-w-0 flex-1")}
        />
      </div>
      {error ? (
        <p id="phone-error" className="text-[13px] text-(--red-11)">
          {error}
        </p>
      ) : null}
    </div>
  );
}
