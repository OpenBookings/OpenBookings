-- 0031_invitation_property_access — which properties an invited person will
-- get, for the property-scoped roles (manager, reservations, front desk).
--
-- Better Auth's invitation row has no place for this, and the member row the
-- grant belongs on does not exist until the invitation is accepted. The
-- org plugin's afterAcceptInvitation hook (packages/auth/src/host.ts) copies
-- these rows into property_access for the new member.
--
-- Additive only: safe for the code running before this deploy.
CREATE TABLE IF NOT EXISTS invitation_property_access (
  invitation_id text NOT NULL REFERENCES "invitation"(id) ON DELETE CASCADE,
  property_id   uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (invitation_id, property_id)
);
