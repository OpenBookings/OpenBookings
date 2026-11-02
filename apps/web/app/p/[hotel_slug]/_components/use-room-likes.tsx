"use client";

import { useCallback, useEffect, useState } from "react";
import posthog from "posthog-js";
import { authClient } from "@/lib/auth-client";
import { likedRoomIds, setRoomLike } from "@/lib/room-likes";
import FocusOverlay from "@/components/plug-in/FocusOverlay";
import { SS_AuthForm } from "@/components/auth/SS-AuthForm";
import { AuthFormFields, AuthFormPhaseProvider } from "@/components/auth/AuthFormFields";
import { Kbd } from "@/components/ui/kbd";

/**
 * A heart tapped while signed out. Signing in reloads the page (or lands in
 * another tab, for an email link), so the room waits here and is liked once
 * the guest is back on this listing with a session.
 */
const PENDING_KEY = "ob:pending-room-like";

function readPending(): string | null {
  try {
    return localStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

function writePending(roomId: string | null) {
  try {
    if (roomId) localStorage.setItem(PENDING_KEY, roomId);
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    // Storage blocked: the guest taps the heart again after signing in.
  }
}

// Demo rooms have made-up ids and nothing to save them to; they stay local.
const isSaved = (roomId: string) => !roomId.startsWith("demo-");

function withRoom(set: Set<string>, roomId: string, liked: boolean): Set<string> {
  const next = new Set(set);
  if (liked) next.add(roomId);
  else next.delete(roomId);
  return next;
}

/**
 * The listing's hearts. The page itself is cached for everyone, so which rooms
 * this guest liked is asked for from the browser once the session is known.
 */
export function useRoomLikes(roomIds: string[]) {
  const { data: session, isPending } = authClient.useSession();
  const signedIn = Boolean(session?.user);
  const [liked, setLiked] = useState<Set<string>>(() => new Set());
  const [askSignIn, setAskSignIn] = useState(false);
  const key = roomIds.join(",");

  useEffect(() => {
    if (!signedIn) return;
    const ids = key.split(",").filter(isSaved);
    let live = true;
    (async () => {
      const pending = readPending();
      if (pending && ids.includes(pending)) {
        const result = await setRoomLike(pending, true);
        if (result.ok) writePending(null);
      }
      const saved = await likedRoomIds(ids);
      if (live) setLiked((prev) => new Set([...saved, ...[...prev].filter((id) => !isSaved(id))]));
    })().catch(() => {
      // The hearts stay empty; tapping one still saves.
    });
    return () => {
      live = false;
    };
  }, [signedIn, key]);

  const toggle = useCallback(
    (roomId: string) => {
      const next = !liked.has(roomId);
      if (!isSaved(roomId)) {
        setLiked((prev) => withRoom(prev, roomId, next));
        return;
      }
      if (isPending) return;
      if (!signedIn) {
        writePending(roomId);
        setAskSignIn(true);
        posthog.capture("auth_form_opened", { from: "room_like" });
        return;
      }
      setLiked((prev) => withRoom(prev, roomId, next));
      posthog.capture(next ? "room_liked" : "room_unliked");
      const undo = () => setLiked((prev) => withRoom(prev, roomId, !next));
      setRoomLike(roomId, next).then((result) => {
        if (!result.ok) undo();
      }, undo);
    },
    [liked, signedIn, isPending],
  );

  const signIn = (
    <FocusOverlay
      open={askSignIn}
      onClose={() => {
        writePending(null);
        setAskSignIn(false);
      }}
    >
      <AuthFormPhaseProvider>
        <SS_AuthForm
          cardAction={
            <div className="flex items-center gap-2">
              <Kbd className="text-white/70 border-white/30 bg-white/10">Esc</Kbd>
            </div>
          }
        >
          <p className="text-center text-sm text-muted-foreground">Sign in to save rooms you like.</p>
          <AuthFormFields
            callbackURL={typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}#rooms`}
          />
        </SS_AuthForm>
      </AuthFormPhaseProvider>
    </FocusOverlay>
  );

  return { liked, toggle, signIn };
}
