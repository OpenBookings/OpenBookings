"use client";

import { useTransition } from "react";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { setRoomLike } from "@/lib/room-likes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The filled heart on a liked room. Tapping it removes the like; the page
 * refreshes without the room, and the toast offers it back.
 */
export function UnlikeButton({ roomId, roomName }: { roomId: string; roomName: string }) {
  const [pending, startTransition] = useTransition();

  function unlike() {
    startTransition(async () => {
      const result = await setRoomLike(roomId, false);
      if (!result.ok) {
        toast.error(result.reason === "signed-out" ? "Your session ended. Sign in again." : "Could not remove it. Try again.");
        return;
      }
      toast(`Removed ${roomName} from your likes`, {
        action: {
          label: "Undo",
          onClick: () => {
            void setRoomLike(roomId, true).then((undo) => {
              if (!undo.ok) toast.error("Could not put it back. Like it again from the hotel's page.");
            });
          },
        },
      });
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-lg"
      aria-label={`Remove ${roomName} from likes`}
      disabled={pending}
      onClick={unlike}
      className="shrink-0 text-red-400 hover:text-red-300"
    >
      <Heart aria-hidden className={cn("size-[18px]", pending ? "" : "fill-current")} strokeWidth={1.8} />
    </Button>
  );
}
