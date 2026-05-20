"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { MessageCircle, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Status = "Arrival" | "Departure" | "In house" | "cancelled" | "Checked Out";

interface Item {
  id: string;
  name: string;
  adults: number;
  children: number;
  nights: number;
  checkIn: string;
  checkOut: string;
  status: Status;
}

const statusConfig: Record<Status, { label: string; className: string }> = {
  Arrival: {
    label: "Arrival",
    className: "bg-emerald-500/10 text-emerald-400",
  },
  Departure: {
    label: "Departure",
    className: "bg-amber-500/10 text-amber-400",
  },
  "Checked Out": {
    label: "Checked Out",
    className: "bg-amber-500/10 text-amber-400",
  },
  "In house": {
    label: "In house",
    className: "bg-blue-500/10 text-blue-400",
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-rose-500/10 text-rose-400",
  },
};

function StatusBadge({ status }: { status: Status }) {
  const config = statusConfig[status];
  return (
    <Badge variant="outline" className={cn("border-0", config.className)}>
      {config.label}
    </Badge>
  );
}


const columns: ColumnDef<Item>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <span className="font-medium text-foreground">{row.getValue("name")}</span>
    ),
  },
  {
    accessorKey: "adults",
    header: () => <div className="text-center">Adults</div>,
    cell: ({ row }) => (
      <div className="text-center text-muted-foreground">{row.getValue("adults")}</div>
    ),
  },
  {
    accessorKey: "children",
    header: () => <div className="text-center">Children</div>,
    cell: ({ row }) => (
      <div className="text-center text-muted-foreground">{row.getValue("children")}</div>
    ),
  },
  {
    accessorKey: "nights",
    header: () => <div className="text-center">Nights</div>,
    cell: ({ row }) => (
      <div className="text-center text-muted-foreground">{row.getValue("nights")}</div>
    ),
  },
  {
    accessorKey: "checkIn",
    header: () => <div className="text-center">Check In</div>,
    cell: ({ row }) => (
      <div className="text-center text-muted-foreground">{row.getValue("checkIn")}</div>
    ),
  },
  {
    accessorKey: "checkOut",
    header: () => <div className="text-center">Check Out</div>,
    cell: ({ row }) => (
      <div className="text-center text-muted-foreground">{row.getValue("checkOut")}</div>
    ),
  },
  {
    accessorKey: "status",
    header: () => <div className="text-center">Status</div>,
    cell: ({ row }) => (
      <div className="flex justify-center">
        <StatusBadge status={row.getValue("status")} />
      </div>
    ),
  },
  {
    id: "actions",
    header: () => <div className="text-center">Actions</div>,
    cell: () => (
      <div className="flex items-center gap-1 justify-center">
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
          <MessageCircle className="h-4 w-4" />
          <span className="sr-only">Open chat</span>
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
          <ExternalLink className="h-4 w-4" />
          <span className="sr-only">Go to booking</span>
        </Button>
      </div>
    ),
  },
];

const data: Item[] = [
  { id: "1",  name: "Lena Hartmann",    adults: 2, children: 0, nights: 3, checkIn: "May 1, 2026",  checkOut: "May 4, 2026",  status: "Checked Out" },
  { id: "2",  name: "Marco Visser",     adults: 2, children: 1, nights: 3, checkIn: "May 3, 2026",  checkOut: "May 6, 2026",  status: "Checked Out" },
  { id: "3",  name: "Sophie Dubois",    adults: 2, children: 2, nights: 4, checkIn: "May 5, 2026",  checkOut: "May 9, 2026",  status: "Checked Out" },
  { id: "4",  name: "James O'Brien",    adults: 1, children: 0, nights: 2, checkIn: "May 8, 2026",  checkOut: "May 10, 2026", status: "Checked Out" },
  { id: "5",  name: "Aiko Tanaka",      adults: 2, children: 0, nights: 3, checkIn: "May 10, 2026", checkOut: "May 13, 2026", status: "Checked Out" },
  { id: "6",  name: "Pieter van Dijk",  adults: 2, children: 1, nights: 3, checkIn: "May 12, 2026", checkOut: "May 15, 2026", status: "Checked Out" },
  { id: "7",  name: "Fatima El Aaraj",  adults: 2, children: 0, nights: 2, checkIn: "May 14, 2026", checkOut: "May 16, 2026", status: "In house" },
  { id: "8",  name: "Carlos Méndez",    adults: 2, children: 2, nights: 3, checkIn: "May 15, 2026", checkOut: "May 18, 2026", status: "In house" },
  { id: "9",  name: "Nora Lindqvist",   adults: 2, children: 1, nights: 3, checkIn: "May 16, 2026", checkOut: "May 19, 2026", status: "In house" },
  { id: "10", name: "Tom Bakker",       adults: 1, children: 0, nights: 1, checkIn: "May 16, 2026", checkOut: "May 17, 2026", status: "In house" },
  { id: "11", name: "Amara Osei",       adults: 3, children: 1, nights: 4, checkIn: "May 16, 2026", checkOut: "May 20, 2026", status: "In house" },
  { id: "12", name: "Elena Morozova",   adults: 2, children: 0, nights: 4, checkIn: "May 17, 2026", checkOut: "May 21, 2026", status: "Arrival" },
  { id: "13", name: "David Kim",        adults: 2, children: 2, nights: 4, checkIn: "May 18, 2026", checkOut: "May 22, 2026", status: "Arrival" },
  { id: "14", name: "Ingrid Sørensen",  adults: 2, children: 0, nights: 4, checkIn: "May 19, 2026", checkOut: "May 23, 2026", status: "Arrival" },
  { id: "15", name: "Yusuf Al-Rashid",  adults: 2, children: 1, nights: 4, checkIn: "May 20, 2026", checkOut: "May 24, 2026", status: "Arrival" },
  { id: "16", name: "Clara Fernández",  adults: 2, children: 0, nights: 3, checkIn: "May 22, 2026", checkOut: "May 25, 2026", status: "Arrival" },
  { id: "17", name: "Bart Janssen",     adults: 2, children: 1, nights: 3, checkIn: "May 24, 2026", checkOut: "May 27, 2026", status: "Arrival" },
  { id: "18", name: "Mei-Ling Chen",    adults: 2, children: 2, nights: 4, checkIn: "May 26, 2026", checkOut: "May 30, 2026", status: "Arrival" },
  { id: "19", name: "Oliver Schmidt",   adults: 1, children: 0, nights: 3, checkIn: "May 28, 2026", checkOut: "May 31, 2026", status: "Arrival" },
  { id: "20", name: "Priya Nair",       adults: 2, children: 0, nights: 4, checkIn: "Jun 1, 2026",  checkOut: "Jun 5, 2026",  status: "Arrival" },
];

const CHUNK_SIZE = 10;

export default function Table05() {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [visibleCount, setVisibleCount] = useState(CHUNK_SIZE);
  const sentinelRef = useRef<HTMLTableRowElement>(null);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: "includesString",
    state: {
      sorting,
      globalFilter,
    },
  });

  const allRows = table.getRowModel().rows;
  const visibleRows = allRows.slice(0, visibleCount);
  const hasMore = visibleCount < allRows.length;

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + CHUNK_SIZE, allRows.length));
  }, [allRows.length]);

  useEffect(() => {
    setVisibleCount(CHUNK_SIZE);
  }, [globalFilter, sorting]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  return (
    <div className="w-full h-full flex flex-col gap-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-bold text-foreground">Today's Reservations</h2>
        <Input
          placeholder="Search..."
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="h-8 w-full sm:w-64 bg-secondary border-border text-foreground placeholder:text-muted-foreground"
        />
      </div>

      <div className="rounded-lg border border-border bg-secondary shadow-2xs flex-1 min-h-0 overflow-y-auto">
        <table className="w-full caption-bottom text-sm">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr
                key={headerGroup.id}
                className="sticky top-0 z-20 bg-muted"
                style={{
                  // Keep border on head as it scrolls
                  boxShadow: "0 2px 0 0 rgba(255,255,255,0.4)",
                }}
              >
                {headerGroup.headers.map((header, i, arr) => (
                  <th
                    key={header.id}
                    className={cn(
                      "bg-muted h-11 px-3 text-left align-middle text-xs font-semibold uppercase tracking-wider whitespace-nowrap text-muted-foreground",
                      i === 0 && "pl-5",
                      i === arr.length - 1 && "pr-5",
                      i > 0 && "border-l border-white/10",
                    )}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
      
            ))}
          </thead>
          <tbody className="[&_tr:last-child]:border-0">
            {visibleRows.length ? (
              <>
                {visibleRows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-white/10 transition-colors hover:bg-muted/30 text-foreground text-sm"
                  >
                    {row.getVisibleCells().map((cell, i, arr) => (
                      <td
                        key={cell.id}
                        className={cn(
                          "py-2 px-3 align-middle whitespace-nowrap",
                          i === 0 && "pl-5",
                          i === arr.length - 1 && "pr-5",
                          i > 0 && "border-l border-white/10",
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
                {hasMore && (
                  <tr ref={sentinelRef} className="border-0">
                    <td colSpan={columns.length} className="h-8" />
                  </tr>
                )}
              </>
            ) : (
              <tr>
                <td
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  No results.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
