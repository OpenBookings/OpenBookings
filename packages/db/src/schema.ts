import {
  bigint,
  boolean,
  char,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/** PostGIS `geography(point, 4326)` — opaque here; geo predicates (ST_DWithin, ST_X/Y) go through raw sql. */
const geographyPoint = customType<{ data: string }>({
  dataType() {
    return "geography(point, 4326)";
  },
});

export const accountTypeEnum = pgEnum("account_type", ["private", "business"]);
export const adjustmentTypeEnum = pgEnum("adjustment_type", ["flat", "percent"]);
export const bookingStatusEnum = pgEnum("booking_status", [
  "pending",
  "confirmed",
  "cancelled",
  "completed",
  "no_show",
]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "requires_action",
  "succeeded",
  "failed",
  "refunded",
  "partially_refunded",
]);
export const rateModifierTypeEnum = pgEnum("rate_modifier_type", [
  "extra_guest",
  "length_of_stay",
  "early_bird",
  "last_minute",
  "day_of_week",
  "platform_offer",
]);
export const transactionTypeEnum = pgEnum("transaction_type", [
  "charge",
  "refund",
  "partial_refund",
  "payout",
  "platform_fee",
]);

export const amenities = pgTable("amenities", {
  id: uuid("id").defaultRandom().primaryKey(),
  label: varchar("label", { length: 100 }).notNull().unique(),
  icon: varchar("icon", { length: 50 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  sortOrder: smallint("sort_order").default(0),
});

export const properties = pgTable(
  "properties",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull().unique(),
    addressLine1: varchar("address_line_1", { length: 255 }).notNull(),
    addressLine2: varchar("address_line_2", { length: 255 }),
    city: varchar("city", { length: 100 }).notNull(),
    postalCode: varchar("postal_code", { length: 20 }),
    country: char("country", { length: 2 }).notNull(),
    timezone: varchar("timezone", { length: 50 }).notNull(),
    location: geographyPoint("location").notNull(),
    checkInTime: time("check_in_time").notNull(),
    checkOutTime: time("check_out_time").notNull(),
    /** End of the arrival window. NULL = no stated cut-off. */
    checkInUntil: time("check_in_until"),
    stripeAccountId: varchar("stripe_account_id", { length: 255 }).unique(),
    commissionRate: numeric("commission_rate", { precision: 5, scale: 4 }).notNull().default("0.035"),
    taxRate: numeric("tax_rate", { precision: 5, scale: 4 }).notNull().default("0.00"),
    isActive: boolean("is_active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    subtitle: varchar("subtitle", { length: 255 }),
    /** Better Auth user id of the owning host. NULL = unowned; authz fails closed. */
    ownerUserId: text("owner_user_id"),
  },
  (table) => [
    index("idx_hotels_is_active").on(table.isActive),
    index("idx_hotels_owner_user_id").on(table.ownerUserId),
  ],
);

export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    baseOccupancy: integer("base_occupancy").notNull(),
    maxAdults: integer("max_adults").notNull(),
    maxChildren: integer("max_children").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    roomType: varchar("room_type", { length: 100 }),
    bedType: varchar("bed_type", { length: 100 }),
    sizeSqm: numeric("size_sqm", { precision: 6, scale: 1 }),
    /**
     * Physical units of this room type the property owns. Availability is a
     * property of the room type, not the rate plan: every rate plan attached
     * to this room draws from this one pool. `room_inventory` overrides it
     * per date; this is the standing default.
     */
    totalUnits: integer("total_units").notNull().default(1),
  },
  (table) => [index("idx_rooms_hotel_id").on(table.propertyId)],
);

export const ratePlans = pgTable(
  "rate_plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    bar: bigint("bar", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("EUR"),
    isRefundable: boolean("is_refundable").notNull(),
    cancellationPolicy: text("cancellation_policy"),
    bookingFeeRate: numeric("booking_fee_rate", { precision: 5, scale: 4 }).notNull().default("0.00"),
    minStay: integer("min_stay").notNull().default(1),
    maxStay: integer("max_stay"),
    minAdvanceBooking: integer("min_advance_booking"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_rate_plans_room_id").on(table.roomId, table.isActive)],
);

export const rateOverrides = pgTable(
  "rate_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ratePlanId: uuid("rate_plan_id")
      .notNull()
      .references(() => ratePlans.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 100 }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    pricePerNight: bigint("price_per_night", { mode: "number" }).notNull(),
    priority: integer("priority").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    isActive: boolean("is_active").notNull().default(true),
    /**
     * Better Auth user id of the host who set this price. NULL on rows written
     * before the column existed, and on any the system writes itself.
     *
     * The ARI grid's price build-up names the source of every step, and an
     * override is the one step a person chose deliberately — without this it
     * can only be reported as "an override exists", which is the question the
     * host was asking, not the answer.
     */
    createdBy: text("created_by"),
  },
  (table) => [index("idx_rate_overrides_plan_dates").on(table.ratePlanId, table.startDate, table.endDate)],
);

export const rateModifiers = pgTable(
  "rate_modifiers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ratePlanId: uuid("rate_plan_id")
      .notNull()
      .references(() => ratePlans.id, { onDelete: "cascade" }),
    type: rateModifierTypeEnum("type").notNull(),
    triggerCondition: jsonb("trigger_condition").notNull(),
    adjustmentType: adjustmentTypeEnum("adjustment_type").notNull(),
    adjustmentValue: bigint("adjustment_value", { mode: "number" }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: smallint("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_rate_modifiers_plan_active").on(table.ratePlanId, table.isActive)],
);

export const propertyAmenities = pgTable(
  "property_amenities",
  {
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    amenityId: uuid("amenity_id")
      .notNull()
      .references(() => amenities.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.propertyId, table.amenityId] })],
);

export const cotPolicyEnum = pgEnum("cot_policy", ["free", "paid", "unavailable"]);

/**
 * Guest-facing listing content, 1:1 with `properties`.
 *
 * One table rather than three (prose / policy / legal) because it is one
 * screen's worth of content edited together, and it costs the public listing
 * page a single LEFT JOIN. Every column is nullable: the row must be able to
 * exist before the host has filled it in. Completeness is an application-layer
 * rule (see the editor's completion.ts), not a database constraint.
 */
export const propertyContent = pgTable("property_content", {
  propertyId: uuid("property_id")
    .primaryKey()
    .references(() => properties.id, { onDelete: "cascade" }),

  // Prose
  overviewHeadline: varchar("overview_headline", { length: 120 }),
  overviewDescription: text("overview_description"),
  locationAbout: text("location_about"),
  ctaHeadline: varchar("cta_headline", { length: 120 }),
  ctaBody: text("cta_body"),
  finePrint: text("fine_print").array(),

  // Policy facts. The arrival window itself lives on `properties`.
  reception24h: boolean("reception_24h").notNull().default(false),
  freeCancellationDays: integer("free_cancellation_days"),
  prepaymentRequired: boolean("prepayment_required").notNull().default(false),
  childrenWelcome: boolean("children_welcome").notNull().default(true),
  minCheckInAge: integer("min_check_in_age"),
  cotPolicy: cotPolicyEnum("cot_policy"),
  /** Whole currency units, like rate_plans.bar. Read back as a string; convert explicitly. */
  cotFee: bigint("cot_fee", { mode: "number" }),
  extraBedFee: bigint("extra_bed_fee", { mode: "number" }),
  petsAllowed: boolean("pets_allowed").notNull().default(false),
  paymentMethods: text("payment_methods").array(),

  // Legal / business details, shown in the guest-facing business details modal.
  legalCompanyName: varchar("legal_company_name", { length: 255 }),
  contactEmail: varchar("contact_email", { length: 255 }),
  contactPhone: varchar("contact_phone", { length: 50 }),
  companyRegistration: varchar("company_registration", { length: 100 }),
  vatNumber: varchar("vat_number", { length: 100 }),

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The catalogue behind `property_content.payment_methods`.
 *
 * A lookup table rather than a hardcoded map in the listing page: adding a
 * method, swapping a logo, or fixing a name is a row edit, not a deploy. The
 * `code` is what the host's selection stores, so it is the primary key.
 *
 * `artworkUrl` is nullable because not every method has a logo — cash renders
 * as its label. `note` is the tooltip shown beside the label; it is the reason
 * cash needs one ("only available at the hotel") and cards do not.
 */
export const paymentMethods = pgTable("payment_methods", {
  code: varchar("code", { length: 32 }).primaryKey(),
  label: varchar("label", { length: 60 }).notNull(),
  artworkUrl: text("artwork_url"),
  note: varchar("note", { length: 160 }),
  sortOrder: smallint("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
});

/**
 * "Nearby" rows on the listing page's Location section.
 *
 * `distance` is a display string ("50 m", "1.2 km"), not a number: the host is
 * describing walking distance loosely, and a numeric column invites a precision
 * they do not have. `icon` is a lucide name from the curated set the editor
 * offers, resolved by the same getIcon helper AmenitiesSection.tsx uses.
 */
export const propertyHighlights = pgTable(
  "property_highlights",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 100 }).notNull(),
    icon: varchar("icon", { length: 50 }).notNull(),
    distance: varchar("distance", { length: 30 }).notNull(),
    sortOrder: smallint("sort_order").notNull().default(0),
  },
  (table) => [
    index("idx_property_highlights_property").on(table.propertyId, table.sortOrder),
  ],
);

export const roomAmenities = pgTable(
  "room_amenities",
  {
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    amenityId: uuid("amenity_id")
      .notNull()
      .references(() => amenities.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.roomId, table.amenityId] })],
);

export const propertyImages = pgTable("property_images", {
  id: uuid("id").defaultRandom().primaryKey(),
  propertyId: uuid("property_id")
    .notNull()
    .references(() => properties.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  group: varchar("group", { length: 50 }),
  sortOrder: smallint("sort_order").notNull().default(0),
  altText: text("alt_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const roomImages = pgTable(
  "room_images",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    group: varchar("group", { length: 50 }),
    sortOrder: smallint("sort_order").notNull().default(0),
    altText: text("alt_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_room_images_room_id").on(table.roomId, table.sortOrder)],
);

/**
 * Sparse per-date availability layer for a room type. A missing row is the
 * common case and means "nothing special about this date".
 *
 * Effective availability resolves in two layers, same precedence pattern as
 * rates (explicit beats computed):
 *   1. computed  = COALESCE(total_rooms, rooms.total_units) - blocked_rooms - booked
 *   2. override  = available_override, when set, wins outright
 * Both layers stay queryable so the grid's detail panel can explain *why* a
 * number is what it is.
 */
export const roomInventory = pgTable(
  "room_inventory",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    /** Per-date capacity override. NULL = use rooms.total_units. */
    totalRooms: integer("total_rooms"),
    /** Units withheld from sale — maintenance, owner use. Reduces the computed baseline. */
    blockedRooms: integer("blocked_rooms").notNull().default(0),
    /** Explicit host-set availability. When set, beats the computed baseline entirely. */
    availableOverride: integer("available_override"),
    note: text("note"),
    /** Better Auth user id of the host who last touched this date. */
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("room_inventory_unique_date").on(table.roomId, table.date),
    index("idx_room_inventory_room_date").on(table.roomId, table.date),
  ],
);

/**
 * Host-set date-range rules on a single rate plan: closures, minimum/maximum
 * stay, and closed-to-arrival / closed-to-departure.
 *
 * Closure and restriction share one table because they are the same kind of
 * thing (a host-set rule over a date range on a rate plan) and the grid needs
 * both in one pass. They stay distinct downstream: `is_closed` renders as the
 * Closed state, the other columns render as Restricted. A date carrying both
 * is Closed — unbookable outranks constrained.
 *
 * Overlaps resolve by `priority DESC`, mirroring `rate_overrides`.
 */
export const ratePlanRestrictions = pgTable(
  "rate_plan_restrictions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ratePlanId: uuid("rate_plan_id")
      .notNull()
      .references(() => ratePlans.id, { onDelete: "cascade" }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    /** Host closed this rate plan outright for these dates. */
    isClosed: boolean("is_closed").notNull().default(false),
    /** Per-date override of rate_plans.min_stay / max_stay. NULL = inherit the plan default. */
    minStay: integer("min_stay"),
    maxStay: integer("max_stay"),
    closedToArrival: boolean("closed_to_arrival").notNull().default(false),
    closedToDeparture: boolean("closed_to_departure").notNull().default(false),
    priority: integer("priority").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    note: text("note"),
    /** Better Auth user id of the host who set this — the detail panel shows who and when. */
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_rate_plan_restrictions_plan_dates").on(
      table.ratePlanId,
      table.startDate,
      table.endDate,
    ),
  ],
);

/**
 * Host-set date-range closure of a whole room type.
 *
 * Distinct from the three neighbouring concepts, and the distinction is the
 * point of the table:
 *
 * - `room_inventory.blocked_rooms` withholds *some* units — a broken room.
 *   The room type is still sellable on every rate plan that has stock left.
 * - `room_inventory.available_override = 0` says "no units left", which the
 *   grid reads as sold out. A host seeing that looks for the booking that
 *   filled the room; there isn't one.
 * - `rate_plan_restrictions.is_closed` closes one rate plan. Closing a room
 *   type by closing each of its plans loses the fact that they were one
 *   decision, and silently leaves the next plan added to the room open.
 *
 * A closure here cascades to every rate plan on the room for those dates, and
 * the grid says so rather than repeating the reason on each row.
 *
 * Shaped like `rate_plan_restrictions` on purpose — same range semantics, same
 * `priority DESC` overlap resolution, same soft delete — so the query layer
 * reads both through the same kind of LATERAL and reopening preserves who
 * closed what.
 */
export const roomClosures = pgTable(
  "room_closures",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    priority: integer("priority").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    note: text("note"),
    /** Better Auth user id of the host who closed it — the detail panel names them. */
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_room_closures_room_dates").on(
      table.roomId,
      table.startDate,
      table.endDate,
    ),
  ],
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    hotelId: uuid("hotel_id")
      .notNull()
      .references(() => properties.id),
    // Better Auth user ids are text, not uuid
    userId: text("user_id").notNull(),
    checkInDate: date("check_in_date").notNull(),
    checkOutDate: date("check_out_date").notNull(),
    status: bookingStatusEnum("status").notNull().default("pending"),
    totalAmount: bigint("total_amount", { mode: "number" }).notNull(),
    bookingFeeAmount: bigint("booking_fee_amount", { mode: "number" }).notNull().default(0),
    currency: char("currency", { length: 3 }).notNull().default("EUR"),
    stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
    guestNotes: text("guest_notes"),
    cancellationReason: text("cancellation_reason"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    noShowReportedAt: timestamp("no_show_reported_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_bookings_dates").on(table.checkInDate, table.checkOutDate),
    index("idx_bookings_hotel_id").on(table.hotelId),
    index("idx_bookings_status").on(table.status),
    index("idx_bookings_stripe_pi").on(table.stripePaymentIntentId),
    index("idx_bookings_user_id").on(table.userId),
  ],
);

export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id),
    ratePlanId: uuid("rate_plan_id")
      .notNull()
      .references(() => ratePlans.id),
    adults: integer("adults").notNull().default(1),
    children: integer("children").notNull().default(0),
    totalNights: integer("total_nights").notNull(),
    pricePerNight: bigint("price_per_night", { mode: "number" }).notNull(),
    totalAmount: bigint("total_amount", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_reservations_booking_id").on(table.bookingId),
    index("idx_reservations_room_id").on(table.roomId),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    type: transactionTypeEnum("type").notNull(),
    provider: varchar("provider", { length: 50 }).notNull().default("stripe"),
    providerPaymentId: varchar("provider_payment_id", { length: 255 }).notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("EUR"),
    status: paymentStatusEnum("status").notNull().default("pending"),
    failureCode: varchar("failure_code", { length: 100 }),
    failureMessage: text("failure_message"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_transactions_booking_id").on(table.bookingId),
    index("idx_transactions_provider_payment").on(table.providerPaymentId),
    index("idx_transactions_status").on(table.status),
    index("idx_transactions_type").on(table.type),
  ],
);

export const messageThreads = pgTable(
  "message_threads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** NULL = pre-booking inquiry, not yet tied to a booking. */
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    // Better Auth user ids are text, not uuid
    hostId: text("host_id").notNull(),
    guestId: text("guest_id").notNull(),
    /** 'open' | 'closed' | 'flagged', enforced by a DB check constraint. */
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_message_threads_host_id").on(table.hostId, table.updatedAt),
    index("idx_message_threads_guest_id").on(table.guestId, table.updatedAt),
    index("idx_message_threads_booking_id").on(table.bookingId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => messageThreads.id, { onDelete: "cascade" }),
    // Better Auth user ids are text, not uuid. Nullable: NULL'd out by the
    // retention sweep when a message is anonymized.
    senderId: text("sender_id"),
    /** 'host' | 'guest', enforced by a DB check constraint. */
    senderRole: text("sender_role").notNull(),
    body: text("body").notNull(),
    flaggedReason: text("flagged_reason"),
    readAt: timestamp("read_at", { withTimezone: true }),
    /** Set once the per-thread NOTIFY has fired for this message; also the retention-sweep cursor. */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_messages_thread_id_created_at").on(table.threadId, table.createdAt),
    index("idx_messages_unread_sweep").on(table.createdAt),
    index("idx_messages_flagged").on(table.threadId),
  ],
);

/**
 * Idempotency ledger for the support bot's Chatwoot webhook. One row per
 * Chatwoot event (e.g. `message_created:<message_id>`). The webhook inserts
 * before enqueueing (ON CONFLICT DO NOTHING → duplicate delivery is a no-op);
 * the task handler sets `replied_at` after posting to Chatwoot so Cloud Tasks
 * retries never produce a second guest-facing reply.
 */
export const processedEvents = pgTable("processed_events", {
  eventId: text("event_id").primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  /** Set once a guest-facing reply (or escalation note) was posted for this event. */
  repliedAt: timestamp("replied_at", { withTimezone: true }),
});

/**
 * Support-bot context cache: recent conversation turns per Chatwoot
 * conversation, so each webhook doesn't re-fetch full history from the
 * Chatwoot API. Staleness (TTL) is enforced at read time off `updated_at`.
 */
export const supportContextCache = pgTable("support_context_cache", {
  /** Chatwoot conversation id (their ids are integers). */
  conversationId: bigint("conversation_id", { mode: "number" }).primaryKey(),
  /** Array of `{ role: "user" | "assistant", content: string }` turns, oldest first. */
  turns: jsonb("turns").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Note: relational query config (db.query.*) uses drizzle-orm v1's `defineRelations` API,
// which differs from the stable `relations()` helper. Add it here if/when a consumer needs
// db.query instead of the select/execute APIs used so far.

/**
 * Per-host onboarding progress for apps/business: which steps are done, the
 * data each step collected, and when the whole flow was completed.
 *
 * `user_id` is a Better Auth user id (text, FK to `"user"` with ON DELETE
 * CASCADE — deleting an account takes its onboarding record with it) and is
 * the primary key, which is what the `ON CONFLICT (user_id)` upserts in
 * `apps/business/app/(onboarding)/onboarding/actions.ts` rely on.
 *
 * `step_data` is a merge target, never overwritten wholesale: each save does
 * `step_data || $new::jsonb`, so unrelated keys survive. The Stripe connected
 * account id lives under it as `step_data->>'stripe_account_id'` rather than
 * in a column of its own — see STRIPE_SETUP.md.
 *
 * Declared here because it was previously only in the live database: nothing
 * in this repo described it, so `drizzle-kit push` read it as a table to drop
 * and a fresh environment came up without it at all.
 */
export const hostOnboarding = pgTable("host_onboarding", {
  /** Better Auth user id. */
  userId: text("user_id").primaryKey(),
  /** Step keys (see DbStep) already completed, deduped and sorted on write. */
  completedSteps: text("completed_steps").array().notNull().default([]),
  /** Accumulated per-step payloads, merged key-by-key. */
  stepData: jsonb("step_data").notNull().default({}),
  /** NULL until the host clears the onboarding wall; the proxy gates on this. */
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
});
