"use client";

import * as React from "react";
import type { AriChange } from "./actions";

/**
 * Staged edits, held until the host publishes them.
 *
 * Why stage at all: the alternative is a write per cell, and an inventory
 * screen is used in sweeps — close the week, reprice the weekend, lift a min
 * stay. Writing each one live means a half-finished sweep is live and
 * sellable, and there is no moment where the host can look at what they are
 * about to do and change their mind.
 *
 * The store is keyed per cell because that is what the host edits. Folding
 * those into the date ranges the tables actually store is done once, at
 * publish, by `toChanges` — doing it earlier would mean re-splitting a range
 * every time somebody edited one date inside it.
 */

export type DraftEdit =
  | { kind: "price"; ratePlanId: string; date: string; price: number | null }
  | {
      kind: "closure";
      ratePlanId: string;
      date: string;
      /** False reopens a date that is currently closed. */
      closed: boolean;
      note: string | null;
    }
  | {
      kind: "restriction";
      ratePlanId: string;
      date: string;
      minStay: number | null;
      maxStay: number | null;
      closedToArrival: boolean;
      closedToDeparture: boolean;
      note: string | null;
      /** True lifts the stay rules on this date instead of setting them. */
      remove: boolean;
    }
  | {
      kind: "roomClosure";
      roomId: string;
      date: string;
      closed: boolean;
      note: string | null;
    };

/** One cell, one edit per kind. Editing it again replaces rather than stacks. */
export function editKey(edit: DraftEdit): string {
  const target = edit.kind === "roomClosure" ? edit.roomId : edit.ratePlanId;
  return `${edit.kind}|${target}|${edit.date}`;
}

export interface DraftState {
  edits: Map<string, DraftEdit>;
}

export type DraftAction =
  | { type: "stage"; edits: DraftEdit[] }
  | { type: "unstage"; keys: string[] }
  | { type: "discard" };

function reducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case "stage": {
      if (action.edits.length === 0) return state;
      const edits = new Map(state.edits);
      for (const edit of action.edits) edits.set(editKey(edit), edit);
      return { edits };
    }
    case "unstage": {
      const edits = new Map(state.edits);
      let removed = false;
      for (const key of action.keys) removed = edits.delete(key) || removed;
      return removed ? { edits } : state;
    }
    case "discard":
      return state.edits.size === 0 ? state : { edits: new Map() };
  }
}

export function useAriDraft() {
  const [state, dispatch] = React.useReducer(reducer, { edits: new Map() });

  const stage = React.useCallback(
    (edits: DraftEdit | DraftEdit[]) =>
      dispatch({ type: "stage", edits: Array.isArray(edits) ? edits : [edits] }),
    [],
  );

  const unstage = React.useCallback(
    (keys: string | string[]) =>
      dispatch({ type: "unstage", keys: Array.isArray(keys) ? keys : [keys] }),
    [],
  );

  const discard = React.useCallback(() => dispatch({ type: "discard" }), []);

  /** Look up a staged edit for one cell — the grid draws an "Unsaved" chip on it. */
  const editFor = React.useCallback(
    (kind: DraftEdit["kind"], targetId: string, date: string) =>
      state.edits.get(`${kind}|${targetId}|${date}`),
    [state.edits],
  );

  return {
    edits: state.edits,
    count: state.edits.size,
    stage,
    unstage,
    discard,
    editFor,
    changes: React.useMemo(() => toChanges([...state.edits.values()]), [state.edits]),
  };
}

/**
 * Fold per-cell edits into the change payload the publish action takes.
 *
 * Edits that say the same thing are collected onto one change carrying every
 * date they cover, so closing a week is one change with seven dates rather
 * than seven changes. The action then groups those dates into ranges and
 * writes one row per run.
 *
 * Dates are sorted so the payload is stable: an unstable payload makes two
 * identical drafts look different in a log, and makes this function a pain to
 * test.
 */
export function toChanges(edits: DraftEdit[]): AriChange[] {
  const grouped = new Map<string, { change: AriChange; dates: string[] }>();

  for (const edit of edits) {
    const { signature, build } = describe(edit);
    const existing = grouped.get(signature);
    if (existing) {
      existing.dates.push(edit.date);
      continue;
    }
    grouped.set(signature, { change: build(), dates: [edit.date] });
  }

  return [...grouped.values()].map(({ change, dates }) => ({
    ...change,
    dates: [...new Set(dates)].sort(),
  }));
}

/**
 * The identity of an edit for grouping, and how to build its change.
 *
 * The signature deliberately includes the note: two closures with different
 * explanations are two decisions, and merging them would file one host's
 * reason under the other's dates.
 */
function describe(edit: DraftEdit): {
  signature: string;
  build: () => AriChange;
} {
  switch (edit.kind) {
    case "price":
      return {
        signature: `price|${edit.ratePlanId}|${edit.price}`,
        build: () => ({
          type: "price",
          ratePlanId: edit.ratePlanId,
          dates: [],
          price: edit.price,
          label: null,
        }),
      };

    case "closure":
      return {
        signature: `closure|${edit.ratePlanId}|${edit.closed}|${edit.note ?? ""}`,
        build: () => ({
          type: "closure",
          ratePlanId: edit.ratePlanId,
          dates: [],
          note: edit.note,
          remove: !edit.closed,
        }),
      };

    case "roomClosure":
      return {
        signature: `roomClosure|${edit.roomId}|${edit.closed}|${edit.note ?? ""}`,
        build: () => ({
          type: "roomClosure",
          roomId: edit.roomId,
          dates: [],
          note: edit.note,
          remove: !edit.closed,
        }),
      };

    case "restriction":
      return {
        signature: [
          "restriction",
          edit.ratePlanId,
          edit.remove,
          edit.minStay,
          edit.maxStay,
          edit.closedToArrival,
          edit.closedToDeparture,
          edit.note ?? "",
        ].join("|"),
        build: () => ({
          type: "restriction",
          ratePlanId: edit.ratePlanId,
          dates: [],
          minStay: edit.minStay,
          maxStay: edit.maxStay,
          closedToArrival: edit.closedToArrival,
          closedToDeparture: edit.closedToDeparture,
          note: edit.note,
          remove: edit.remove,
        }),
      };
  }
}
