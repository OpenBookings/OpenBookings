import { randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
import type { Queryable, Staff } from "../staff";
import { decryptSecret } from "./crypto";
import { ENROL_ACTION, EnrolRefused, PENDING_ENROL_ACTIONS, totpStep, type RelyingParty, type RequireStepUp } from "./enrol";

/**
 * Step-up: a staff member confirms one dangerous action with a passkey or an
 * authenticator-app code, on top of their Access session.
 *
 *   begin     a row in admin_step_ups for (staff member, action, target),
 *             with a WebAuthn challenge; answerable for five minutes.
 *   complete  one try: the proof is checked against the staff member's
 *             credentials. Right: the row is verified and its id is the token.
 *   consume   the action spends the token, once, within five minutes of
 *             verifying, for exactly the staff member, action and target it
 *             was begun for.
 *
 * Every try spends the row first (used_at), so one challenge never gets a
 * second guess, even from two tabs at once; a right answer opens it again,
 * verified, for consume to spend. Five wrong answers in fifteen minutes stop
 * new step-ups until they age out.
 *
 * Replay: an authenticator-app code is accepted once. admin_credentials.counter
 * holds the time step of the last code accepted (enrolment's too), and only a
 * later step is accepted. A passkey's counter is its signature counter.
 *
 * Enrolment keeps its pending challenges in the same table (./enrol.ts); those
 * rows are never a step-up, and no step-up can be begun under their actions.
 */

export const STEP_UP_TTL_MS = 5 * 60_000;

const MAX_WRONG = 5;
const WRONG_WINDOW_MS = 15 * 60_000;
const MAX_FIELD = 200;

/** A step-up that may not be begun, or a token that may not be spent. */
export class StepUpError extends Error {
  constructor(message = "Confirm this action again") {
    super(message);
    this.name = "StepUpError";
  }
}

export type VerifyAuthentication = (o: {
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRPID: string;
  credential: { id: string; publicKey: Uint8Array<ArrayBuffer>; counter: number; transports?: string[] };
  requireUserVerification: boolean;
}) => Promise<{ verified: false } | { verified: true; authenticationInfo: { newCounter: number } }>;

export type StepUpDeps = {
  db: Queryable;
  /** ADMIN_TOTP_KEY. */
  totpKey: string;
  /** Resolved only when a passkey is involved: TOTP works without ADMIN_RP_ID. */
  rp: () => Promise<RelyingParty>;
  now: () => Date;
  verifyAuthentication?: VerifyAuthentication;
};

export type StepUpProof = { kind: "passkey"; response: AuthenticationResponseJSON } | { kind: "totp"; code: string };

export type StepUpChallenge = {
  id: string;
  /** For the browser's passkey prompt; null without a passkey. */
  passkeyOptions: PublicKeyCredentialRequestOptionsJSON | null;
  /** Whether an authenticator-app code can answer. */
  totp: boolean;
};

export type StepUpResult = { ok: true; token: string } | { ok: false; reason: "wrong" | "expired" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const field = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" && value.length <= MAX_FIELD ? value : null;

export async function beginStepUp(
  deps: StepUpDeps,
  staff: Staff,
  action: string,
  targetId: string,
): Promise<StepUpChallenge> {
  const a = field(action);
  const t = field(targetId);
  if (!a || !t || PENDING_ENROL_ACTIONS.includes(a)) throw new StepUpError("Not an action that can be confirmed");
  const now = deps.now();

  const { rows: wrong } = await deps.db.query(
    `SELECT count(*)::int AS n FROM admin_step_ups
      WHERE user_id = $1 AND action <> ALL($2::text[]) AND verified_at IS NULL AND used_at > $3`,
    [staff.userId, PENDING_ENROL_ACTIONS, new Date(now.getTime() - WRONG_WINDOW_MS)],
  );
  if (Number(wrong[0]!.n) >= MAX_WRONG) throw new StepUpError("Too many wrong answers. Try again in 15 minutes");

  const { rows: creds } = await deps.db.query(
    `SELECT kind, credential_id, transports FROM admin_credentials WHERE user_id = $1 ORDER BY created_at, id`,
    [staff.userId],
  );
  const passkeys = creds.filter((c) => c.kind === "passkey");
  const passkeyOptions =
    passkeys.length > 0
      ? await generateAuthenticationOptions({
          rpID: (await deps.rp()).rpID,
          allowCredentials: passkeys.map((c) => ({
            id: String(c.credential_id),
            transports: (c.transports as string[] | null) ?? [],
          })),
          userVerification: "required",
        })
      : null;

  const { rows } = await deps.db.query(
    `INSERT INTO admin_step_ups (user_id, action, target_id, challenge, expires_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      staff.userId,
      a,
      t,
      passkeyOptions?.challenge ?? randomBytes(32).toString("base64url"),
      new Date(now.getTime() + STEP_UP_TTL_MS),
    ],
  );
  return { id: String(rows[0]!.id), passkeyOptions, totp: creds.some((c) => c.kind === "totp") };
}

export async function completeStepUp(
  deps: StepUpDeps,
  staff: Staff,
  id: string,
  proof: StepUpProof,
): Promise<StepUpResult> {
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, reason: "expired" };
  const now = deps.now();

  // Spend the try before checking it.
  const { rows } = await deps.db.query(
    `UPDATE admin_step_ups SET used_at = $3
      WHERE id = $1 AND user_id = $2 AND action <> ALL($4::text[])
        AND verified_at IS NULL AND used_at IS NULL AND expires_at > $3
      RETURNING challenge`,
    [id, staff.userId, now, PENDING_ENROL_ACTIONS],
  );
  if (rows.length !== 1) return { ok: false, reason: "expired" };

  const kind = await checkProof(deps, staff, String(rows[0]!.challenge), proof, now);
  if (!kind) return { ok: false, reason: "wrong" };

  await deps.db.query(
    `UPDATE admin_step_ups SET verified_at = $2, verified_kind = $3, used_at = NULL WHERE id = $1 AND verified_at IS NULL`,
    [id, now, kind],
  );
  return { ok: true, token: id };
}

/**
 * Spends a verified step-up for this staff member, action and target. Throws
 * a StepUpError unless it is all of those, unspent, and verified less than
 * five minutes before `now`. Single use, also when two requests race.
 */
export async function consumeStepUp(
  db: Queryable,
  i: { token: string; userId: string; action: string; targetId: string; now: Date },
): Promise<"passkey" | "totp"> {
  if (typeof i.token !== "string" || !UUID.test(i.token) || PENDING_ENROL_ACTIONS.includes(i.action)) {
    throw new StepUpError();
  }
  const { rows } = await db.query(
    `UPDATE admin_step_ups SET used_at = $5
      WHERE id = $1 AND user_id = $2 AND action = $3 AND target_id = $4
        AND action <> ALL($7::text[])
        AND verified_kind IN ('passkey', 'totp') AND verified_at > $6
        AND used_at IS NULL
      RETURNING verified_kind`,
    [i.token, i.userId, i.action, i.targetId, i.now, new Date(i.now.getTime() - STEP_UP_TTL_MS), PENDING_ENROL_ACTIONS],
  );
  if (rows.length !== 1) throw new StepUpError();
  return rows[0]!.verified_kind as "passkey" | "totp";
}

/** Enrolment's gate for a staff member who has credentials: a step-up for "security.enrol" on themselves. */
export function enrolStepUp(db: Queryable, now: () => Date): RequireStepUp {
  return async (staff, token) => {
    try {
      await consumeStepUp(db, { token, userId: staff.userId, action: ENROL_ACTION, targetId: staff.userId, now: now() });
    } catch (error) {
      if (error instanceof StepUpError) throw new EnrolRefused("step-up");
      throw error;
    }
  };
}

// ---------------------------------------------------------------------------
// Proofs
// ---------------------------------------------------------------------------

async function checkProof(
  deps: StepUpDeps,
  staff: Staff,
  challenge: string,
  proof: StepUpProof,
  now: Date,
): Promise<"passkey" | "totp" | null> {
  if (proof?.kind === "totp" && typeof proof.code === "string") return (await checkTotp(deps, staff, proof.code, now)) ? "totp" : null;
  if (proof?.kind === "passkey" && typeof proof.response?.id === "string") {
    return (await checkPasskey(deps, staff, challenge, proof.response, now)) ? "passkey" : null;
  }
  return null;
}

/** Any of the staff member's authenticator apps, at a time step later than its last accepted code. */
async function checkTotp(deps: StepUpDeps, staff: Staff, code: string, now: Date): Promise<boolean> {
  const { rows } = await deps.db.query(
    `SELECT id, totp_secret_enc FROM admin_credentials WHERE user_id = $1 AND kind = 'totp' ORDER BY created_at, id`,
    [staff.userId],
  );
  for (const row of rows) {
    const step = totpStep(decryptSecret(String(row.totp_secret_enc), deps.totpKey), code, now);
    if (step === null) continue;
    const { rows: accepted } = await deps.db.query(
      `UPDATE admin_credentials SET counter = $2, last_used_at = $3 WHERE id = $1 AND counter < $2 RETURNING id`,
      [row.id, step, now],
    );
    if (accepted.length === 1) return true;
  }
  return false;
}

/** The staff member's own passkey, verified against its stored key and counter; the counter then moves on. */
async function checkPasskey(
  deps: StepUpDeps,
  staff: Staff,
  challenge: string,
  response: AuthenticationResponseJSON,
  now: Date,
): Promise<boolean> {
  const { rows } = await deps.db.query(
    `SELECT id, credential_id, public_key, counter, transports FROM admin_credentials
      WHERE user_id = $1 AND kind = 'passkey' AND credential_id = $2`,
    [staff.userId, response.id],
  );
  const row = rows[0];
  if (!row) return false;

  const rp = await deps.rp();
  const verify = deps.verifyAuthentication ?? verifyAuthenticationResponse;
  const result = await verify({
    response,
    expectedChallenge: challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    credential: {
      id: String(row.credential_id),
      publicKey: new Uint8Array(row.public_key as Buffer),
      counter: Number(row.counter),
      transports: (row.transports as string[] | null) ?? [],
    },
    requireUserVerification: true,
  }).catch(() => ({ verified: false as const }));
  if (!result.verified) return false;

  await deps.db.query(
    `UPDATE admin_credentials SET counter = GREATEST(counter, $2), last_used_at = $3 WHERE id = $1`,
    [row.id, result.authenticationInfo.newCounter, now],
  );
  return true;
}
