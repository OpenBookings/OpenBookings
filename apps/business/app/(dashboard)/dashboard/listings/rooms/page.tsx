import { Suspense } from "react";
import { redirect } from "next/navigation";
import { BuildingIcon } from "lucide-react";
import { getServerSession } from "@/lib/auth";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { RoomsIndex } from "./_components/rooms-index";
import { loadRoomsIndex } from "./_lib/query";

interface PageProps {
  searchParams: Promise<{ property?: string }>;
}

export default function RoomsPage({ searchParams }: PageProps) {
  return (
    // No header of its own, like the Property page: the listings layout
    // already names the section.
    <div className="flex min-h-0 flex-1 flex-col">
      <Suspense fallback={<IndexSkeleton />}>
        <IndexContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function IndexContent({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const { property } = await searchParams;
  const data = await loadRoomsIndex(session, property);
  if (!data) return <NoProperty />;

  return <RoomsIndex data={data} />;
}

/** Same dead end as the Property page: rooms hang off a property onboarding creates. */
function NoProperty() {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BuildingIcon />
        </EmptyMedia>
        <EmptyTitle>No listing yet</EmptyTitle>
        <EmptyDescription>
          Your property has not been set up. Finish onboarding, or contact support if you have
          already completed it.
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

function IndexSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-4 lg:px-6">
      <Skeleton className="h-9 w-40 self-end" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
