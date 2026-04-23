import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-foreground mb-2">Dashboard</h1>
        <p className="text-muted-foreground mb-8">
          Welcome back, {session.user.email}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-lg border border-border p-6">
            <h2 className="text-lg font-semibold text-foreground mb-1">Properties</h2>
            <p className="text-muted-foreground text-sm">Manage your listings</p>
          </div>
          <div className="rounded-lg border border-border p-6">
            <h2 className="text-lg font-semibold text-foreground mb-1">Reservations</h2>
            <p className="text-muted-foreground text-sm">View incoming bookings</p>
          </div>
          <div className="rounded-lg border border-border p-6">
            <h2 className="text-lg font-semibold text-foreground mb-1">Revenue</h2>
            <p className="text-muted-foreground text-sm">Track your earnings</p>
          </div>
        </div>
      </div>
    </main>
  );
}
