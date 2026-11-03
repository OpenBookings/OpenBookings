import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { BACKDROP_COOKIE } from "@openbookings/images";
import { getBackdrop } from "@openbookings/images/server";
import { getServerSession } from "@/lib/auth";
import { GlassBackdrop } from "@/components/GlassBackdrop";
import { Nav } from "@/components/nav";
import { Toaster } from "@/components/ui/sonner";
import { AccountNav } from "./_components/AccountNav";
import { SignedOut } from "./_components/SignedOut";

export const metadata: Metadata = { title: { default: "Your account", template: "%s · OpenBookings" } };

/**
 * The guest account area: Console components (DESIGN_SYSTEM.md §3.3) on the
 * search page's blurred backdrop, under the homepage's nav. `.glass` makes the
 * Console tokens translucent (globals.css). Every page below reads the session
 * itself as well; this layout only decides between the shell and sign-in.
 */
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();

  if (!session) {
    return (
      <Suspense>
        <SignedOut />
      </Suspense>
    );
  }

  const { backdrop } = await getBackdrop((await cookies()).get(BACKDROP_COOKIE)?.value);

  return (
    <div className="console glass relative min-h-dvh font-sans text-foreground">
      <GlassBackdrop backdrop={backdrop} />
      <Nav />
      <div className="relative z-10 mx-auto flex max-w-[1200px] flex-col gap-6 px-4 pt-24 pb-6 sm:px-8 sm:pt-28 md:pt-36 lg:flex-row lg:gap-12">
        <AccountNav />
        <main className="flex min-w-0 max-w-[880px] flex-1 flex-col gap-10 pb-16">{children}</main>
      </div>
      <Toaster position="bottom-right" />
    </div>
  );
}
