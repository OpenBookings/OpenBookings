"use client";

import { useState, useTransition } from "react";
import { InfoIcon, CheckCircle2Icon, XIcon, Signature, ExternalLinkIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { RATES_TAX_INCLUSIVE_STATEMENT } from "@openbookings/authz/rates-doc";
import { HOST_AGREEMENT_TITLE, HOST_AGREEMENT_VERSION } from "@openbookings/authz/host-agreement";
import { Checkbox } from "@/components/ui/checkbox";
import { setInclusiveRatesConfirmation, signHostAgreement } from "../actions";

export interface LegalNBoringValues {
  legalCompanyName: string;
  fullName: string;
  roleTitle: string;
  vatNumber: string;
  cocNumber: string;
  /** When the Host Agreement version in force was accepted; null if it was not. */
  hostAgreementSignedAt: string | null;
  ratesInclusiveConfirmedAt: string | null;
}

const AGREEMENT_LABEL = `${HOST_AGREEMENT_TITLE} v${HOST_AGREEMENT_VERSION}`;

function AgreementLink({ href, className }: { href: string; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-1 text-ob-brand-light underline underline-offset-2 hover:text-white",
        className,
      )}
    >
      Read the {AGREEMENT_LABEL}
      <ExternalLinkIcon className="size-3.5" />
    </a>
  );
}

interface SignModalProps {
  agreementUrl: string;
  fullName: string;
  legalCompanyName: string;
  roleTitle: string;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}

function SignModal({
  agreementUrl,
  fullName,
  legalCompanyName,
  roleTitle,
  error,
  onConfirm,
  onCancel,
  isPending,
}: SignModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ob-sidebar/80 backdrop-blur-sm">
      <div className="bg-[#13161b] border border-white/10 rounded-2xl p-8 w-full max-w-md shadow-2xl flex flex-col gap-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">{AGREEMENT_LABEL}</h2>
            <p className="text-sm text-white/40 mt-1">Read the agreement, then confirm</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="text-white/30 hover:text-white/60 transition-colors"
          >
            <XIcon className="size-5" />
          </button>
        </div>

        <AgreementLink href={agreementUrl} className="text-sm" />

        <div className="rounded-lg bg-white/4 border border-white/8 p-4 flex flex-col gap-2.5 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-white/40 shrink-0">Accepting as</span>
            <span className="text-white/80 font-medium text-right">{fullName}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-white/40 shrink-0">Company</span>
            <span className="text-white/80 text-right">{legalCompanyName}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-white/40 shrink-0">Title</span>
            <span className="text-white/80 text-right">{roleTitle}</span>
          </div>
        </div>

        <p className="text-xs text-white/35 leading-relaxed">
          By selecting <strong className="text-white/55">Accept agreement</strong>, you confirm
          that you have read the {AGREEMENT_LABEL}, including the data processing agreement and
          its annexes, that you are authorised to enter into it on behalf of{" "}
          <strong className="text-white/55">{legalCompanyName}</strong>, and that{" "}
          <strong className="text-white/55">{legalCompanyName}</strong> agrees to it.
        </p>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="flex-1 h-10 rounded-lg border border-white/10 text-sm text-white/50 hover:bg-white/5 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1 h-10 rounded-lg bg-ob-brand hover:bg-ob-brand-light disabled:opacity-60 text-sm text-white font-medium transition-colors"
          >
            {isPending ? "Saving…" : "Accept agreement"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatSignedAt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function SignedModal({
  signedAt,
  agreementUrl,
  onClose,
}: {
  signedAt: string;
  agreementUrl: string | null;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ob-sidebar/80 backdrop-blur-sm">
      <div className="bg-[#13161b] border border-white/10 rounded-2xl p-8 w-full max-w-md shadow-2xl flex flex-col gap-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">{AGREEMENT_LABEL}</h2>
            <p className="text-sm text-white/40 mt-1">Your acceptance is on file</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-white/30 hover:text-white/60 transition-colors"
          >
            <XIcon className="size-5" />
          </button>
        </div>

        <div className="flex items-center gap-3 rounded-lg bg-green-500/8 border border-green-500/20 px-4 py-3.5">
          <CheckCircle2Icon className="size-5 text-green-400/70 shrink-0" />
          <span className="text-sm text-white/60">
            Accepted {AGREEMENT_LABEL} on {formatSignedAt(signedAt)}
          </span>
        </div>

        {agreementUrl && <AgreementLink href={agreementUrl} className="text-sm" />}

        <button
          type="button"
          onClick={onClose}
          className="h-10 rounded-lg border border-white/10 text-sm text-white/50 hover:bg-white/5 transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}

interface LegalNBoringStepProps {
  values: LegalNBoringValues;
  /** Where the Host Agreement text is published; null when it is not, and it cannot be accepted. */
  agreementUrl: string | null;
  onChange: (partial: Partial<LegalNBoringValues>) => void;
}

export function LegalNBoringStep({ values, agreementUrl, onChange }: LegalNBoringStepProps) {
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [showSignedModal, setShowSignedModal] = useState(false);
  const [isPending, startTransition] = useTransition();

  const anySigned = Boolean(values.hostAgreementSignedAt);

  const fieldsComplete =
    values.legalCompanyName.trim() &&
    values.fullName.trim() &&
    values.roleTitle.trim() &&
    values.vatNumber.trim();

  function handleSignClick() {
    if (!fieldsComplete || !agreementUrl) return;
    setSignError(null);
    setSigning(true);
  }

  function confirmSign() {
    startTransition(async () => {
      const result = await signHostAgreement({
        legalCompanyName: values.legalCompanyName,
        fullName: values.fullName,
        roleTitle: values.roleTitle,
        vatNumber: values.vatNumber,
        cocNumber: values.cocNumber || undefined,
      });
      if (!result.ok) {
        setSignError(result.error);
        return;
      }
      onChange({ hostAgreementSignedAt: result.signedAt });
      setSigning(false);
    });
  }

  return (
    <>
      <div className="flex flex-col gap-6 max-w-lg mx-auto">
        {/* Signer details */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-white/45 text-[11px] font-semibold uppercase tracking-[0.12em]">
              Legal Company Name <span className="text-destructive text-xl">*</span>
            </Label>
            <Input
              placeholder="e.g. Acme Hotels BV"
              value={values.legalCompanyName}
              onChange={(e) => onChange({ legalCompanyName: e.target.value })}
              disabled={anySigned}
              className={cn("text-white/80", anySigned && "opacity-50 cursor-not-allowed")}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label className="text-white/45 text-[11px] font-semibold uppercase tracking-[0.12em]">
                Full Name <span className="text-destructive text-xl">*</span>
              </Label>
              <Input
                placeholder="e.g. Jane Doe"
                value={values.fullName}
                onChange={(e) => onChange({ fullName: e.target.value })}
                disabled={anySigned}
                className={cn("text-white/80", anySigned && "opacity-50 cursor-not-allowed")}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-white/45 text-[11px] font-semibold uppercase tracking-[0.12em]">
                Role / Title <span className="text-destructive text-xl">*</span>
              </Label>
              <Input
                placeholder="e.g. Director"
                value={values.roleTitle}
                onChange={(e) => onChange({ roleTitle: e.target.value })}
                disabled={anySigned}
                className={cn("text-white/80", anySigned && "opacity-50 cursor-not-allowed")}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label className="text-white/45 text-[11px] font-semibold uppercase tracking-[0.12em]">
                VAT Number <span className="text-destructive text-xl">*</span>
              </Label>
              <Input
                placeholder="e.g. NL123456789B01"
                value={values.vatNumber}
                onChange={(e) => onChange({ vatNumber: e.target.value })}
                disabled={anySigned}
                className={cn("text-white/80", anySigned && "opacity-50 cursor-not-allowed")}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-white/45 text-[11px] font-semibold uppercase tracking-[0.12em]">
                CoC Number <span className="text-transparent text-xl">*</span>
              </Label>
              <Input
                placeholder="e.g. 12345678"
                value={values.cocNumber}
                onChange={(e) => onChange({ cocNumber: e.target.value })}
                disabled={anySigned}
                className={cn("text-white/80", anySigned && "opacity-50 cursor-not-allowed")}
              />
            </div>
          </div>
        </div>

        {/* IP notice */}
        <div className="flex gap-3 rounded-lg border border-ob-brand/20 bg-ob-brand/5 px-4 py-3">
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-ob-brand-light/70" />
          <p className="text-sm text-white/50 leading-relaxed">
            Your <span className="text-white/70 font-medium">IP address</span>, the time and the agreement version are recorded when you accept, as evidence of your acceptance. Your details can no longer be edited afterwards.
          </p>
        </div>

        {/* Inclusive rates: guests are shown the host's price as the total. */}
        <div className="flex items-start gap-3 rounded-lg border border-white/10 px-4 py-3">
          <Checkbox
            id="rates-inclusive"
            className="mt-0.5"
            checked={Boolean(values.ratesInclusiveConfirmedAt)}
            disabled={isPending}
            onCheckedChange={(value) => {
              const confirmed = value === true;
              startTransition(async () => {
                await setInclusiveRatesConfirmation(confirmed);
                onChange({ ratesInclusiveConfirmedAt: confirmed ? new Date().toISOString() : null });
              });
            }}
          />
          <Label htmlFor="rates-inclusive" className="text-sm font-normal text-white/60 leading-relaxed">
            {RATES_TAX_INCLUSIVE_STATEMENT} <span className="text-destructive">*</span>
          </Label>
        </div>

        {/* Accept CTA */}
        <div className="mt-4 flex flex-col items-center gap-3">
          {values.hostAgreementSignedAt ? (
            <button
              type="button"
              onClick={() => setShowSignedModal(true)}
              className="w-full h-14 rounded-full bg-green-500/10 border border-green-500/25 flex items-center justify-center gap-2.5 text-sm font-medium text-green-400/80 transition-colors hover:bg-green-500/15 cursor-pointer"
            >
              <CheckCircle2Icon className="size-4" />
              {AGREEMENT_LABEL} accepted
            </button>
          ) : !agreementUrl ? (
            <>
              <button
                type="button"
                disabled
                className="w-full h-14 rounded-full border flex items-center justify-center gap-2.5 text-sm font-medium bg-white/2 border-white/5 text-white/20 cursor-not-allowed"
              >
                <Signature className="size-4" />
                Accept the {HOST_AGREEMENT_TITLE}
              </button>
              <p className="text-sm text-white/45 text-center">
                The {HOST_AGREEMENT_TITLE} isn&apos;t published yet, so it can&apos;t be accepted
                yet.
              </p>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={!fieldsComplete}
                onClick={handleSignClick}
                title={!fieldsComplete ? "Fill in your details above first" : undefined}
                className={cn(
                  "w-full h-14 rounded-full border flex items-center justify-center gap-2.5 text-sm font-medium transition-colors",
                  fieldsComplete
                    ? "bg-ob-brand hover:bg-ob-brand-light border-ob-brand text-white cursor-pointer"
                    : "bg-white/2 border-white/5 text-white/20 cursor-not-allowed"
                )}
              >
                <Signature className="size-4" />
                Accept the {HOST_AGREEMENT_TITLE}
              </button>
              <AgreementLink href={agreementUrl} className="text-sm" />
            </>
          )}
        </div>
      </div>

      {signing && agreementUrl && (
        <SignModal
          agreementUrl={agreementUrl}
          fullName={values.fullName}
          legalCompanyName={values.legalCompanyName}
          roleTitle={values.roleTitle}
          error={signError}
          onConfirm={confirmSign}
          onCancel={() => setSigning(false)}
          isPending={isPending}
        />
      )}

      {showSignedModal && values.hostAgreementSignedAt && (
        <SignedModal
          signedAt={values.hostAgreementSignedAt}
          agreementUrl={agreementUrl}
          onClose={() => setShowSignedModal(false)}
        />
      )}
    </>
  );
}
