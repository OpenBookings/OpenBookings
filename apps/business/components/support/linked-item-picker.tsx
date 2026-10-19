"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { searchLinkablesAction } from "@/lib/support/actions";
import type { LinkedKind } from "@/lib/support/categories";
import type { LinkOption } from "@/lib/support/types";
import { cn } from "@/lib/utils";

const NONE = "__none__";

/** "Which booking?" / "Which listing?" — always optional, searched on the server. */
export function LinkedItemPicker({
  id,
  kind,
  value,
  onChange,
  locked,
}: {
  id: string;
  kind: LinkedKind;
  value: LinkOption | null;
  onChange: (value: LinkOption | null) => void;
  locked?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  // Results remember which search they answer, so "loading" is derived.
  const [results, setResults] = React.useState<{ key: string; options: LinkOption[] }>({ key: "", options: [] });
  const searchKey = `${kind}:${query}`;
  const loading = open && results.key !== searchKey;
  const options = results.options;
  const noneLabel = kind === "booking" ? "Not about a specific booking" : "Not about a specific listing";

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const key = `${kind}:${query}`;
    const timer = setTimeout(async () => {
      const result = await searchLinkablesAction(kind, query);
      if (cancelled) return;
      setResults({ key, options: result.ok ? result.data : [] });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, kind]);

  if (locked && value) {
    return (
      <div id={id} className="flex min-h-9 items-center rounded-md border bg-muted/40 px-3 py-1.5 text-sm">
        <span className="truncate font-medium">{value.label}</span>
        {value.detail ? <span className="ml-2 truncate text-xs text-muted-foreground">{value.detail}</span> : null}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>{value ? value.label : noneLabel}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={kind === "booking" ? "Reference or guest name" : "Listing name"}
          />
          <CommandList>
            <CommandEmpty>{loading ? "Searching…" : "Nothing found."}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={NONE}
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <Check className={cn(value ? "opacity-0" : "opacity-100")} />
                {noneLabel}
              </CommandItem>
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={option.id}
                  onSelect={() => {
                    onChange(option);
                    setOpen(false);
                  }}
                >
                  <Check className={cn(value?.id === option.id ? "opacity-100" : "opacity-0")} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{option.label}</span>
                    {option.detail ? <span className="truncate text-xs text-muted-foreground">{option.detail}</span> : null}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
