"use client";

export default function LogoutButton() {
  return (
    <a
      href="/auth/logout"
      className="text-sm sm:text-base md:text-lg text-white font-medium transition-colors px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg bg-black/50 backdrop-blur-md border border-white/10 hover:bg-black/70"
    >
      Sign out
    </a>
  );
}

