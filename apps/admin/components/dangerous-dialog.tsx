"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DANGEROUS_ACTIONS, type DangerousAction } from "@/lib/dangerous-actions";
import type { StepUpChallenge, StepUpProof, StepUpResult } from "@/lib/step-up/step-up";
import { beginStepUp, completeStepUp } from "@/lib/step-up/step-up-actions";

const MIN_REASON = 5;
const CODE_RE = /^\d{6}$/;

type Challenge = Extract<StepUpChallenge, { ok: true }> & { beganAt: number };

/**
 * Step-ups begun in this tab and not answered yet, by action and target, so
 * closing and reopening the dialog answers the same one instead of beginning
 * another (a staff member may have at most five open). A step-up is
 * answerable for five minutes; one older than four is left to expire.
 */
const openChallenges = new Map<string, Challenge>();
const REUSE_MS = 4 * 60_000;

type Message = { text: string; enrol?: boolean };

type Props = {
  action: DangerousAction;
  /** What the step-up is bound to; the server action confirms the same id. */
  targetId: string;
  /** Exactly what will happen, with the amounts and reference on the page. */
  summary: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs the action. A message to show when it was refused, or null when it is done (the dialog closes). */
  onConfirm: (reason: string, stepUpToken: string) => Promise<string | null>;
  /**
   * Only the passkey or code step, no reason (onConfirm gets ""): for an
   * action that spends its step-up itself and writes no audit row, like
   * adding a credential on /security.
   */
  stepUpOnly?: boolean;
};

/**
 * Every dangerous action goes through this: what will happen, "Are you
 * sure?" with a reason, then a passkey or a 6-digit code. The step-up is
 * begun only on that last step (with `stepUpOnly`, the only one), when the
 * staff member continues to it.
 */
export function DangerousDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* Unmounted when closed: every opening starts at the summary. */}
      <DialogContent>
        <Steps {...props} />
      </DialogContent>
    </Dialog>
  );
}

function Steps({ action, targetId, summary, onOpenChange, onConfirm, stepUpOnly = false }: Props) {
  const key = `${action}:${targetId}`;
  const label = DANGEROUS_ACTIONS[action].label;
  const first = stepUpOnly ? "step-up" : "summary";
  const [step, setStep] = useState<"summary" | "reason" | "step-up">(first);
  /** Whether a step-up was asked for yet (the button then says "Try again"). */
  const [started, setStarted] = useState(false);
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);

  const reasonOk = reason.trim().length >= MIN_REASON;

  /** One request at a time: a second click never begins a second step-up. */
  async function work(fn: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      console.error("[admin] confirm dialog", error);
      setMessage({ text: "Something went wrong. Try again." });
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  /** The open step-up for this action and target, or a new one. */
  async function ensureChallenge() {
    const kept = openChallenges.get(key);
    if (kept && Date.now() - kept.beganAt < REUSE_MS) {
      setChallenge(kept);
      return;
    }
    openChallenges.delete(key);
    const begun = await beginStepUp(action, targetId);
    if (!begun.ok) {
      setMessage({ text: begun.message, enrol: begun.reason === "no-credentials" });
      return;
    }
    const fresh = { ...begun, beganAt: Date.now() };
    openChallenges.set(key, fresh);
    setChallenge(fresh);
  }

  const toStepUp = () =>
    work(async () => {
      setMessage(null);
      setStep("step-up");
      setStarted(true);
      await ensureChallenge();
    });

  /** Answers the step-up once; right, the action runs with its token. */
  async function answer(current: Challenge, proof: StepUpProof) {
    const result: StepUpResult = await completeStepUp(current.id, proof);
    // Throttled or a missing setting leave it unanswered; anything else spent or ended it.
    if (result.ok || result.reason === "wrong" || result.reason === "expired") {
      openChallenges.delete(key);
      setChallenge(null);
      setCode("");
    }
    if (!result.ok) {
      if (result.reason === "wrong") {
        setMessage({ text: proof.kind === "totp" ? "Wrong code, try again." : "That passkey was not accepted, try again." });
        await ensureChallenge();
      } else if (result.reason === "expired") {
        setMessage({ text: "This confirmation expired. Start again." });
        setStep(first);
      } else {
        setMessage({ text: result.message });
      }
      return;
    }
    let refused: string | null;
    try {
      refused = await onConfirm(reason.trim(), result.token);
    } catch (error) {
      console.error("[admin] dangerous action", error);
      refused = "That didn't work. Try again.";
    }
    if (refused) {
      setMessage({ text: refused });
      return;
    }
    onOpenChange(false);
  }

  const submitCode = () =>
    work(async () => {
      if (!challenge || !CODE_RE.test(code)) return;
      setMessage(null);
      await answer(challenge, { kind: "totp", code });
    });

  const answerWithPasskey = () =>
    work(async () => {
      if (!challenge?.passkeyOptions) return;
      setMessage(null);
      let response;
      try {
        response = await startAuthentication({ optionsJSON: challenge.passkeyOptions });
      } catch {
        // Closed or not available: the step-up is still unanswered, try again.
        setMessage({ text: "The passkey was not used. Try again, or enter a code." });
        return;
      }
      await answer(challenge, { kind: "passkey", response });
    });

  return (
    <>
      {step === "summary" ? (
        <>
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription className="text-foreground">{summary}</DialogDescription>
          </DialogHeader>
          <Shown message={message} />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={() => {
                setMessage(null);
                setStep("reason");
              }}
            >
              Continue
            </Button>
          </DialogFooter>
        </>
      ) : step === "reason" ? (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            // React bubbles through the portal: never submit a form the dialog sits in.
            e.preventDefault();
            e.stopPropagation();
            if (reasonOk) void toStepUp();
          }}
        >
          <DialogHeader>
            <DialogTitle>Are you sure?</DialogTitle>
            <DialogDescription className="text-foreground">{summary}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="dangerous-reason">Reason</Label>
            <Textarea
              id="dangerous-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Why, for the audit log"
            />
            <p className="text-xs text-muted-foreground">At least {MIN_REASON} characters. Kept in the audit log.</p>
          </div>
          <Shown message={message} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setStep("summary")}>
              Back
            </Button>
            <Button type="submit" disabled={!reasonOk || busy}>
              Continue
            </Button>
          </DialogFooter>
        </form>
      ) : (
        <div className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Confirm it&apos;s you</DialogTitle>
            <DialogDescription>
              Use your passkey or the 6-digit code from your authenticator app. Then this runs: {summary}
            </DialogDescription>
          </DialogHeader>

          {challenge?.passkeyOptions ? (
            <Button type="button" variant="destructive" disabled={busy} onClick={answerWithPasskey}>
              Use passkey
            </Button>
          ) : null}
          {challenge?.totp ? (
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void submitCode();
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor="dangerous-code">6-digit code</Label>
                <Input
                  id="dangerous-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus={!challenge.passkeyOptions}
                  placeholder="123456"
                  className="w-32 font-mono"
                />
              </div>
              <Button type="submit" variant="destructive" disabled={busy || !CODE_RE.test(code)}>
                Confirm
              </Button>
            </form>
          ) : null}
          {!challenge && busy ? <p className="text-sm text-muted-foreground">Preparing…</p> : null}

          <Shown message={message} />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            {!challenge && !busy ? (
              <Button type="button" onClick={toStepUp}>
                {started ? "Try again" : "Continue"}
              </Button>
            ) : null}
          </DialogFooter>
        </div>
      )}
    </>
  );
}

function Shown({ message }: { message: Message | null }) {
  if (!message) return null;
  return (
    <p className="text-sm text-destructive" role="alert">
      {message.text}
      {message.enrol ? (
        <>
          {" "}
          <Link href="/security" className="underline">
            Go to Security
          </Link>
        </>
      ) : null}
    </p>
  );
}
