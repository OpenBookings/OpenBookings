import { PageHold } from "@/components/dashboard/page-loaders";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ReviewsView } from "@/components/dashboard/reviews/reviews-view";
import { getServerSession } from "@/lib/auth";
import { loadHostReviews } from "@/lib/reviews/query";

export default async function ReviewsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const reviews = await loadHostReviews(session);

  return (
    <PageHold id="reviews" fill>
      <Suspense>
        <ReviewsView reviews={reviews} />
      </Suspense>
    </PageHold>
  );
}
