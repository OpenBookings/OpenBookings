import { PageHold } from "@/components/dashboard/page-loaders";
import { PageHeader } from "@/components/dashboard/page-header";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ReviewsView } from "@/components/dashboard/reviews/reviews-view";
import { getServerSession } from "@/lib/auth";
import { getCurrentProperty } from "@/lib/current-property";
import { loadHostReviews } from "@/lib/reviews/query";

export default async function ReviewsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const current = await getCurrentProperty();
  const reviews = await loadHostReviews(session, current?.propertyId ?? null);

  return (
    <PageHold id="reviews" fill>
      <PageHeader
        title="Reviews"
        description="Your guests' reviews show up here, and you can reply to each one."
        className="shrink-0 px-4 pb-4 md:pb-6 lg:px-6"
      />
      <Suspense>
        <ReviewsView reviews={reviews} />
      </Suspense>
    </PageHold>
  );
}
