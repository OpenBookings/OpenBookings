"use client";

import { useState } from "react";
import FocusOverlay from "@/components/FocusOverlay";
import { LoginForm } from "@/components/LoginForm";

export default function LoginButton() {
  const [openLogin, setOpenLogin] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpenLogin(true)}
        className="text-sm sm:text-base md:text-lg text-white font-medium transition-all px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg bg-black/50 backdrop-blur-md border border-white/10 hover:bg-black/70 hover:scale-105 active:scale-95 cursor-pointer"
      >
        Get Started
      </button>

      <FocusOverlay open={openLogin} onClose={() => setOpenLogin(false)}>
        <div
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 sm:p-8 max-w-md w-full"
        >
          <div className="mb-6">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-2">
              Sign in to OpenBookings
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              Enter your email to receive a magic link
            </p>
          </div>
          <LoginForm onSuccess={() => setOpenLogin(false)} />
        </div>
      </FocusOverlay>
    </>
  );
}

