"use client";

import { useState, useTransition } from "react";
import { InfoIcon, CheckCircle2Icon, XIcon, Signature, Download, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { signLegalDocument, downloadLegalDocument, trackLegalDocumentDownload } from "../../actions";

export interface LegalNBoringValues {
  legalCompanyName: string;
  fullName: string;
  roleTitle: string;
  vatNumber: string;
  cocNumber: string;
  partnerAgreementSignedAt: string | null;
  dpaSignedAt: string | null;
}

const DOCUMENTS = [
  { id: "partner-agreement" as const, label: "Partner Agreement" },
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ob-sidebar/80 backdrop-blur-sm">
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
            className="flex-1 h-10 rounded-lg bg-ob-brand hover:bg-ob-brand-light disabled:opacity-60 text-sm text-white font-medium transition-colors"
          >
            {isPending ? "Signing…" : "Sign Document"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface DownloadModalProps {
  onDownload: () => void;
  onClose: () => void;
  isDownloading: boolean;
}

function DownloadModal({ onDownload, onClose, isDownloading }: DownloadModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ob-sidebar/80 backdrop-blur-sm">
      <div className="bg-[#13161b] border border-white/10 rounded-2xl p-8 w-full max-w-md shadow-2xl flex flex-col gap-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Partner Agreement</h2>
            <p className="text-sm text-white/40 mt-1">Your document is signed and on file</p>
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
          <span className="text-sm text-white/60">Signed & sent — agreement is legally binding</span>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-10 rounded-lg border border-white/10 text-sm text-white/50 hover:bg-white/5 transition-colors"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onDownload}
            disabled={isDownloading}
            className="flex-1 h-10 rounded-lg bg-ob-brand hover:bg-ob-brand-light disabled:opacity-60 text-sm text-white font-medium transition-colors flex items-center justify-center gap-2"
          >
            {isDownloading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            {isDownloading ? "Downloading…" : "Download Copy"}
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
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [downloadingDoc, setDownloadingDoc] = useState<DocumentId | null>(null);

  function handleDownload(docId: DocumentId) {
    setDownloadingDoc(docId);
    startTransition(async () => {
      try {
        const { bytes, filename } = await downloadLegalDocument(docId);
        const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        await trackLegalDocumentDownload(docId, filename);
      } finally {
        setDownloadingDoc(null);
      }
    });
  }

  const anySigned = Boolean(values.partnerAgreementSignedAt || values.dpaSignedAt);

  const fieldsComplete =
    values.legalCompanyName.trim() &&
    values.fullName.trim() &&
    values.roleTitle.trim() &&
    values.vatNumber.trim();

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
        vatNumber: values.vatNumber,
        cocNumber: values.cocNumber || undefined,
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
            Your <span className="text-white/70 font-medium">IP address</span> is recorded at the moment of signing and stored as part of the legally binding record. You can download a signed copy of each document after signing.
          </p>
        </div>

        {/* Sign CTA */}
        <div className="mt-4">
          {values.partnerAgreementSignedAt ? (
            <button
              type="button"
              onClick={() => setShowDownloadModal(true)}
              className="w-full h-14 rounded-full bg-green-500/10 border border-green-500/25 flex items-center justify-center gap-2.5 text-sm font-medium text-green-400/80 transition-colors hover:bg-green-500/15 cursor-pointer"
            >
              <CheckCircle2Icon className="size-4" />
              Signed & Sent
            </button>
          ) : (
            <button
              type="button"
              disabled={!fieldsComplete}
              onClick={() => handleSignClick("partner-agreement")}
              title={!fieldsComplete ? "Fill in your details above first" : undefined}
              className={cn(
                "w-full h-14 rounded-full border flex items-center justify-center gap-2.5 text-sm font-medium transition-colors",
                fieldsComplete
                  ? "bg-ob-brand hover:bg-ob-brand-light border-ob-brand text-white cursor-pointer"
                  : "bg-white/2 border-white/5 text-white/20 cursor-not-allowed"
              )}
            >
              <Signature className="size-4" />
              Sign the Partner Agreement
            </button>
          )}
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

      {showDownloadModal && (
        <DownloadModal
          onDownload={() => handleDownload("partner-agreement")}
          onClose={() => setShowDownloadModal(false)}
          isDownloading={downloadingDoc === "partner-agreement"}
        />
      )}
    </>
  );
}
