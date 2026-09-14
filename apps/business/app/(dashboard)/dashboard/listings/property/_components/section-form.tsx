"use client";

import * as React from "react";
import Form from "next/form";
import { toast } from "sonner";
import { AlertCircleIcon } from "lucide-react";
import posthog from "posthog-js";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { FormState } from "../_lib/types";

interface SectionFormProps<T> {
  /** Used for the heading, the toast, and the posthog event's `section` property. */
  sectionId: string;
  title: string;
  description: string;
  propertyId: string;
  initialValues: T;
  action: (prev: FormState<T>, formData: FormData) => Promise<FormState<T>>;
  onDirtyChange?: (dirty: boolean) => void;
  children: (state: FormState<T>, pending: boolean) => React.ReactNode;
}

/**
 * The machinery every section shares: action wiring, the error summary, focus
 * management, the save bar, and the success toast.
 *
 * Sections own their fields and nothing else. That keeps six near-identical
 * components from drifting apart, which is the failure mode this wrapper exists
 * to prevent.
 */
export function SectionForm<T>({
  sectionId,
  title,
  description,
  propertyId,
  initialValues,
  action,
  onDirtyChange,
  children,
}: SectionFormProps<T>) {
  const [state, formAction, pending] = React.useActionState(action, {
    values: initialValues,
    errors: null,
    success: false,
  });
  const [dirty, setDirty] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  const errorEntries = Object.entries(state.errors ?? {}).filter(
    ([, messages]) => (messages?.length ?? 0) > 0,
  );

  React.useEffect(() => {
    if (!state.success) return;
    setDirty(false);
    onDirtyChange?.(false);
    toast.success("Saved", { description: `${title} is up to date.` });
    posthog.capture("property_section_saved", { section: sectionId });
  }, [state.success, sectionId, title, onDirtyChange]);

  // Guide the host to the first problem rather than making them hunt for the
  // red outline. Focus, not just scroll: it also announces to a screen reader.
  React.useEffect(() => {
    if (errorEntries.length === 0) return;
    const first = errorEntries[0][0];
    const el = formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [state.errors]);

  function focusField(name: string) {
    const el = formRef.current?.querySelector<HTMLElement>(`[name="${name}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function markDirty() {
    if (dirty) return;
    setDirty(true);
    onDirtyChange?.(true);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-6 py-5">
        <h2 className="font-medium text-lg">{title}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>

      <Form
        ref={formRef}
        action={formAction}
        id={`section-${sectionId}`}
        onChange={markDirty}
        className="flex-1 overflow-y-auto px-6 py-6"
      >
        <input type="hidden" name="propertyId" value={propertyId} />

        {errorEntries.length > 0 && (
          <Alert variant="destructive" role="alert" className="mb-6">
            <AlertCircleIcon />
            <AlertTitle>
              {errorEntries.length === 1
                ? "One field needs your attention"
                : `${errorEntries.length} fields need your attention`}
            </AlertTitle>
            <AlertDescription>
              <ul className="flex flex-col gap-1">
                {errorEntries.map(([name, messages]) => (
                  <li key={name}>
                    <button
                      type="button"
                      onClick={() => focusField(name)}
                      className="text-left underline underline-offset-2 hover:no-underline"
                    >
                      {messages![0]}
                    </button>
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {children(state, pending)}
      </Form>

      <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {dirty ? "Unsaved changes" : "All changes saved"}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="reset"
            variant="ghost"
            size="sm"
            form={`section-${sectionId}`}
            disabled={pending || !dirty}
            onClick={() => {
              setDirty(false);
              onDirtyChange?.(false);
            }}
          >
            Discard
          </Button>
          <Button type="submit" size="sm" form={`section-${sectionId}`} disabled={pending}>
            {pending && <Spinner />}
            Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}
