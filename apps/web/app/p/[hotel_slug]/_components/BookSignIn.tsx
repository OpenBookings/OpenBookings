"use client";

import Image from "next/image";
import FocusOverlay from "@/components/plug-in/FocusOverlay";
import { AuthFormFields, AuthFormPhaseProvider } from "@/components/auth/AuthFormFields";

/**
 * "Sign in to book": the checkout gate's sign-in card (CheckoutGate), in the
 * page's overlay. Every way of signing in comes back to `callbackURL`, which
 * carries the selection in `book`, and the page presses Book now once more.
 */
export function BookSignIn({ callbackURL, onClose }: { callbackURL: string | null; onClose: () => void }) {
  return (
    <FocusOverlay open={callbackURL !== null} onClose={onClose}>
      {/* `text-white` is the card's inherited foreground: the shared sign-in
          controls let their text inherit (see CheckoutGate). */}
      <div className="mx-auto w-full max-w-sm rounded-3xl border border-white/15 bg-black/40 p-8 text-white shadow-2xl backdrop-blur-2xl">
        <Image
          src="https://cdn.openbookings.co/Public/Openbookings-logo-v2.png"
          width={96}
          height={72}
          alt="OpenBookings"
          className="pointer-events-none mx-auto h-8 w-auto select-none"
          draggable="false"
        />

        <div className="mt-6 text-center">
          <p className="text-lg font-semibold text-white">Sign in to book</p>
          <p className="mt-1 text-sm text-white/70">
            Your booking, confirmation and cancellation all live in your account.
          </p>
        </div>

        <div className="mt-6 flex flex-col items-center gap-4">
          <AuthFormPhaseProvider>
            {callbackURL && <AuthFormFields callbackURL={callbackURL} />}
          </AuthFormPhaseProvider>
        </div>

        <p className="mt-6 text-center text-xs text-white/45">
          You won&apos;t be charged until you confirm the payment.
        </p>
      </div>
    </FocusOverlay>
  );
}
