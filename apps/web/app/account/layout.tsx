import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { getServerSession } from "@/lib/auth";
import { AccountMenu } from "@/components/account/AccountMenu";
import { Toaster } from "@/components/ui/sonner";
import { AccountNav } from "./_components/AccountNav";
import { SignedOut } from "./_components/SignedOut";

export const metadata: Metadata = { title: { default: "Your account", template: "%s · OpenBookings" } };

/**
 * The guest account area: a Console surface (DESIGN_SYSTEM.md §3.3) laid out
 * like the host app's account pages. Every page below reads the session
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

  const { user } = session;

  return (
    <div className="console min-h-dvh bg-background font-sans text-foreground">
      <header className="sticky top-0 z-30 border-b bg-background">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-8">
          <Link href="/" className="flex items-center gap-3 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <Image
              src="https://cdn.openbookings.co/Public/Openbookings-logo-v2.png"
              width={96}
              height={72}
              alt="OpenBookings"
              className="h-8 w-auto select-none"
              draggable={false}
            />
          </Link>
          <AccountMenu user={{ name: user.name, email: user.email, image: user.image }} variant="console" />
        </div>
      </header>
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-6 sm:px-8 lg:flex-row lg:gap-12 lg:py-12">
        <AccountNav />
        <main className="flex min-w-0 max-w-[880px] flex-1 flex-col gap-10 pb-16">{children}</main>
      </div>
      <Toaster position="bottom-right" />
    </div>
  );
}
