import {
  type MockReservation,
  mockReservations,
} from "@/components/dashboard/mock-reservations";

/**
 * JSON-serializable command menu config.
 * Icons are referenced by name and resolved through the icon registry
 * in command-menu-02.tsx, so this whole structure could come from an
 * API response or a plain .json file.
 */

export type CommandMenuAction =
  | { type: "navigate"; href: string }
  | { type: "command"; id: string };

export type CommandMenuItem = {
  /** Icon name, resolved via the icon registry in the component. */
  icon: string;
  label: string;
  /** Extra keywords so cmdk matches more search terms. */
  keywords?: string[];
  /** Keyboard shortcut, one Kbd per entry (e.g. ["⌘", "N"]). */
  shortcut?: string[];
  action: CommandMenuAction;
};

export type CommandMenuGroup = {
  heading?: string;
  items: CommandMenuItem[];
};

export const commandMenuGroups: CommandMenuGroup[] = [
  {
    items: [
      {
        icon: "plus",
        label: "New Reservation...",
        keywords: ["create", "booking"],
        shortcut: ["⌘", "N"],
        action: { type: "command", id: "new-reservation" },
      },
      {
        icon: "login",
        label: "Check In Guest...",
        keywords: ["arrival"],
        action: { type: "command", id: "check-in" },
      },
      {
        icon: "logout",
        label: "Check Out Guest...",
        keywords: ["departure"],
        action: { type: "command", id: "check-out" },
      },
    ],
  },
  {
    heading: "Navigation",
    items: [
      {
        icon: "arrow-right",
        label: "Go to Overview",
        keywords: ["dashboard", "home"],
        action: { type: "navigate", href: "/dashboard" },
      },
      {
        icon: "arrow-right",
        label: "Go to Rates & Availability",
        keywords: ["pricing", "calendar"],
        action: { type: "navigate", href: "/dashboard/listings/rates-availability" },
      },
      {
        icon: "arrow-right",
        label: "Go to Reservations",
        keywords: ["bookings"],
        action: { type: "navigate", href: "/dashboard/bookings/reservations" },
      },
      {
        icon: "arrow-right",
        label: "Go to Cancellations",
        action: { type: "navigate", href: "/dashboard/bookings/cancellations" },
      },
      {
        icon: "arrow-right",
        label: "Go to Property",
        action: { type: "navigate", href: "/dashboard/listings/property" },
      },
      {
        icon: "arrow-right",
        label: "Go to Rooms",
        keywords: ["listings"],
        action: { type: "navigate", href: "/dashboard/listings/rooms" },
      },
      {
        icon: "arrow-right",
        label: "Go to Finance",
        keywords: ["payouts", "transactions"],
        action: { type: "navigate", href: "/dashboard/finance" },
      },
      {
        icon: "arrow-right",
        label: "Go to Analytics",
        keywords: ["reports", "performance"],
        action: { type: "navigate", href: "/dashboard/analytics" },
      },
      {
        icon: "arrow-right",
        label: "Go to Messages",
        keywords: ["inbox", "chat"],
        action: { type: "navigate", href: "/dashboard/bookings/messages" },
      },
    ],
  },
  {
    heading: "General",
    items: [
      {
        icon: "settings",
        label: "Account Settings...",
        shortcut: ["⌘", ","],
        action: { type: "command", id: "account-settings" },
      },
      {
        icon: "building",
        label: "Switch Property...",
        keywords: ["workspace"],
        action: { type: "command", id: "switch-property" },
      },
      {
        icon: "device-desktop",
        label: "Change Theme...",
        keywords: ["dark", "light", "mode"],
        shortcut: ["⌘", "T"],
        action: { type: "command", id: "change-theme" },
      },
      {
        icon: "logout",
        label: "Log Out",
        shortcut: ["⌘", "Q"],
        action: { type: "command", id: "log-out" },
      },
    ],
  },
  {
    heading: "Help",
    items: [
      {
        icon: "file-search",
        label: "Search Help Center...",
        action: { type: "command", id: "help-center" },
      },
      {
        icon: "message",
        label: "Send Feedback...",
        action: { type: "command", id: "send-feedback" },
      },
      {
        icon: "at",
        label: "Contact Support",
        action: { type: "command", id: "contact-support" },
      },
    ],
  },
];

/**
 * Find reservations matching a query (reservation ID or guest name).
 *
 * Currently backed by the mock list; this is the seam to replace with a
 * SQL/API lookup later, e.g.:
 *   SELECT * FROM reservations
 *   WHERE id ILIKE '%' || $1 || '%' OR guest_name ILIKE '%' || $1 || '%'
 *   LIMIT 5
 */
export function searchReservations(
  query: string,
  limit = 5
): MockReservation[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return mockReservations
    .filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.guestName.toLowerCase().includes(q)
    )
    .slice(0, limit);
}
