import { redirect } from "next/navigation";

/** The old bookings index was a dead end; the list lives in the account area now. */
export default function BookingsPage() {
  redirect("/account/bookings");
}
