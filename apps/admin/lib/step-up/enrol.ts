import { timingSafeEqual } from "node:crypto";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type PublicKeyCredentialCreationOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import * as OTPAuth from "otpauth";
import type { Queryable, Staff } from "../staff";
import {
  hasCredentials,
  insertPasskeyCredential,
  insertTotpCredential,
  passkeyIds,
  type AdminCredential,
} from "./credentials";
import { decryptSecret, encryptSecret } from "./crypto";

/**
 * Enrolling a passkey or an authenticator app for step-up.
 *
 * Who may enrol: a staff member with no credentials yet presents
 * ADMIN_BOOTSTRAP_CODE; one who has credentials presents a fresh step-up for
 * "security.enrol" instead, so a stolen Access session cannot add its own
 * second factor. The check runs when the enrolment starts. Starting leaves a
 * pending challenge in admin_step_ups, bound to the staff member, valid for
 * five minutes and used once; finishing needs that challenge, so it carries
 * the check over.
 */

export const ENROL_ACTION = "security.enrol";
const PENDING_PASSKEY = "security.enrol-passkey";
const PENDING_TOTP = "security.enrol-totp";
const PENDING_TTL_MS = 5 * 60_000;

const RP_NAME = "OpenBookings admin";
const TOTP_ISSUER = "OpenBookings admin";

export type EnrolRefusal = "bootstrap" | "step-up" | "expired" | "wrong-code" | "not-verified";

const REFUSAL_MESSAGE: Record<EnrolRefusal, string> = {
  bootstrap: "The bootstrap code is not right",
  "step-up": "Confirm with an existing passkey or authenticator app first",
  expired: "This enrolment expired. Start again",
  "wrong-code": "That code is not right",
  "not-verified": "The passkey could not be verified",
};

/** An expected refusal: the action shows its message instead of failing. */
export class EnrolRefused extends Error {
  constructor(
    readonly reason: EnrolRefusal,
    message: string = REFUSAL_MESSAGE[reason],
  ) {
    super(message);
    this.name = "EnrolRefused";
  }
}

/**
 * Checks and spends a step-up token for "security.enrol" on the staff
 * member's own credentials. Throws (an EnrolRefused) when it is not valid.
 */
export type RequireStepUp = (staff: Staff, token: string) => Promise<void>;

/** The production wiring until step-ups exist: a second enrolment is refused, never allowed. */
export const stepUpNotAvailable: RequireStepUp = async () => {
  throw new EnrolRefused("step-up", "Step-up not available yet");
};

export type EnrolProof = { bootstrap?: string; stepUpToken?: string };

export type EnrolDeps = {
  db: Queryable;
  /** ADMIN_BOOTSTRAP_CODE. Unset or blank: bootstrap is impossible. */
  bootstrapCode: string | undefined;
  /** ADMIN_TOTP_KEY. */
  totpKey: string;
  requireStepUp: RequireStepUp;
  now: () => Date;
};

export type RelyingParty = { rpID: string; origin: string };

/** Constant-time; an unset or blank expected code never matches. */
export function bootstrapMatches(given: string | undefined, expected: string | undefined): boolean {
  const code = expected?.trim();
  if (!code || typeof given !== "string") return false;
  const a = Buffer.from(given.trim(), "utf8");
  const b = Buffer.from(code, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The WebAuthn relying party: ADMIN_RP_ID, else the request's host name.
 * Production origins are always https; development allows the dev server's own origin.
 */
export function relyingParty(env: Record<string, string | undefined>, host: string | null): RelyingParty {
  const hostName = (host ?? "").replace(/:\d+$/, "");
  const rpID = env.ADMIN_RP_ID?.trim() || hostName;
  if (!rpID) throw new Error("No relying party: set ADMIN_RP_ID");
  const origin = env.NODE_ENV === "production" || !host ? `https://${rpID}` : `http://${host}`;
  return { rpID, origin };
}

async function checkEnrolGate(deps: EnrolDeps, staff: Staff, proof: EnrolProof): Promise<void> {
  if (!(await hasCredentials(deps.db, staff.userId))) {
    if (!bootstrapMatches(proof.bootstrap, deps.bootstrapCode)) throw new EnrolRefused("bootstrap");
    return;
  }
  if (!proof.stepUpToken) throw new EnrolRefused("step-up");
  await deps.requireStepUp(staff, proof.stepUpToken);
}

async function addPending(deps: EnrolDeps, staff: Staff, action: string, challenge: string): Promise<void> {
  await deps.db.query(
    `INSERT INTO admin_step_ups (user_id, action, target_id, challenge, expires_at) VALUES ($1, $2, $1, $3, $4)`,
    [staff.userId, action, challenge, new Date(deps.now().getTime() + PENDING_TTL_MS)],
  );
}

/** Marks one pending challenge used; false when it was spent, expired or never issued to this staff member. */
async function spendPending(deps: EnrolDeps, staff: Staff, action: string, match: { id?: string; challenge?: string }) {
  const { rows } = await deps.db.query(
    `UPDATE admin_step_ups SET used_at = $3
      WHERE user_id = $1 AND action = $2 AND used_at IS NULL AND expires_at > $3
        AND ($4::uuid IS NULL OR id = $4::uuid) AND ($5::text IS NULL OR challenge = $5)
      RETURNING id`,
    [staff.userId, action, deps.now(), match.id ?? null, match.challenge ?? null],
  );
  return rows.length === 1;
}

// ---------------------------------------------------------------------------
// Authenticator app (TOTP)
// ---------------------------------------------------------------------------

const totpFor = (staff: Staff, secret: OTPAuth.Secret) =>
  new OTPAuth.TOTP({ issuer: TOTP_ISSUER, label: staff.email, algorithm: "SHA1", digits: 6, period: 30, secret });

/** A new secret for the authenticator app: the otpauth:// URI (for the QR code) and the secret to type in. */
export async function startTotpEnrolment(
  deps: EnrolDeps,
  staff: Staff,
  proof: EnrolProof,
): Promise<{ uri: string; secretPreview: string }> {
  await checkEnrolGate(deps, staff, proof);
  const secret = new OTPAuth.Secret({ size: 20 });
  await addPending(deps, staff, PENDING_TOTP, encryptSecret(secret.base32, deps.totpKey));
  return { uri: totpFor(staff, secret).toString(), secretPreview: secret.base32.replace(/(.{4})(?=.)/g, "$1 ") };
}

/** Stores the authenticator app once it shows a current code for the pending secret. */
export async function completeTotpEnrolment(deps: EnrolDeps, staff: Staff, code: string): Promise<AdminCredential> {
  const { rows } = await deps.db.query(
    `SELECT id, challenge FROM admin_step_ups
      WHERE user_id = $1 AND action = $2 AND used_at IS NULL AND expires_at > $3
      ORDER BY created_at DESC LIMIT 1`,
    [staff.userId, PENDING_TOTP, deps.now()],
  );
  const pending = rows[0];
  if (!pending) throw new EnrolRefused("expired");

  const base32 = decryptSecret(String(pending.challenge), deps.totpKey);
  const token = code.replace(/\s/g, "");
  const ok =
    /^\d{6}$/.test(token) &&
    totpFor(staff, OTPAuth.Secret.fromBase32(base32)).validate({ token, timestamp: deps.now().getTime(), window: 1 }) !== null;
  if (!ok) throw new EnrolRefused("wrong-code");

  if (!(await spendPending(deps, staff, PENDING_TOTP, { id: String(pending.id) }))) throw new EnrolRefused("expired");
  return insertTotpCredential(deps.db, {
    userId: staff.userId,
    secretEnc: encryptSecret(base32, deps.totpKey),
    label: "Authenticator app",
  });
}

// ---------------------------------------------------------------------------
// Passkey (WebAuthn)
// ---------------------------------------------------------------------------

export type VerifyRegistration = (o: {
  response: RegistrationResponseJSON;
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRPID: string;
  requireUserVerification: boolean;
}) => Promise<
  | { verified: false }
  | {
      verified: true;
      registrationInfo: { credential: { id: string; publicKey: Uint8Array; counter: number; transports?: string[] } };
    }
>;

/** Registration options for the browser; the challenge stays on the server. */
export async function startPasskeyEnrolment(
  deps: EnrolDeps,
  staff: Staff,
  proof: EnrolProof,
  rp: RelyingParty,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  await checkEnrolGate(deps, staff, proof);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpID,
    userName: staff.email,
    userID: new TextEncoder().encode(staff.userId),
    attestationType: "none",
    excludeCredentials: (await passkeyIds(deps.db, staff.userId)).map((c) => ({
      id: c.id,
      transports: c.transports,
    })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
  });
  await addPending(deps, staff, PENDING_PASSKEY, options.challenge);
  return options;
}

/** The challenge the browser signed, read from its client data; null when unreadable. */
function signedChallenge(response: RegistrationResponseJSON): string | null {
  try {
    const data = JSON.parse(Buffer.from(response.response.clientDataJSON, "base64url").toString("utf8")) as {
      challenge?: unknown;
    };
    return typeof data.challenge === "string" && data.challenge !== "" ? data.challenge : null;
  } catch {
    return null;
  }
}

/** Stores the passkey once the browser's registration verifies against a challenge we issued to this staff member. */
export async function completePasskeyEnrolment(
  deps: EnrolDeps,
  staff: Staff,
  response: RegistrationResponseJSON,
  rp: RelyingParty,
  verify: VerifyRegistration = verifyRegistrationResponse,
): Promise<AdminCredential> {
  const challenge = signedChallenge(response);
  // Spent before verifying: one try per challenge.
  if (!challenge || !(await spendPending(deps, staff, PENDING_PASSKEY, { challenge }))) {
    throw new EnrolRefused("expired");
  }
  const result = await verify({
    response,
    expectedChallenge: challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    requireUserVerification: true,
  }).catch(() => ({ verified: false as const }));
  if (!result.verified) throw new EnrolRefused("not-verified");

  const { credential } = result.registrationInfo;
  return insertPasskeyCredential(deps.db, {
    userId: staff.userId,
    credentialId: credential.id,
    publicKey: credential.publicKey,
    counter: credential.counter,
    transports: credential.transports ?? [],
    label: "Passkey",
  });
}
