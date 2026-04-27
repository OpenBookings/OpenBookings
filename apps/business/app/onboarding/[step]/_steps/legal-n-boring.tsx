"use client";

import { useState, useTransition } from "react";
import { InfoIcon, CheckCircle2Icon, XIcon, Signature, Download } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { signLegalDocument, downloadLegalDocument } from "../../actions";

export interface LegalNBoringValues {
  legalCompanyName: string;
  fullName: string;
  roleTitle: string;
  partnerAgreementSignedAt: string | null;
  dpaSignedAt: string | null;
}

const DOCUMENTS = [
  { id: "partner-agreement" as const, label: "Partner Agreement" },
  { id: "dpa" as const, label: "Data Processing Agreement" },
];

type DocumentId = (typeof DOCUMENTS)[number]["id"];

interface SignModalProps {
  doc: (typeof DOCUMENTS)[number];
  fullName: string;
  legalCompanyName: string;
  roleTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}

function SignModal({
  doc,
  fullName,
  legalCompanyName,
  roleTitle,
  onConfirm,
  onCancel,
  isPending,
}: SignModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#13161b] border border-white/10 rounded-2xl p-8 w-full max-w-md shadow-2xl flex flex-col gap-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">{doc.label}</h2>
            <p className="text-sm text-white/40 mt-1">Review and confirm your signature</p>
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

        <div className="rounded-lg bg-white/4 border border-white/8 p-4 flex flex-col gap-2.5 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-white/40 shrink-0">Signing as</span>
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
          By clicking <strong className="text-white/55">Sign Document</strong>, you confirm that
          you are authorized to enter into this agreement on behalf of{" "}
          <strong className="text-white/55">{legalCompanyName}</strong> and you agree to the
          terms set out in the {doc.label}.
        </p>

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
            className="flex-1 h-10 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-sm text-white font-medium transition-colors"
          >
            {isPending ? "Signing…" : "Sign Document"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface LegalNBoringStepProps {
  values: LegalNBoringValues;
  onChange: (partial: Partial<LegalNBoringValues>) => void;
}

export function LegalNBoringStep({ values, onChange }: LegalNBoringStepProps) {
  const [signingDoc, setSigningDoc] = useState<DocumentId | null>(null);
  const [isPending, startTransition] = useTransition();
  const [downloadingDoc, setDownloadingDoc] = useState<DocumentId | null>(null);

  function handleDownload(docId: DocumentId) {
    setDownloadingDoc(docId);
    startTransition(async () => {
      try {
        const bytes = await downloadLegalDocument(docId);
        const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${docId}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      } finally {
        setDownloadingDoc(null);
      }
    });
  }

  const anySigned = Boolean(values.partnerAgreementSignedAt || values.dpaSignedAt);

  const fieldsComplete =
    values.legalCompanyName.trim() && values.fullName.trim() && values.roleTitle.trim();

  function handleSignClick(docId: DocumentId) {
    if (!fieldsComplete) return;
    setSigningDoc(docId);
  }

  function confirmSign() {
    if (!signingDoc) return;
    startTransition(async () => {
      await signLegalDocument(signingDoc, {
        legalCompanyName: values.legalCompanyName,
        fullName: values.fullName,
        roleTitle: values.roleTitle,
      });
      const key =
        signingDoc === "partner-agreement" ? "partnerAgreementSignedAt" : "dpaSignedAt";
      onChange({ [key]: new Date().toISOString() });
      setSigningDoc(null);
    });
  }

  const activeDoc = DOCUMENTS.find((d) => d.id === signingDoc);

  return (
    <>
      <div className="flex flex-col gap-6 max-w-lg">
        {/* Signer details */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-white/70 text-xs font-medium uppercase tracking-wide">
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
              <Label className="text-white/70 text-xs font-medium uppercase tracking-wide">
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
              <Label className="text-white/70 text-xs font-medium uppercase tracking-wide">
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
        </div>

        {/* IP notice */}
        <div className="flex gap-3 rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3">
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-blue-400/70" />
          <p className="text-sm text-white/50 leading-relaxed">
            Your <span className="text-white/70 font-medium">IP address</span> will be captured
            at the time of signature and stored as part of the legally binding record.
          </p>
        </div>

        <div className="h-4" />


        {/* Documents */}
        <div className="flex flex-col gap-3">
          <Label className="text-white/70 text-xs font-medium uppercase tracking-wide">
            Documents to Sign
            <span className="text-destructive ml-0.5 text-xl">*</span>
          </Label>

          {DOCUMENTS.map((doc) => {
            const signedAt =
              doc.id === "partner-agreement"
                ? values.partnerAgreementSignedAt
                : values.dpaSignedAt;
            const isSigned = Boolean(signedAt);

            return (
              <div key={doc.id} className="flex items-center gap-3">
                {/* Document pill */}
                <div
                  className={cn(
                    "flex-1 flex items-center px-5 h-14 rounded-full border transition-colors",
                    isSigned
                      ? "bg-green-500/8 border-green-500/25"
                      : "bg-white/4 border-white/8"
                  )}
                >
                  <span
                    className={cn(
                      "text-sm font-large font-bold",
                      isSigned ? "text-white/80" : "text-white/70"
                    )}
                  >
                    {doc.label}
                  </span>
                  {isSigned && (
                    <span className="ml-auto flex items-center gap-1.5 text-xs text-green-400/70">
                      <CheckCircle2Icon className="size-3.5" />
                      Signed
                    </span>
                  )}
                </div>

                {/* Sign button */}
                {isSigned ? (
                  <button
                    type="button"
                    title="Download signed document"
                    disabled={downloadingDoc === doc.id || isPending}
                    onClick={() => handleDownload(doc.id)}
                    className={cn(
                      "size-14 rounded-full border flex items-center justify-center transition-colors shrink-0",
                      "bg-blue-500/10 border-blue-500/25 text-blue-400/50 font-bold cursor-pointer disabled:opacity-50"
                    )}
                  >
                    <Download className="size-[18px]" />
                  </button>
                ) : (
                  <button
                    type="button"
                    title={
                      !fieldsComplete
                        ? "Fill in your details above first"
                        : "Sign document"
                    }
                    disabled={!fieldsComplete}
                    onClick={() => handleSignClick(doc.id)}
                    className={cn(
                      "size-14 rounded-full border flex items-center justify-center transition-colors shrink-0",
                      fieldsComplete
                        ? "bg-white/4 border-blue-500/40 hover:bg-blue-500/8 hover:border-blue-500/25 text-blue-400 cursor-pointer"
                        : "bg-white/2 border-white/5 text-white/15 cursor-not-allowed"
                    )}
                  >
                    <Signature className="size-[18px]" />
                  </button>
                )}

              </div>
            );
          })}
        </div>
      </div>

      {signingDoc && activeDoc && (
        <SignModal
          doc={activeDoc}
          fullName={values.fullName}
          legalCompanyName={values.legalCompanyName}
          roleTitle={values.roleTitle}
          onConfirm={confirmSign}
          onCancel={() => setSigningDoc(null)}
          isPending={isPending}
        />
      )}
    </>
  );
}
