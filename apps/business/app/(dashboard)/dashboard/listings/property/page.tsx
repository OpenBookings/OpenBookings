import { Suspense } from "react";
import { redirect } from "next/navigation";
import { BuildingIcon } from "lucide-react";
import { getServerSession } from "@/lib/auth";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { PropertyEditor } from "./_components/property-editor";
import { loadAmenityCatalog, loadEditorData } from "./_lib/query";

interface PageProps {
  searchParams: Promise<{ property?: string }>;
}

export default function PropertyPage({ searchParams }: PageProps) {
  return (
    // No header of its own: the listings layout already renders the section
    // name above this, and a second one only steals pane height.
    <div className="flex min-h-0 flex-1 flex-col">
      <Suspense fallback={<EditorSkeleton />}>
        <EditorContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function EditorContent({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const { property } = await searchParams;
  const [data, amenities] = await Promise.all([
    loadEditorData(session, property),
    loadAmenityCatalog(),
  ]);

  if (!data) return <NoProperty />;

  return (
    <PropertyEditor
      data={data}
      amenities={amenities}
      publicBaseUrl={process.env.NEXT_PUBLIC_WEB_URL ?? "https://openbookings.co"}
    />
  );
}

/**
 * Reachable when a host's onboarding predates the promotion in promotion.ts and
 * the backfill has not run for them. Points at support rather than offering a
 * create form: a property created here would bypass the legal and Stripe steps
 * onboarding exists to collect.
 */
function NoProperty() {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BuildingIcon />
        </EmptyMedia>
        <EmptyTitle>No listing yet</EmptyTitle>
        <EmptyDescription>
          Your property has not been set up. Finish onboarding, or contact support if you
          have already completed it.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <a href="/support" className="text-sm underline underline-offset-2 hover:no-underline">
          Contact support
        </a>
      </EmptyContent>
    </Empty>
  );
}

function EditorSkeleton() {
  return (
    <div className="flex flex-1 gap-4 p-4 lg:p-6">
      <Skeleton className="hidden h-96 w-56 md:block" />
      <Skeleton className="h-96 flex-1" />
    </div>
  );
}
