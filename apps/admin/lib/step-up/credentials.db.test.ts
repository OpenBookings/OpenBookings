/**
 * Step-up credentials and their enrolment (packages/db/drizzle/0060_admin_production.sql),
 * run as the roles the console uses: enrolment as ob_admin_write (a server
 * action), the /security list as ob_admin_read (a page).
 * Each test runs in a transaction that is rolled back.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import * as OTPAuth from "otpauth";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, pendingMigrationSql } from "@openbookings/db/testing";
import type { Staff } from "../staff";
import { StepUpConfigError } from "./config";
import { listCredentials } from "./credentials";
import { decryptSecret } from "./crypto";
import {
  completePasskeyEnrolment,
  completeTotpEnrolment,
  EnrolRefused,
  startPasskeyEnrolment,
  startTotpEnrolment,
  stepUpNotAvailable,
  type EnrolDeps,
  type RequireStepUp,
} from "./enrol";

const BOOTSTRAP = "correct horse battery staple";
const TOTP_KEY = randomBytes(32).toString("base64");
const RP = { rpID: "admin.example.test", origin: "https://admin.example.test" };

describeWithDb("step-up credentials and enrolment", () => {
  let db: Client;
  let staff: Staff;

  const deps = (over: Partial<EnrolDeps> = {}): EnrolDeps => ({
    db,
    bootstrapCode: BOOTSTRAP,
    totpKey: TOTP_KEY,
    requireStepUp: stepUpNotAvailable,
    now: () => new Date(),
    ...over,
  });

  /** The refusal reason, or "ok". */
  async function outcome(fn: () => Promise<unknown>): Promise<string> {
    await db.query("SAVEPOINT outcome");
    try {
      await fn();
      await db.query("RELEASE SAVEPOINT outcome");
      return "ok";
    } catch (error) {
      await db.query("ROLLBACK TO SAVEPOINT outcome");
      if (error instanceof EnrolRefused) return error.reason;
      throw error;
    }
  }

  /** Starts and finishes a TOTP enrolment the way the authenticator app would. */
  async function enrolTotp(d: EnrolDeps, proof: { bootstrap?: string; stepUpToken?: string }) {
    const { uri } = await startTotpEnrolment(d, staff, proof);
    const totp = OTPAuth.URI.parse(uri) as OTPAuth.TOTP;
    await completeTotpEnrolment(d, staff, totp.generate());
    return totp.secret.base32;
  }

  beforeAll(async () => {
    db = new Client({ connectionString });
    await db.connect();
  });
  afterAll(async () => {
    await db.end();
  });
  beforeEach(async () => {
    await db.query("BEGIN");
    await applyPendingMigrations(db);
    // The roles and their schema grants, again: a database rebuilt from a
    // schema dump may lack them. 0058 renamed columns 0054 grants on. Rolled back.
    await db.query(
      pendingMigrationSql("0054_admin_roles.sql").replace(
        "accommodation_amount, tourist_tax_amount",
        "accommodation_cents, tourist_tax_cents",
      ),
    );
    // No "user" row: the development bypass's staff is userId "dev", so there is no foreign key.
    staff = { userId: `staff-${crypto.randomUUID()}`, email: "staff@example.test" };
    await db.query("SET LOCAL ROLE ob_admin_write");
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("stores a TOTP credential encrypted and lists it without the secret", async () => {
    const secret = await enrolTotp(deps(), { bootstrap: BOOTSTRAP });

    await db.query("RESET ROLE");
    const stored = (await db.query(`SELECT totp_secret_enc FROM admin_credentials WHERE user_id = $1`, [staff.userId]))
      .rows[0]!.totp_secret_enc as string;
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain(secret);
    expect(decryptSecret(stored, TOTP_KEY)).toBe(secret);

    await db.query("SET LOCAL ROLE ob_admin_read");
    const listed = await listCredentials(db, staff.userId);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ kind: "totp", label: "Authenticator app", lastUsedAt: null });
    expect(Object.keys(listed[0]!).sort()).toEqual(["createdAt", "id", "kind", "label", "lastUsedAt"]);

    await db.query("SAVEPOINT denied");
    const denied = await db.query(`SELECT totp_secret_enc FROM admin_credentials`).then(
      () => null,
      (error: Error) => error.message,
    );
    await db.query("ROLLBACK TO SAVEPOINT denied");
    expect(denied).toMatch(/permission denied/);
  });

  test("first enrolment without the bootstrap code is refused", async () => {
    expect(await outcome(() => startTotpEnrolment(deps(), staff, {}))).toBe("bootstrap");
    expect(await outcome(() => startTotpEnrolment(deps(), staff, { bootstrap: "wrong" }))).toBe("bootstrap");
    expect(await outcome(() => startTotpEnrolment(deps(), staff, { bootstrap: `${BOOTSTRAP}x` }))).toBe("bootstrap");
    expect(await outcome(() => startPasskeyEnrolment(deps(), staff, {}, RP))).toBe("bootstrap");
    // A step-up is no way in without credentials to step up with.
    const anyStepUp: RequireStepUp = async () => {};
    expect(await outcome(() => startTotpEnrolment(deps({ requireStepUp: anyStepUp }), staff, { stepUpToken: "t" }))).toBe(
      "bootstrap",
    );
    // An unset or empty ADMIN_BOOTSTRAP_CODE makes bootstrap impossible, never "matches empty".
    for (const bootstrapCode of [undefined, "", "  "]) {
      expect(await outcome(() => startTotpEnrolment(deps({ bootstrapCode }), staff, { bootstrap: "" }))).toBe("bootstrap");
      expect(await outcome(() => startTotpEnrolment(deps({ bootstrapCode }), staff, { bootstrap: "  " }))).toBe("bootstrap");
    }
    // Finishing needs a started enrolment.
    expect(await outcome(() => completeTotpEnrolment(deps(), staff, "123456"))).toBe("expired");
    expect(await listCredentials(db, staff.userId)).toEqual([]);
  });

  test("first enrolment with the bootstrap code succeeds", async () => {
    const { uri, secretPreview } = await startTotpEnrolment(deps(), staff, { bootstrap: BOOTSTRAP });
    const totp = OTPAuth.URI.parse(uri) as OTPAuth.TOTP;
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(secretPreview.replaceAll(" ", "")).toBe(totp.secret.base32);

    const right = totp.generate();
    expect(await outcome(() => completeTotpEnrolment(deps(), staff, right === "000000" ? "111111" : "000000"))).toBe(
      "wrong-code",
    );
    // Five minutes later the started enrolment is gone.
    const later = () => new Date(Date.now() + 5 * 60_000 + 1_000);
    expect(await outcome(() => completeTotpEnrolment(deps({ now: later }), staff, totp.generate()))).toBe("expired");
    // It belongs to this staff member only.
    const other: Staff = { userId: `staff-${crypto.randomUUID()}`, email: "other@example.test" };
    expect(await outcome(() => completeTotpEnrolment(deps(), other, totp.generate()))).toBe("expired");

    await completeTotpEnrolment(deps(), staff, totp.generate());
    expect((await listCredentials(db, staff.userId)).map((c) => c.kind)).toEqual(["totp"]);
    // Single use: the same started enrolment cannot add a second credential.
    expect(await outcome(() => completeTotpEnrolment(deps(), staff, totp.generate()))).toBe("expired");
  });

  test("second enrolment needs a step-up, not the bootstrap code", async () => {
    await enrolTotp(deps(), { bootstrap: BOOTSTRAP });

    // Until step-ups exist (Task 4), a second enrolment is refused outright.
    const refused = await startTotpEnrolment(deps(), staff, { stepUpToken: "t" }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(EnrolRefused);
    expect((refused as Error).message).toBe("Step-up not available yet");

    const calls: [Staff, string][] = [];
    const stub: RequireStepUp = async (who, token) => {
      calls.push([who, token]);
      if (token !== "fresh") throw new EnrolRefused("step-up");
    };
    const d = deps({ requireStepUp: stub });
    expect(await outcome(() => startTotpEnrolment(d, staff, { bootstrap: BOOTSTRAP }))).toBe("step-up");
    expect(await outcome(() => startPasskeyEnrolment(d, staff, { bootstrap: BOOTSTRAP }, RP))).toBe("step-up");
    expect(await outcome(() => startTotpEnrolment(d, staff, { stepUpToken: "spent" }))).toBe("step-up");
    expect(calls).toEqual([[staff, "spent"]]);

    await enrolTotp(d, { stepUpToken: "fresh" });
    expect(calls.at(-1)).toEqual([staff, "fresh"]);
    expect(await listCredentials(db, staff.userId)).toHaveLength(2);
  });

  test("a passkey is stored from a verified registration against a single-use challenge", async () => {
    const options = await startPasskeyEnrolment(deps(), staff, { bootstrap: BOOTSTRAP }, RP);
    expect(options.rp.id).toBe(RP.rpID);
    expect(options.user.name).toBe(staff.email);

    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin: RP.origin }),
    ).toString("base64url");
    const response = {
      id: "cred-1",
      rawId: "cred-1",
      type: "public-key" as const,
      clientExtensionResults: {},
      response: { clientDataJSON, attestationObject: "" },
    };
    const seen: unknown[] = [];
    const verify = async (o: { expectedChallenge: unknown; expectedOrigin: unknown; expectedRPID?: unknown }) => {
      seen.push([o.expectedChallenge, o.expectedOrigin, o.expectedRPID]);
      return {
        verified: true as const,
        registrationInfo: {
          credential: { id: "cred-1", publicKey: new Uint8Array([1, 2, 3]), counter: 7, transports: ["internal" as const] },
        },
      };
    };

    await completePasskeyEnrolment(deps(), staff, response, RP, verify);
    expect(seen).toEqual([[options.challenge, RP.origin, RP.rpID]]);
    const listed = await listCredentials(db, staff.userId);
    expect(listed.map((c) => [c.kind, c.label])).toEqual([["passkey", "Passkey"]]);
    await db.query("RESET ROLE");
    const row = (await db.query(`SELECT credential_id, public_key, counter, transports FROM admin_credentials WHERE user_id = $1`, [
      staff.userId,
    ])).rows[0]!;
    expect(row).toEqual({ credential_id: "cred-1", public_key: Buffer.from([1, 2, 3]), counter: "7", transports: ["internal"] });
    await db.query("SET LOCAL ROLE ob_admin_write");

    // The challenge is spent, and a made-up one was never issued.
    expect(await outcome(() => completePasskeyEnrolment(deps(), staff, response, RP, verify))).toBe("expired");
    const forged = { ...response, response: { ...response.response, clientDataJSON: Buffer.from("{}").toString("base64url") } };
    expect(await outcome(() => completePasskeyEnrolment(deps(), staff, forged, RP, verify))).toBe("expired");
    expect(seen).toHaveLength(1);

    // A registration the verifier rejects stores nothing.
    const again = await startPasskeyEnrolment(deps({ requireStepUp: async () => {} }), staff, { stepUpToken: "t" }, RP);
    const rejected = {
      ...response,
      response: {
        ...response.response,
        clientDataJSON: Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: again.challenge })).toString("base64url"),
      },
    };
    const no = async () => ({ verified: false as const });
    expect(await outcome(() => completePasskeyEnrolment(deps(), staff, rejected, RP, no))).toBe("not-verified");
    expect(await listCredentials(db, staff.userId)).toHaveLength(1);
  });

  test("an enrolment begun with the bootstrap code cannot finish once a credential exists", async () => {
    const options = await startPasskeyEnrolment(deps(), staff, { bootstrap: BOOTSTRAP }, RP);
    // Meanwhile the first credential is added: the bootstrap code no longer lets anyone in.
    await enrolTotp(deps(), { bootstrap: BOOTSTRAP });

    let verified = 0;
    const verify = async () => {
      verified++;
      return {
        verified: true as const,
        registrationInfo: { credential: { id: "cred-late", publicKey: new Uint8Array([1]), counter: 0 } },
      };
    };
    expect(await outcome(() => completePasskeyEnrolment(deps(), staff, passkeyResponse(options.challenge, "cred-late"), RP, verify))).toBe(
      "step-up",
    );
    expect(verified).toBe(0);
    expect((await listCredentials(db, staff.userId)).map((c) => c.kind)).toEqual(["totp"]);
  });

  test("a passkey already registered (to anyone) is refused, not a crash", async () => {
    const verify = async () => ({
      verified: true as const,
      registrationInfo: { credential: { id: "cred-shared", publicKey: new Uint8Array([1]), counter: 0 } },
    });
    const first = await startPasskeyEnrolment(deps(), staff, { bootstrap: BOOTSTRAP }, RP);
    await completePasskeyEnrolment(deps(), staff, passkeyResponse(first.challenge, "cred-shared"), RP, verify);

    const other: Staff = { userId: `staff-${crypto.randomUUID()}`, email: "other@example.test" };
    const second = await startPasskeyEnrolment(deps(), other, { bootstrap: BOOTSTRAP }, RP);
    // The refused insert aborts the test's transaction; the console runs it on its own.
    await db.query("SAVEPOINT duplicate");
    const refused = await completePasskeyEnrolment(deps(), other, passkeyResponse(second.challenge, "cred-shared"), RP, verify)
      .then(() => null)
      .catch((e: unknown) => e);
    await db.query("ROLLBACK TO SAVEPOINT duplicate");
    expect(refused).toBeInstanceOf(EnrolRefused);
    expect((refused as EnrolRefused).reason).toBe("duplicate");
    expect((refused as Error).message).toBe("This passkey is already registered");
    expect(await listCredentials(db, other.userId)).toEqual([]);
  });

  test("a missing ADMIN_TOTP_KEY is a configuration error that names it", async () => {
    const refused = await startTotpEnrolment(deps({ totpKey: "" }), staff, { bootstrap: BOOTSTRAP }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(StepUpConfigError);
    expect((refused as Error).message).toMatch(/^ADMIN_TOTP_KEY is not set/);
  });
});

/** What the browser returns after registering a passkey for `challenge`. */
function passkeyResponse(challenge: string, id: string) {
  const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge })).toString("base64url");
  return {
    id,
    rawId: id,
    type: "public-key" as const,
    clientExtensionResults: {},
    response: { clientDataJSON, attestationObject: "" },
  };
}
