"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useEffect, useRef } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";

interface ProfilePopupProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

export default function ProfilePopup({
  open,
  onClose,
  anchorRef,
}: ProfilePopupProps) {
  const { user } = useUser();
  const popupRef = useRef<HTMLDivElement>(null);

  // Close on ESC key
  useEffect(() => {
    if (!open) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open, onClose]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !user) return null;

  return (
    <div
      ref={popupRef}
      className="fixed z-50 top-4 sm:top-6 md:top-8 right-14 sm:right-18 md:right-22 w-60 max-w-[calc(100vw-2rem)]"
    >
      <Card className="bg-black/30 backdrop-blur-2xl border-white/20 shadow-2xl text-white rounded-2xl sm:rounded-3xl">
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-lg font-semibold text-white truncate">
                Welcome back!
              </CardTitle>
              <CardDescription className="text-sm text-white/70 truncate">
                {user.name || "Name"}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardFooter className="border-t border-white/10 pt-4">
          <a
            href="/auth/logout"
            className="w-full px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg font-medium transition-all text-center text-sm"
          >
            Sign out
          </a>
        </CardFooter>
      </Card>
    </div>
  );
}

