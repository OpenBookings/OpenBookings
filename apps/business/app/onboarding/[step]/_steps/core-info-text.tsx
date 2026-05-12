"use client";

import { useRef, useState } from "react";
import { UploadCloudIcon, XIcon, FileTextIcon, ImageIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface PhotoPreview {
  id: string;
  url: string;
  name: string;
}

export interface CoreInfoTextValues {
  displayName: string;
  tagline: string;
  description: string;
  photos: File[];
  houseRulesText: string;
}

interface CoreInfoTextStepProps {
  values: CoreInfoTextValues;
  onChange: (values: Partial<CoreInfoTextValues>) => void;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45 mb-3 mt-1">
      {children}
    </p>
  );
}

export function CoreInfoTextStep({ values, onChange }: CoreInfoTextStepProps) {
  const [photoPreviews, setPhotoPreviews] = useState<PhotoPreview[]>([]);
  const [photoDragOver, setPhotoDragOver] = useState(false);
  const [rulesDragOver, setRulesDragOver] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const rulesInputRef = useRef<HTMLInputElement>(null);

  function addPhotos(files: FileList | null) {
    if (!files) return;
    const newFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
    const newPreviews: PhotoPreview[] = newFiles.map((f) => ({
      id: `${f.name}-${Date.now()}-${Math.random()}`,
      url: URL.createObjectURL(f),
      name: f.name,
    }));
    setPhotoPreviews((prev) => [...prev, ...newPreviews]);
    onChange({ photos: [...values.photos, ...newFiles] });
  }

  function removePhoto(id: string, index: number) {
    setPhotoPreviews((prev) => prev.filter((p) => p.id !== id));
    onChange({ photos: values.photos.filter((_, i) => i !== index) });
  }

  async function handleRulesFile(files: FileList | null) {
    if (!files?.[0]) return;
    const file = files[0];
    if (file.type === "text/plain") {
      const text = await file.text();
      onChange({ houseRulesText: text });
    }
  }

  return (
    <div className="flex flex-col gap-7">
      {/* Identity */}
      <div>
        <SectionLabel>Identity</SectionLabel>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="displayName" className="text-white/60 text-xs font-medium">
              Property name <span className="text-red-400 ml-0.5">*</span>
              <span className="text-white/30 font-normal ml-1.5">— shown to guests on OpenBookings</span>
            </Label>
            <Input
              id="displayName"
              placeholder="e.g. Grand Hotel Amsterdam"
              value={values.displayName}
              onChange={(e) => onChange({ displayName: e.target.value })}
              className="text-white/85 text-base h-10"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tagline" className="text-white/60 text-xs font-medium">
              Tagline <span className="text-white/30 font-normal ml-1">— optional · appears under your property name</span>
            </Label>
            <Input
              id="tagline"
              placeholder="e.g. Where the city slows down"
              value={values.tagline}
              onChange={(e) => onChange({ tagline: e.target.value })}
              className="text-white/85"
            />
          </div>
        </div>
      </div>

      {/* Description */}
      <div>
        <SectionLabel>Description</SectionLabel>
        <Textarea
          id="description"
          placeholder="Describe your property — location highlights, vibe, amenities…"
          rows={4}
          value={values.description}
          onChange={(e) => onChange({ description: e.target.value })}
          className="resize-none text-white/80"
        />
      </div>

      {/* Photos */}
      <div>
        <SectionLabel>Property photos</SectionLabel>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => addPhotos(e.target.files)}
        />

        {photoPreviews.length === 0 ? (
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setPhotoDragOver(true); }}
            onDragLeave={() => setPhotoDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setPhotoDragOver(false);
              addPhotos(e.dataTransfer.files);
            }}
            className={cn(
              "flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-8 transition-colors",
              photoDragOver
                ? "border-ob-brand/60 bg-ob-brand/5"
                : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
            )}
          >
            <div className="flex size-10 items-center justify-center rounded-full bg-white/5">
              <UploadCloudIcon className="size-5 text-white/40" />
            </div>
            <div className="text-center">
              <p className="text-sm text-white/60">
                <span className="text-ob-brand-light">Click to upload</span> or drag & drop
              </p>
              <p className="mt-0.5 text-xs text-white/30">PNG, JPG, WEBP — up to 10 MB each</p>
            </div>
          </button>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {photoPreviews.map((preview, i) => (
              <div key={preview.id} className="group relative aspect-video overflow-hidden rounded-md border border-white/10">
                <img src={preview.url} alt={preview.name} className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(preview.id, i)}
                  className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-ob-sidebar/80 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <XIcon className="size-3 text-white" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              className="flex aspect-video items-center justify-center rounded-md border border-dashed border-white/10 bg-white/[0.02] transition-colors hover:border-white/20 hover:bg-white/[0.04]"
            >
              <ImageIcon className="size-5 text-white/25" />
            </button>
          </div>
        )}
      </div>

      {/* House Rules */}
      <div>
        <div className="flex items-center justify-between mb-3 mt-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
            House rules <span className="normal-case text-white/30 font-normal tracking-normal text-[11px]">— optional</span>
          </p>
          <button
            type="button"
            onClick={() => rulesInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-white/40 transition-colors hover:bg-white/5 hover:text-white/70"
          >
            <FileTextIcon className="size-3.5" />
            Import .txt
          </button>
          <input
            ref={rulesInputRef}
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            onChange={(e) => handleRulesFile(e.target.files)}
          />
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setRulesDragOver(true); }}
          onDragLeave={() => setRulesDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setRulesDragOver(false);
            handleRulesFile(e.dataTransfer.files);
          }}
          className={cn("rounded-lg transition-colors", rulesDragOver && "ring-1 ring-ob-brand/50")}
        >
          <Textarea
            id="houseRules"
            placeholder="e.g. No smoking, no parties. Check-in from 15:00, check-out by 11:00…"
            rows={4}
            value={values.houseRulesText}
            onChange={(e) => onChange({ houseRulesText: e.target.value })}
            className="resize-none text-white/80"
          />
        </div>
        <p className="mt-1.5 text-xs text-white/25">Drag a .txt file onto the text area to import.</p>
      </div>
    </div>
  );
}
