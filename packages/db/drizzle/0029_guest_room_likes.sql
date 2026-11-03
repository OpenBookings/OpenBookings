-- 0029_guest_room_likes — rooms a guest has liked (the heart on a listing).
--
-- Apply BY HAND (psql or the Neon SQL editor), BEFORE deploying the code that
-- reads it. Idempotent.
--
-- One row per guest per room. Only the guest sees it (account → Likes, and the
-- filled heart on the listing); hosts never do. Deleting the user or the room
-- deletes the row.
--
-- Mirrors `guestRoomLikes` in src/schema.ts; keep the two in sync.

CREATE TABLE IF NOT EXISTS guest_room_likes (
  user_id     text         NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  room_id     uuid         NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, room_id)
);
