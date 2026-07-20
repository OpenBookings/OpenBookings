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
    country: char("country", { length: 2 }).notNull(),
    timezone: varchar("timezone", { length: 50 }).notNull(),
    location: geographyPoint("location").notNull(),
    checkInTime: time("check_in_time").notNull(),
    checkOutTime: time("check_out_time").notNull(),
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

export const roomInventory = pgTable(
  "room_inventory",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    totalRooms: integer("total_rooms").notNull(),
    availableRooms: integer("available_rooms").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("room_inventory_unique_date").on(table.roomId, table.date),
    index("idx_room_inventory_room_date").on(table.roomId, table.date),
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

// Note: relational query config (db.query.*) uses drizzle-orm v1's `defineRelations` API,
// which differs from the stable `relations()` helper. Add it here if/when a consumer needs
// db.query instead of the select/execute APIs used so far.
