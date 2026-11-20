import { roleAllows, type Permission } from "@openbookings/authz/permissions";
import type { BookingAction } from "@openbookings/pricing";

/**
 * Which grant each booking action needs. The server actions check these
 * with userCan; the reservations list uses the same table to hide what the
 * viewer's role would be refused.
 *
 * - Day-of-stay work is `operate`: any refund it causes (early departure)
 *   follows the cancellation policy, not the host's judgement.
 * - Cancelling is `cancel`: the refund again follows the policy.
 * - A goodwill refund is never issued by a host (owner decision
 *   2026-11-20). For hosts, `goodwill_refund` in the list only means they
 *   may *request* one through support (`request-refund`: owners, general
 *   managers and managers); OpenBookings staff issue it from the admin app. No host server
 *   action issues a goodwill refund.
 */
export const ACTION_PERMISSION: Record<BookingAction, Permission> = {
  mark_checked_in: { booking: ["operate"] },
  mark_no_show: { booking: ["operate"] },
  record_early_departure: { booking: ["operate"] },
  cancel: { booking: ["cancel"] },
  goodwill_refund: { booking: ["request-refund"] },
};

/**
 * Retrying a refund only re-sends an amount that was already decided, so
 * anyone who could have caused it (by checking a guest out early, say) may
 * retry it. It never creates a new refund.
 */
export const RETRY_REFUND_PERMISSION: Permission = { booking: ["operate"] };

/** The viewer's role in a booking's organisation, as the reservations query returns it. */
export type Viewer = { role: string | null; hasPropertyAccess: boolean };

/** The booking actions the viewer may take, out of those the booking's state allows. */
export function actionsForViewer(actions: readonly BookingAction[], viewer: Viewer): BookingAction[] {
  return actions.filter((action) =>
    roleAllows(viewer.role, ACTION_PERMISSION[action], viewer.hasPropertyAccess),
  );
}

export function viewerCanRetryRefunds(viewer: Viewer): boolean {
  return roleAllows(viewer.role, RETRY_REFUND_PERMISSION, viewer.hasPropertyAccess);
}
