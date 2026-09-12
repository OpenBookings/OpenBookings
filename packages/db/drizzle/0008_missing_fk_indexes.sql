-- 0008_missing_fk_indexes — indexes for foreign keys that had none.
--
-- Apply BY HAND (see 0006). Idempotent; CONCURRENTLY is deliberately not used
-- so the file stays runnable inside a single psql session — these tables are
-- small enough that the brief lock is not worth the extra ceremony. Switch to
-- CREATE INDEX CONCURRENTLY (outside a transaction) if that stops being true.
--
-- An unindexed FK column costs twice: the child-side lookup is a sequential
-- scan, and every DELETE or UPDATE of the parent key scans the child table to
-- enforce the constraint.

-- Hit once per candidate room by the hero-image correlated subquery in the
-- search query (apps/web/app/api/query/route.ts) and again on the property
-- page — a sequential scan over every image row, per row of the result set.
CREATE INDEX IF NOT EXISTS idx_property_images_property_id
  ON property_images (property_id, sort_order);

-- ON DELETE CASCADE from properties; also the join in the host's thread list.
CREATE INDEX IF NOT EXISTS idx_message_threads_property_id
  ON message_threads (property_id);

-- The retention sweep filters on `sender_id IS NOT NULL`, and anonymization
-- rewrites this column across whole threads.
CREATE INDEX IF NOT EXISTS idx_messages_sender_id
  ON messages (sender_id);

-- reservations.rate_plan_id has no index, so deleting or deactivating a rate
-- plan scans reservations, and the checkout/support joins do the same.
CREATE INDEX IF NOT EXISTS idx_reservations_rate_plan_id
  ON reservations (rate_plan_id);

-- The reverse direction of the amenity join tables: "which properties/rooms
-- have amenity X" is a sequential scan today.
CREATE INDEX IF NOT EXISTS idx_property_amenities_amenity_id
  ON property_amenities (amenity_id);
CREATE INDEX IF NOT EXISTS idx_room_amenities_amenity_id
  ON room_amenities (amenity_id);
