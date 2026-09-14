"use client";

import * as React from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface RepeatableRowsProps {
  /** Every row posts under this name; the action reads formData.getAll(name). */
  name: string;
  label: string;
  description: string;
  placeholder: string;
  initialRows: string[];
  disabled?: boolean;
  max?: number;
}

/** A list of single-line text values that the host can grow, shrink and reorder. */
export function RepeatableRows({
  name,
  label,
  description,
  placeholder,
  initialRows,
  disabled,
  max = 12,
}: RepeatableRowsProps) {
  // Keyed by identity, not index: keying on index makes React reuse the wrong
  // input when a row is removed from the middle, and the host watches their
  // text jump up a line.
  const [rows, setRows] = React.useState<{ id: string; value: string }[]>(() =>
    (initialRows.length > 0 ? initialRows : [""]).map((value) => ({
      id: crypto.randomUUID(),
      value,
    })),
  );

  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="font-medium text-sm">{label}</p>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>

      {rows.map((row, index) => (
        <div key={row.id} className="flex items-center gap-2">
          <Input
            name={name}
            aria-label={`${label} line ${index + 1}`}
            defaultValue={row.value}
            placeholder={placeholder}
            disabled={disabled}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove ${label.toLowerCase()} line ${index + 1}`}
            disabled={disabled || rows.length === 1}
            onClick={() => setRows((r) => r.filter((x) => x.id !== row.id))}
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
    </div>
  );
}
