"use client";

import * as React from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface RepeatableRowsProps {
  /** Every row posts under this name; the action reads formData.getAll(name). */
  name: string;
  label: React.ReactNode;
  /** Plain-text label for aria names, when `label` carries more than text. */
  ariaLabel?: string;
  description: string;
  placeholder: string;
  initialRows: string[];
  /** One-click lines offered beneath the list, hidden once already present. */
  suggestions?: string[];
  disabled?: boolean;
  max?: number;
  /**
   * Adding, removing or inserting a suggestion is a button press, which the
   * form's onChange never sees. This lets the section mark itself unsaved.
   */
  onRowsChange?: () => void;
}

/** A list of single-line text values that the host can grow and shrink. */
export function RepeatableRows({
  name,
  label,
  ariaLabel,
  description,
  placeholder,
  initialRows,
  suggestions = [],
  disabled,
  max = 12,
  onRowsChange,
}: RepeatableRowsProps) {
  const a11yLabel = ariaLabel ?? (typeof label === "string" ? label : name);
  // Keyed by identity, not index: keying on index makes React reuse the wrong
  // input when a row is removed from the middle, and the host watches their
  // text jump up a line.
  const [rows, setRows] = React.useState<{ id: string; value: string }[]>(() =>
    (initialRows.length > 0 ? initialRows : [""]).map((value) => ({
      id: crypto.randomUUID(),
      value,
    })),
  );

  const present = new Set(rows.map((r) => r.value.trim()));
  const remaining = suggestions.filter((s) => !present.has(s));

  function addSuggestion(text: string) {
    setRows((r) => {
      // Fill a trailing blank row before growing the list.
      const last = r.at(-1);
      if (last && last.value.trim() === "") {
        return [...r.slice(0, -1), { ...last, value: text }];
      }
      return [...r, { id: crypto.randomUUID(), value: text }];
    });
    onRowsChange?.();
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="font-medium text-sm">{label}</div>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>

      {rows.map((row, index) => (
        <div key={row.id} className="flex items-center gap-2">
          <Input
            name={name}
            aria-label={`${a11yLabel} line ${index + 1}`}
            value={row.value}
            onChange={(e) =>
              setRows((r) => r.map((x) => (x.id === row.id ? { ...x, value: e.target.value } : x)))
            }
            placeholder={placeholder}
            disabled={disabled}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove ${a11yLabel.toLowerCase()} line ${index + 1}`}
            disabled={disabled || rows.length === 1}
            onClick={() => {
              setRows((r) => r.filter((x) => x.id !== row.id));
              onRowsChange?.();
            }}
          >
            <Trash2Icon />
          </Button>
        </div>
      ))}

      <div>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={disabled || rows.length >= max}
          onClick={() => setRows((r) => [...r, { id: crypto.randomUUID(), value: "" }])}
        >
          <PlusIcon />
          Add line
        </Button>
      </div>

      {remaining.length > 0 && rows.length < max && (
        <div className="flex flex-col gap-1.5 pt-2">
          <p className="text-muted-foreground text-xs">Common lines</p>
          <div className="flex flex-wrap gap-1.5">
            {remaining.map((s) => (
              <button
                key={s}
                type="button"
                disabled={disabled}
                onClick={() => addSuggestion(s)}
                className="inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-left text-muted-foreground text-xs transition-colors hover:border-solid hover:text-foreground disabled:opacity-50"
              >
                <PlusIcon className="size-3 shrink-0" />
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
