"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Bug,
  Building2,
  CalendarCheck,
  CalendarRange,
  CreditCard,
  Info,
  KeyRound,
  MessageCircleQuestion,
  Send,
  X,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { findCategory, SUPPORT_CATEGORIES, SUPPORT_MESSAGE_MAX, type SupportCategory } from "@/lib/support/categories";
import { AI_COPY, TEAM_ONLY_DISCLOSURE } from "@/lib/support/copy";
import type { LinkOption } from "@/lib/support/types";
import { responseLine } from "@/lib/support/working-hours";
import { cn } from "@/lib/utils";
import { AttachButton, AttachmentChips, sendableFiles, toPicked, type PickedFile } from "./attach-files";
import { LinkedItemPicker } from "./linked-item-picker";
import { useSupport, type IntakeState } from "./support-provider";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  bookings: CalendarCheck,
  payments: CreditCard,
  availability: CalendarRange,
  listing: Building2,
  account: KeyRound,
  broken: Bug,
  other: MessageCircleQuestion,
};

function CategoryIcon({ id, className }: { id: string; className?: string }) {
  const Icon = CATEGORY_ICONS[id] ?? MessageCircleQuestion;
  return <Icon className={className} aria-hidden />;
}

type Step = 0 | 1 | 2;

const STEPS: Record<Step, { title: string; description: string }> = {
  0: { title: "What do you need help with?", description: "Pick the topic closest to your question." },
  1: { title: "Tell us more", description: "The more detail, the faster we can help." },
  2: { title: "Review and send", description: "Check everything before we start the chat." },
};

/**
 * New ticket, as a three-step dialog over the page: topic, message, review.
 * Submitting hands over to the support panel, which shows the chat; a failed
 * create comes back here on the review step with everything intact.
 */
export function NewTicketDialog() {
  const support = useSupport();
  const { intake } = support;
  // Keep the last intake rendered while the dialog animates closed.
  const [shown, setShown] = React.useState(intake);
  if (intake && intake !== shown) setShown(intake);

  return (
    <Dialog open={intake !== null} onOpenChange={(open) => (open ? null : support.closeIntake())}>
      {shown ? <IntakeContent key={shown.key} intake={shown} /> : null}
    </Dialog>
  );
}

function IntakeContent({ intake }: { intake: IntakeState }) {
  const support = useSupport();
  const reduceMotion = useReducedMotion();
  const { preset, draft, error } = intake;

  const [category, setCategory] = React.useState(draft?.category ?? preset?.category ?? "");
  const [linked, setLinked] = React.useState<LinkOption | null>(draft?.linked ?? preset?.linked ?? null);
  const [message, setMessage] = React.useState(draft?.message ?? "");
  const [files, setFiles] = React.useState<PickedFile[]>(() => toPicked(draft?.files ?? []));
  const locked = draft?.locked ?? preset?.locked ?? false;
  const followUpOf = draft?.followUpOf ?? preset?.followUpOf ?? null;

  const definition = findCategory(category);
  const tooLong = message.length > SUPPORT_MESSAGE_MAX;
  // A linked item only travels with the category that offers it.
  const linkedForCategory = definition?.linked && linked?.type === definition.linked ? linked : null;

  // A failed send reopens on review; a preset topic skips the picker.
  const [step, setStep] = React.useState<Step>(draft ? 2 : definition ? 1 : 0);
  const [direction, setDirection] = React.useState(1);
  const firstStep: Step = locked ? 1 : 0;

  const go = (next: Step) => {
    setDirection(next > step ? 1 : -1);
    setStep(next);
  };

  const pickCategory = (next: SupportCategory) => {
    setCategory(next.id);
    // Give the selection a beat to register before moving on.
    window.setTimeout(() => go(1), reduceMotion ? 0 : 160);
  };

  const canContinue = step === 0 ? Boolean(definition) : step === 1 ? Boolean(definition) && !tooLong : true;

  const submit = () => {
    if (!definition || tooLong) return;
    void support.submitTicket({
      category,
      linked: linkedForCategory,
      message,
      files: sendableFiles(files),
      followUpOf,
      locked,
    });
  };

  const onPrimary = () => {
    if (!canContinue) return;
    if (step === 2) submit();
    else go((step + 1) as Step);
  };

  // Focus follows the step: the chosen topic, the message box, the send button.
  const stepRef = React.useRef<HTMLDivElement>(null);
  const messageRef = React.useRef<HTMLTextAreaElement>(null);
  const sendRef = React.useRef<HTMLButtonElement>(null);
  // Runs once the step has slid in (it isn't mounted before that), and on open.
  const focusStep = React.useCallback(() => {
    if (step === 0) {
      const pressed = stepRef.current?.querySelector<HTMLElement>("[aria-pressed=true]");
      (pressed ?? stepRef.current?.querySelector<HTMLElement>("button"))?.focus();
    } else if (step === 1) {
      messageRef.current?.focus();
    } else {
      sendRef.current?.focus();
    }
  }, [step]);
  const focusOnOpen = React.useEffectEvent(focusStep);
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => focusOnOpen());
    return () => cancelAnimationFrame(frame);
  }, []);

  const variants = {
    enter: (dir: number) => ({ x: reduceMotion ? 0 : dir * 28, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: reduceMotion ? 0 : dir * -28, opacity: 0 }),
  };

  const { title, description } = STEPS[step];

  return (
    <DialogContent
      showCloseButton={false}
      overlayClassName="bg-black/40 backdrop-blur-md"
      // Anchored near the top, so the steps grow downwards instead of re-centring.
      className="top-[max(1rem,12dvh)] max-w-[calc(100%-1.5rem)] translate-y-0 gap-0 border-0 bg-transparent p-0 shadow-none sm:max-w-xl"
      onOpenAutoFocus={(event) => event.preventDefault()}
      onCloseAutoFocus={(event) => {
        // After a send the panel owns focus; otherwise go back to where the host was.
        event.preventDefault();
        if (!support.open) support.returnFocusRef.current?.focus();
      }}
    >
      <div className="relative w-full">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onPrimary();
          }}
          className="flex max-h-[min(42rem,calc(100dvh-max(1rem,12dvh)-1rem))] flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl"
        >
          <header className="flex flex-col gap-4 px-6 pt-5">
            <div className="flex items-center gap-3">
              <StepMeter step={step} />
              <span className="text-xs text-muted-foreground tabular-nums">Step {step + 1} of 3</span>
              <DialogClose asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Close" className="ml-auto -mr-2">
                  <X />
                </Button>
              </DialogClose>
            </div>
            <div className="flex flex-col gap-1">
              <DialogTitle className="text-lg">{followUpOf && step === 0 ? "Follow-up ticket" : title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </div>
          </header>

          <div className="relative flex-1 overflow-x-hidden overflow-y-auto px-6 py-5">
            <AnimatePresence mode="wait" initial={false} custom={direction}>
              <motion.div
                key={step}
                ref={stepRef}
                custom={direction}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                onAnimationComplete={(definition) => {
                  if (definition === "center") focusStep();
                }}
                transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
                {step === 0 ? (
                  <CategoryStep selected={category} onPick={pickCategory} />
                ) : step === 1 && definition ? (
                  <MessageStep
                    definition={definition}
                    locked={locked}
                    onChangeCategory={() => go(0)}
                    linked={linkedForCategory}
                    onLinked={setLinked}
                    message={message}
                    onMessage={setMessage}
                    tooLong={tooLong}
                    files={files}
                    onFiles={setFiles}
                    messageRef={messageRef}
                    onSubmitShortcut={onPrimary}
                  />
                ) : definition ? (
                  <ReviewStep
                    definition={definition}
                    locked={locked}
                    linked={linkedForCategory}
                    message={message}
                    files={sendableFiles(files)}
                    followUp={Boolean(followUpOf)}
                    onEdit={go}
                  />
                ) : null}
              </motion.div>
            </AnimatePresence>
          </div>

          <footer className="flex shrink-0 flex-col gap-3 border-t bg-muted/30 px-6 py-4">
            {step === 2 ? (
              <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                <p>{support.assistantEnabled ? AI_COPY.intakeDisclosure : TEAM_ONLY_DISCLOSURE}</p>
                <p>{responseLine(support.hours)}</p>
              </div>
            ) : null}
            {step === 2 && error ? <FieldError role="alert">{error}</FieldError> : null}
            <div className="flex items-center gap-2">
              {step > firstStep ? (
                <Button type="button" variant="ghost" onClick={() => go((step - 1) as Step)}>
                  <ArrowLeft />
                  Back
                </Button>
              ) : (
                <DialogClose asChild>
                  <Button type="button" variant="ghost">
                    Cancel
                  </Button>
                </DialogClose>
              )}
              <Button ref={sendRef} type="submit" disabled={!canContinue} className="ml-auto min-w-28">
                {step === 2 ? (
                  <>
                    <Send />
                    {error ? "Try again" : "Send"}
                  </>
                ) : (
                  <>
                    Continue
                    <ArrowRight />
                  </>
                )}
              </Button>
            </div>
          </footer>
        </form>
      </div>
    </DialogContent>
  );
}

function StepMeter({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-1" aria-hidden>
      {([0, 1, 2] as const).map((i) => (
        <span
          key={i}
          className={cn(
            "h-1 rounded-full transition-all duration-300",
            i < step ? "w-5 bg-primary/60" : i === step ? "w-8 bg-primary" : "w-5 bg-muted-foreground/25",
          )}
        />
      ))}
    </div>
  );
}

function CategoryStep({ selected, onPick }: { selected: string; onPick: (category: SupportCategory) => void }) {
  const odd = SUPPORT_CATEGORIES.length % 2 === 1;
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="Topic">
      {SUPPORT_CATEGORIES.map((c, i) => {
        const active = c.id === selected;
        return (
          <motion.button
            key={c.id}
            type="button"
            aria-pressed={active}
            onClick={() => onPick(c)}
            whileTap={{ scale: 0.97 }}
            className={cn(
              "group flex items-center gap-3 rounded-lg border bg-background/40 p-3 text-left transition-colors outline-none",
              "hover:border-muted-foreground/40 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
              active && "border-primary/70 bg-primary/10 hover:border-primary/70 hover:bg-primary/10",
              odd && i === SUPPORT_CATEGORIES.length - 1 && "sm:col-span-2",
            )}
          >
            <span
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors",
                "group-hover:text-foreground",
                active && "bg-primary text-primary-foreground group-hover:text-primary-foreground",
              )}
            >
              <CategoryIcon id={c.id} className="size-4.5" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-medium">{c.label}</span>
              <span className="truncate text-xs text-muted-foreground">{c.blurb}</span>
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

function TopicChip({ definition }: { definition: SupportCategory }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm font-medium">
      <span className="flex size-6 items-center justify-center rounded-md bg-primary/15 text-primary">
        <CategoryIcon id={definition.id} className="size-3.5" />
      </span>
      {definition.label}
    </span>
  );
}

function MessageStep({
  definition,
  locked,
  onChangeCategory,
  linked,
  onLinked,
  message,
  onMessage,
  tooLong,
  files,
  onFiles,
  messageRef,
  onSubmitShortcut,
}: {
  definition: SupportCategory;
  locked: boolean;
  onChangeCategory: () => void;
  linked: LinkOption | null;
  onLinked: (value: LinkOption | null) => void;
  message: string;
  onMessage: (value: string) => void;
  tooLong: boolean;
  files: PickedFile[];
  onFiles: (files: PickedFile[]) => void;
  messageRef: React.RefObject<HTMLTextAreaElement | null>;
  onSubmitShortcut: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <TopicChip definition={definition} />
        {locked ? null : (
          <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={onChangeCategory}>
            Change topic
          </Button>
        )}
      </div>

      <Alert className="border-dashed bg-muted/40 py-2 text-xs">
        <Info />
        <AlertDescription className="text-xs">{definition.hint}</AlertDescription>
      </Alert>

      {definition.linked ? (
        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor="support-linked">
            {definition.linked === "booking" ? "Which booking?" : "Which listing?"}
          </FieldLabel>
          <LinkedItemPicker id="support-linked" kind={definition.linked} value={linked} onChange={onLinked} locked={locked} />
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <FieldLabel htmlFor="support-message">Message</FieldLabel>
        <Textarea
          id="support-message"
          ref={messageRef}
          value={message}
          onChange={(event) => onMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onSubmitShortcut();
            }
          }}
          placeholder={definition.placeholder}
          className="max-h-56 min-h-32 resize-none"
          aria-invalid={tooLong || undefined}
          aria-describedby="support-message-count"
        />
        <div className="flex items-center gap-2">
          <AttachButton files={files} onChange={onFiles} variant="outline" />
          <span
            id="support-message-count"
            className={cn("ml-auto text-xs tabular-nums", tooLong ? "text-destructive" : "text-muted-foreground")}
            aria-live="polite"
          >
            {message.length > SUPPORT_MESSAGE_MAX * 0.9 ? `${message.length}/${SUPPORT_MESSAGE_MAX}` : ""}
          </span>
        </div>
        <AttachmentChips files={files} onRemove={(id) => onFiles(files.filter((f) => f.id !== id))} />
      </div>
    </div>
  );
}

function ReviewRow({
  label,
  onEdit,
  children,
}: {
  label: string;
  onEdit?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 px-4 py-3">
      <dt className="w-24 shrink-0 pt-0.5 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm">{children}</dd>
      {onEdit ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-my-1 h-7 px-2 text-xs text-muted-foreground"
          onClick={onEdit}
          aria-label={`Edit ${label.toLowerCase()}`}
        >
          Edit
        </Button>
      ) : null}
    </div>
  );
}

function ReviewStep({
  definition,
  locked,
  linked,
  message,
  files,
  followUp,
  onEdit,
}: {
  definition: SupportCategory;
  locked: boolean;
  linked: LinkOption | null;
  message: string;
  files: File[];
  followUp: boolean;
  onEdit: (step: Step) => void;
}) {
  const trimmed = message.trim();
  return (
    <div className="flex flex-col gap-3">
      {followUp ? <p className="text-xs text-muted-foreground">Follow-up to an earlier ticket.</p> : null}
      <dl className="flex flex-col divide-y rounded-lg border bg-background/40">
        <ReviewRow label="Topic" onEdit={locked ? undefined : () => onEdit(0)}>
          <TopicChip definition={definition} />
        </ReviewRow>
        {definition.linked ? (
          <ReviewRow
            label={definition.linked === "booking" ? "Booking" : "Listing"}
            onEdit={locked ? undefined : () => onEdit(1)}
          >
            {linked ? (
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{linked.label}</span>
                {linked.detail ? <span className="truncate text-xs text-muted-foreground">{linked.detail}</span> : null}
              </span>
            ) : (
              <span className="text-muted-foreground">None selected</span>
            )}
          </ReviewRow>
        ) : null}
        <ReviewRow label="Message" onEdit={() => onEdit(1)}>
          {trimmed ? (
            <p className="line-clamp-6 whitespace-pre-wrap break-words">{trimmed}</p>
          ) : (
            <span className="text-muted-foreground">No message. We&apos;ll start from the topic above.</span>
          )}
        </ReviewRow>
        {files.length > 0 ? (
          <ReviewRow label="Attachments" onEdit={() => onEdit(1)}>
            <ul className="flex flex-col gap-0.5">
              {files.map((file, i) => (
                <li key={`${file.name}-${i}`} className="truncate">
                  {file.name}
                </li>
              ))}
            </ul>
          </ReviewRow>
        ) : null}
      </dl>
    </div>
  );
}
