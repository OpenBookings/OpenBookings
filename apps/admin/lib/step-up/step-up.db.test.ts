/**
 * Step-ups (admin_step_ups, migration 0060): begun and completed as
 * ob_admin_write, like the server actions that run them. Each test runs in a
 * transaction that is rolled back, except the race at the end, which needs
 * two connections and commits (and deletes) its own rows.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import * as OTPAuth from "otpauth";
import { Client, Pool } from "pg";
import {
  applyPendingMigrations,
  connectionString,
  describeWithDb,
  ensureCommittedMigrations,
  pendingMigrationSql,
} from "@openbookings/db/testing";
import type { Staff } from "../staff";
import { StepUpConfigError } from "./config";
import { listCredentials } from "./credentials";
import { encryptSecret } from "./crypto";
import {
  completePasskeyEnrolment,
  completeTotpEnrolment,
  EnrolRefused,
  ENROL_ACTION,
  startPasskeyEnrolment,
  startTotpEnrolment,
  type EnrolDeps,
} from "./enrol";
import {
  beginStepUp,
  completeStepUp,
  consumeStepUp,
  enrolStepUp,
  STEP_UP_TTL_MS,
  StepUpError,
  type StepUpDb,
  type StepUpDeps,
  type StepUpProof,
  type VerifyAuthentication,
} from "./step-up";

const BOOTSTRAP = "correct horse battery staple";
const TOTP_KEY = randomBytes(32).toString("base64");
const RP = { rpID: "admin.example.test", origin: "https://admin.example.test" };
const ACTION = "booking.cancel";
const TARGET = "booking-1";

describeWithDb("step-up challenges", () => {
  let db: Client;
  let staff: Staff;
  /** The clock every call sees; tests move it. */
  let now: Date;

  const enrolDeps = (over: Partial<EnrolDeps> = {}): EnrolDeps => ({
    db,
    bootstrapCode: BOOTSTRAP,
    totpKey: TOTP_KEY,
    requireStepUp: async () => {
      throw new EnrolRefused("step-up");
    },
    now: () => now,
    ...over,
  });

  /** The test's connection, with transactions as savepoints inside the test's own. */
  const txDb = (): StepUpDb => ({
    query: (text, values) => db.query(text, values),
    transaction: async (fn) => {
      await db.query("SAVEPOINT step_up_tx");
      try {
        const result = await fn(db);
        await db.query("RELEASE SAVEPOINT step_up_tx");
        return result;
      } catch (error) {
        await db.query("ROLLBACK TO SAVEPOINT step_up_tx");
        throw error;
      }
    },
  });

  const deps = (over: Partial<StepUpDeps> = {}): StepUpDeps => ({
    db: txDb(),
    totpKey: TOTP_KEY,
    rp: async () => RP,
    now: () => now,
    verifyAuthentication: async () => {
      throw new Error("no passkey expected");
    },
    ...over,
  });

  const consume = (token: string, over: Partial<{ userId: string; action: string; targetId: string; now: Date }> = {}) =>
    consumeStepUp(db, { token, userId: staff.userId, action: ACTION, targetId: TARGET, now, ...over });

  /** What consume made of it: the proof's kind, or "refused". */
  async function consumed(token: string, over: Parameters<typeof consume>[1] = {}): Promise<string> {
    await db.query("SAVEPOINT consume");
    try {
      const kind = await consume(token, over);
      await db.query("RELEASE SAVEPOINT consume");
      return kind;
    } catch (error) {
      await db.query("ROLLBACK TO SAVEPOINT consume");
      if (error instanceof StepUpError) return "refused";
      throw error;
    }
  }

  /** Enrols an authenticator app with the bootstrap code; its TOTP. */
  async function enrolTotp(who: Staff = staff): Promise<OTPAuth.TOTP> {
    const { uri } = await startTotpEnrolment(enrolDeps(), who, { bootstrap: BOOTSTRAP });
    const totp = OTPAuth.URI.parse(uri) as OTPAuth.TOTP;
    await completeTotpEnrolment(enrolDeps(), who, totp.generate({ timestamp: now.getTime() }));
    return totp;
  }

  /** The code the app shows `seconds` from now. */
  const codeIn = (totp: OTPAuth.TOTP, seconds: number) => totp.generate({ timestamp: now.getTime() + seconds * 1000 });
  const later = (seconds: number) => {
    now = new Date(now.getTime() + seconds * 1000);
  };

  /** Begins a step-up that must not be refused. */
  async function begin(action: string, targetId: string, d: StepUpDeps = deps()) {
    const begun = await beginStepUp(d, staff, action, targetId);
    if (!begun.ok) throw new Error(`step-up not begun: ${begun.message}`);
    return begun;
  }

  /** Begins and completes a step-up with the app's current code; the token. */
  async function stepUpWithTotp(totp: OTPAuth.TOTP, action = ACTION, targetId = TARGET): Promise<string> {
    const { id } = await begin(action, targetId);
    const result = await completeStepUp(deps(), staff, id, { kind: "totp", code: codeIn(totp, 0) });
    if (!result.ok) throw new Error(`step-up refused: ${result.reason}`);
    return result.token;
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
    // As in credentials.db.test.ts: the roles and their grants, again (rolled back).
    await db.query(
      pendingMigrationSql("0054_admin_roles.sql").replace(
        "accommodation_amount, tourist_tax_amount",
        "accommodation_cents, tourist_tax_cents",
      ),
    );
    staff = { userId: `staff-${crypto.randomUUID()}`, email: "staff@example.test" };
    // Mid-window, so the codes of the windows either side are well defined.
    now = new Date(Math.floor(Date.now() / 30_000) * 30_000 + 15_000);
    await db.query("SET LOCAL ROLE ob_admin_write");
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("a correct TOTP code verifies the step-up", async () => {
    const totp = await enrolTotp();
    later(60);
    const begun = await begin(ACTION, TARGET);
    expect(begun.passkeyOptions).toBeNull();
    expect(begun.totp).toBe(true);

    expect(await completeStepUp(deps(), staff, begun.id, { kind: "totp", code: codeIn(totp, 0) })).toEqual({
      ok: true,
      token: begun.id,
    });
    expect(await consumed(begun.id)).toBe("totp");
    const [cred] = await listCredentials(db, staff.userId);
    expect(cred!.lastUsedAt).toEqual(now);
  });

  test("a wrong code is refused", async () => {
    const totp = await enrolTotp();
    later(60);
    const right = codeIn(totp, 0);
    const wrong = right === "000000" ? "111111" : "000000";

    const begun = await begin(ACTION, TARGET);
    expect(await completeStepUp(deps(), staff, begun.id, { kind: "totp", code: wrong })).toMatchObject({
      ok: false,
      reason: "wrong",
    });
    expect(await consumed(begun.id)).toBe("refused");
    // One try per step-up: the right code afterwards needs a new one.
    expect(await completeStepUp(deps(), staff, begun.id, { kind: "totp", code: right })).toMatchObject({
      ok: false,
      reason: "expired",
    });
    // The previous window's code is still accepted.
    const prev = await begin(ACTION, TARGET);
    expect((await completeStepUp(deps(), staff, prev.id, { kind: "totp", code: codeIn(totp, -30) })).ok).toBe(true);
    // Codes from outside the ±1 window, things that are not codes, and other proofs are wrong.
    // (Fifteen minutes apart, to stay under the limit on wrong answers.)
    const proofs: (() => StepUpProof)[] = [
      () => ({ kind: "totp", code: codeIn(totp, -90) }),
      () => ({ kind: "totp", code: codeIn(totp, 90) }),
      () => ({ kind: "totp", code: "12345" }),
      () => ({ kind: "totp", code: "abcdef" }),
      () => ({ kind: "totp", code: "" }),
      () => ({ kind: "sms", code: codeIn(totp, 0) }) as never,
    ];
    for (const proof of proofs) {
      later(15 * 60);
      const again = await begin(ACTION, TARGET);
      expect(await completeStepUp(deps(), staff, again.id, proof())).toMatchObject({ ok: false, reason: "wrong" });
    }
  });

  test("the same TOTP code is refused the second time", async () => {
    const totp = await enrolTotp();
    // The code that enrolled the app is spent already.
    const atEnrolment = await begin(ACTION, TARGET);
    expect(await completeStepUp(deps(), staff, atEnrolment.id, { kind: "totp", code: codeIn(totp, 0) })).toMatchObject({
      ok: false,
      reason: "wrong",
    });

    later(60);
    const code = codeIn(totp, 0);
    const first = await begin(ACTION, TARGET);
    expect((await completeStepUp(deps(), staff, first.id, { kind: "totp", code })).ok).toBe(true);
    const second = await begin(ACTION, TARGET);
    expect(await completeStepUp(deps(), staff, second.id, { kind: "totp", code })).toMatchObject({ ok: false, reason: "wrong" });
    // Nor an older one still inside the window.
    const older = await begin(ACTION, TARGET);
    expect(await completeStepUp(deps(), staff, older.id, { kind: "totp", code: codeIn(totp, -30) })).toMatchObject({
      ok: false,
      reason: "wrong",
    });
    // The next window's code is new.
    later(30);
    expect(await consumed(await stepUpWithTotp(totp))).toBe("totp");
  });

  test("consume refuses another action", async () => {
    const totp = await enrolTotp();
    later(60);
    const token = await stepUpWithTotp(totp);
    expect(await consumed(token, { action: "booking.refund" })).toBe("refused");
    expect(await consumed(token)).toBe("totp");
  });

  test("consume refuses another target", async () => {
    const totp = await enrolTotp();
    later(60);
    const token = await stepUpWithTotp(totp);
    expect(await consumed(token, { targetId: "booking-2" })).toBe("refused");
    expect(await consumed(token)).toBe("totp");
  });

  test("consume refuses another user", async () => {
    const totp = await enrolTotp();
    later(60);
    const token = await stepUpWithTotp(totp);
    expect(await consumed(token, { userId: `staff-${crypto.randomUUID()}` })).toBe("refused");
    // Nor can another staff member complete this staff member's step-up.
    const other: Staff = { userId: `staff-${crypto.randomUUID()}`, email: "other@example.test" };
    const begun = await begin(ACTION, TARGET);
    later(30);
    expect(await completeStepUp(deps(), other, begun.id, { kind: "totp", code: codeIn(totp, 0) })).toMatchObject({
      ok: false,
      reason: "expired",
    });
    expect(await consumed(token)).toBe("totp");
  });

  test("consume refuses after 5 minutes", async () => {
    const totp = await enrolTotp();
    later(60);
    const token = await stepUpWithTotp(totp);
    const verifiedAt = now.getTime();
    expect(await consumed(token, { now: new Date(verifiedAt + STEP_UP_TTL_MS) })).toBe("refused");
    expect(await consumed(token, { now: new Date(verifiedAt + STEP_UP_TTL_MS - 1) })).toBe("totp");
    expect(STEP_UP_TTL_MS).toBe(5 * 60_000);

    // An unanswered step-up cannot be completed after 5 minutes either.
    later(30);
    const begun = await begin(ACTION, TARGET);
    later(5 * 60);
    expect(await completeStepUp(deps(), staff, begun.id, { kind: "totp", code: codeIn(totp, 0) })).toMatchObject({
      ok: false,
      reason: "expired",
    });
  });

  test("consume works once; the second consume of the same token is refused", async () => {
    const totp = await enrolTotp();
    later(60);
    const token = await stepUpWithTotp(totp);
    expect(await consumed(token)).toBe("totp");
    expect(await consumed(token)).toBe("refused");
    // A token that was never completed, or is not a token at all, is refused too.
    const begun = await begin(ACTION, TARGET);
    expect(await consumed(begun.id)).toBe("refused");
    expect(await consumed("not-a-uuid")).toBe("refused");
    expect(await consumed(crypto.randomUUID())).toBe("refused");
  });

  test("enrolment's pending challenges are never a step-up", async () => {
    const totp = await enrolTotp();
    // A pending passkey enrolment, begun the legitimate way (a step-up).
    later(60);
    const enrolToken = await stepUpWithTotp(totp, ENROL_ACTION, staff.userId);
    await startPasskeyEnrolment(enrolDeps({ requireStepUp: enrolStepUp(db, () => now) }), staff, { stepUpToken: enrolToken }, RP);
    later(30);
    await startTotpEnrolment(enrolDeps({ requireStepUp: enrolStepUp(db, () => now) }), staff, {
      stepUpToken: await stepUpWithTotp(totp, ENROL_ACTION, staff.userId),
    });

    await db.query("RESET ROLE");
    const pending = (
      await db.query(`SELECT id, action FROM admin_step_ups WHERE user_id = $1 AND action LIKE 'security.enrol-%' AND used_at IS NULL`, [
        staff.userId,
      ])
    ).rows.map((r) => ({ id: String(r.id), action: String(r.action) }));
    expect(pending.map((p) => p.action).sort()).toEqual(["security.enrol-passkey", "security.enrol-totp"]);
    await db.query("SET LOCAL ROLE ob_admin_write");

    later(30);
    for (const p of pending) {
      expect(await completeStepUp(deps(), staff, p.id, { kind: "totp", code: codeIn(totp, 0) })).toMatchObject({
        ok: false,
        reason: "expired",
      });
      expect(await consumed(p.id, { action: p.action, targetId: staff.userId })).toBe("refused");
    }
    // Even marked verified (which nothing does), consume still refuses them.
    await db.query("RESET ROLE");
    await db.query(`UPDATE admin_step_ups SET verified_at = $2, verified_kind = 'totp' WHERE id = ANY($1::uuid[])`, [
      pending.map((p) => p.id),
      now,
    ]);
    await db.query("SET LOCAL ROLE ob_admin_write");
    for (const p of pending) {
      expect(await consumed(p.id, { action: p.action, targetId: staff.userId })).toBe("refused");
    }
    // And no step-up can be begun under their names.
    for (const action of ["security.enrol-passkey", "security.enrol-totp"]) {
      expect(await begin(action, staff.userId).catch((e: unknown) => e)).toBeInstanceOf(StepUpError);
    }
  });

  test("a second enrolment needs a step-up for security.enrol on the staff member", async () => {
    const totp = await enrolTotp();
    const d = enrolDeps({ requireStepUp: enrolStepUp(db, () => now) });
    const outcome = (proof: { stepUpToken?: string }) =>
      startTotpEnrolment(d, staff, proof).then(
        () => "ok",
        (e: unknown) => (e instanceof EnrolRefused ? e.reason : Promise.reject(e)),
      );

    later(60);
    expect(await outcome({ stepUpToken: await stepUpWithTotp(totp) })).toBe("step-up");
    later(30);
    expect(await outcome({ stepUpToken: await stepUpWithTotp(totp, ENROL_ACTION, "someone-else") })).toBe("step-up");
    later(30);
    const token = await stepUpWithTotp(totp, ENROL_ACTION, staff.userId);
    expect(await outcome({ stepUpToken: token })).toBe("ok");
    expect(await outcome({ stepUpToken: token })).toBe("step-up");
  });

  test("a passkey verifies against its stored key and counter, which moves on", async () => {
    // Enrol a passkey (with the bootstrap code), stored with counter 4.
    const reg = await startPasskeyEnrolment(enrolDeps(), staff, { bootstrap: BOOTSTRAP }, RP);
    const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: reg.challenge })).toString(
      "base64url",
    );
    await completePasskeyEnrolment(
      enrolDeps(),
      staff,
      { id: "cred-1", rawId: "cred-1", type: "public-key", clientExtensionResults: {}, response: { clientDataJSON, attestationObject: "" } },
      RP,
      async () => ({
        verified: true as const,
        registrationInfo: { credential: { id: "cred-1", publicKey: new Uint8Array([9, 8, 7]), counter: 4, transports: ["usb"] } },
      }),
    );

    const begun = await begin(ACTION, TARGET);
    expect(begun.totp).toBe(false);
    expect(begun.passkeyOptions).not.toBeNull();
    expect(begun.passkeyOptions!.rpId).toBe(RP.rpID);
    expect(begun.passkeyOptions!.userVerification).toBe("required");
    expect(begun.passkeyOptions!.allowCredentials).toEqual([{ id: "cred-1", type: "public-key", transports: ["usb"] }]);

    const seen: Parameters<VerifyAuthentication>[0][] = [];
    const verifier =
      (verified: boolean): VerifyAuthentication =>
      async (o) => {
        seen.push(o);
        return verified ? { verified: true, authenticationInfo: { newCounter: 5 } } : { verified: false };
      };
    const assertion = (id: string) =>
      ({
        id,
        rawId: id,
        type: "public-key",
        clientExtensionResults: {},
        response: { clientDataJSON: "", authenticatorData: "", signature: "" },
      }) as AuthenticationResponseJSON;

    expect(
      await completeStepUp(deps({ verifyAuthentication: verifier(true) }), staff, begun.id, {
        kind: "passkey",
        response: assertion("cred-1"),
      }),
    ).toEqual({ ok: true, token: begun.id });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      expectedChallenge: begun.passkeyOptions!.challenge,
      expectedOrigin: RP.origin,
      expectedRPID: RP.rpID,
      requireUserVerification: true,
      credential: { id: "cred-1", publicKey: new Uint8Array([9, 8, 7]), counter: 4, transports: ["usb"] },
    });
    expect(await consumed(begun.id)).toBe("passkey");

    await db.query("RESET ROLE");
    expect((await db.query(`SELECT counter FROM admin_credentials WHERE user_id = $1`, [staff.userId])).rows[0]!.counter).toBe(
      "5",
    );
    await db.query("SET LOCAL ROLE ob_admin_write");

    // A rejected assertion, or one from a passkey this staff member does not have, is wrong.
    const rejected = await begin(ACTION, TARGET);
    expect(
      await completeStepUp(deps({ verifyAuthentication: verifier(false) }), staff, rejected.id, {
        kind: "passkey",
        response: assertion("cred-1"),
      }),
    ).toMatchObject({ ok: false, reason: "wrong" });
    const unknown = await begin(ACTION, TARGET);
    expect(
      await completeStepUp(deps({ verifyAuthentication: verifier(true) }), staff, unknown.id, {
        kind: "passkey",
        response: assertion("cred-2"),
      }),
    ).toMatchObject({ ok: false, reason: "wrong" });
    expect(seen).toHaveLength(2);
  });

  test("too many wrong answers stop new step-ups for a while", async () => {
    const totp = await enrolTotp();
    later(60);
    const wrong = codeIn(totp, 0) === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      const { id } = await begin(ACTION, TARGET);
      expect(await completeStepUp(deps(), staff, id, { kind: "totp", code: wrong })).toMatchObject({ ok: false, reason: "wrong" });
    }
    expect(await beginStepUp(deps(), staff, ACTION, TARGET)).toEqual({
      ok: false,
      reason: "throttled",
      message: "Too many wrong answers. Try again in 15 minutes.",
    });
    later(15 * 60);
    expect(await consumed(await stepUpWithTotp(totp))).toBe("totp");
  });

  test("step-ups begun ahead and all answered wrong: only five guesses are checked", async () => {
    const totp = await enrolTotp();
    later(60);
    const right = codeIn(totp, 0);
    const wrong = right === "000000" ? "111111" : "000000";

    // At most five unanswered at a time.
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await begin(ACTION, TARGET)).id);
    expect(await beginStepUp(deps(), staff, ACTION, TARGET)).toEqual({
      ok: false,
      reason: "throttled",
      message: "Too many unanswered confirmations. Try again in 5 minutes.",
    });
    // Even with more outstanding (made here behind begin's back), answering stops at five wrong.
    await db.query("RESET ROLE");
    const { rows } = await db.query(
      `INSERT INTO admin_step_ups (user_id, action, target_id, challenge, expires_at)
       SELECT $1, $2, $3, 'c', $4 FROM generate_series(1, 4) RETURNING id`,
      [staff.userId, ACTION, TARGET, new Date(now.getTime() + STEP_UP_TTL_MS)],
    );
    await db.query("SET LOCAL ROLE ob_admin_write");
    ids.push(...rows.map((r) => String(r.id)));

    const reasons: string[] = [];
    for (const id of ids.slice(0, 8)) {
      const result = await completeStepUp(deps(), staff, id, { kind: "totp", code: wrong });
      reasons.push(result.ok ? "ok" : result.reason);
    }
    expect(reasons).toEqual(["wrong", "wrong", "wrong", "wrong", "wrong", "throttled", "throttled", "throttled"]);
    // The right code is refused too while the limit holds: nothing is checked.
    expect(await completeStepUp(deps(), staff, ids[8]!, { kind: "totp", code: right })).toMatchObject({
      ok: false,
      reason: "throttled",
      message: "Too many wrong answers. Try again in 15 minutes.",
    });
  });

  test("missing settings and failures are refusals to show, not wrong answers", async () => {
    // Nothing enrolled.
    expect(await beginStepUp(deps(), staff, ACTION, TARGET)).toEqual({
      ok: false,
      reason: "no-credentials",
      message: "Enrol a passkey or authenticator app on /security first.",
    });

    const totp = await enrolTotp();
    later(60);
    // ADMIN_TOTP_KEY missing: TOTP cannot be offered, nor answered.
    expect(await beginStepUp(deps({ totpKey: "" }), staff, ACTION, TARGET)).toEqual({
      ok: false,
      reason: "config",
      message: "ADMIN_TOTP_KEY is not set: authenticator apps need it",
    });
    const { id } = await begin(ACTION, TARGET);
    for (let i = 0; i < 6; i++) {
      expect(await completeStepUp(deps({ totpKey: "" }), staff, id, { kind: "totp", code: codeIn(totp, 0) })).toEqual({
        ok: false,
        reason: "config",
        message: "ADMIN_TOTP_KEY is not set: authenticator apps need it",
      });
    }
    // A failure that is no configuration (here: another key, so the secret does not decrypt) throws and rolls back.
    const otherKey = randomBytes(32).toString("base64");
    expect(
      await completeStepUp(deps({ totpKey: otherKey }), staff, id, { kind: "totp", code: codeIn(totp, 0) }).catch(
        (e: unknown) => e,
      ),
    ).toBeInstanceOf(Error);
    // None of that spent the step-up or counted as a wrong answer.
    expect(await completeStepUp(deps(), staff, id, { kind: "totp", code: codeIn(totp, 0) })).toEqual({ ok: true, token: id });
    await db.query("RESET ROLE");
    const spent = await db.query(`SELECT count(*)::int AS n FROM admin_step_ups WHERE user_id = $1 AND verified_at IS NULL AND used_at IS NOT NULL AND action = $2`, [
      staff.userId,
      ACTION,
    ]);
    expect(spent.rows[0]!.n).toBe(0);
    await db.query("SET LOCAL ROLE ob_admin_write");
  });

  test("without ADMIN_RP_ID a passkey is left out when an authenticator app can answer", async () => {
    const reg = await startPasskeyEnrolment(enrolDeps(), staff, { bootstrap: BOOTSTRAP }, RP);
    const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: reg.challenge })).toString(
      "base64url",
    );
    await completePasskeyEnrolment(
      enrolDeps(),
      staff,
      { id: "cred-1", rawId: "cred-1", type: "public-key", clientExtensionResults: {}, response: { clientDataJSON, attestationObject: "" } },
      RP,
      async () => ({
        verified: true as const,
        registrationInfo: { credential: { id: "cred-1", publicKey: new Uint8Array([1]), counter: 0 } },
      }),
    );
    const noRp = async (): Promise<never> => {
      throw new StepUpConfigError("ADMIN_RP_ID is not set: passkeys need the admin console's host name");
    };
    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);

    // Passkey only: nothing to offer.
    expect(await beginStepUp(deps({ rp: noRp, warn }), staff, ACTION, TARGET)).toEqual({
      ok: false,
      reason: "config",
      message: "ADMIN_RP_ID is not set: passkeys need the admin console's host name",
    });
    expect(warnings).toEqual([]);

    // Passkey and authenticator app: offer the app, and say why the passkey is missing.
    const enrolToken = await (async () => {
      const b = await begin(ENROL_ACTION, staff.userId);
      expect(b.passkeyOptions).not.toBeNull();
      // Answered with the passkey to add an authenticator app.
      const r = await completeStepUp(
        deps({ verifyAuthentication: async () => ({ verified: true, authenticationInfo: { newCounter: 1 } }) }),
        staff,
        b.id,
        { kind: "passkey", response: { id: "cred-1" } as AuthenticationResponseJSON },
      );
      if (!r.ok) throw new Error(r.message);
      return r.token;
    })();
    const { uri } = await startTotpEnrolment(enrolDeps({ requireStepUp: enrolStepUp(db, () => now) }), staff, {
      stepUpToken: enrolToken,
    });
    const totp = OTPAuth.URI.parse(uri) as OTPAuth.TOTP;
    await completeTotpEnrolment(enrolDeps(), staff, codeIn(totp, 0));

    later(60);
    const begun = await begin(ACTION, TARGET, deps({ rp: noRp, warn }));
    expect(begun).toMatchObject({ ok: true, passkeyOptions: null, totp: true });
    expect(warnings).toEqual(["[admin] step-up offered without one kind: ADMIN_RP_ID is not set: passkeys need the admin console's host name"]);
    // A passkey answer then is a configuration refusal, not a wrong answer.
    expect(
      await completeStepUp(deps({ rp: noRp }), staff, begun.id, { kind: "passkey", response: { id: "cred-1" } as AuthenticationResponseJSON }),
    ).toMatchObject({ ok: false, reason: "config" });
    expect(await completeStepUp(deps({ rp: noRp }), staff, begun.id, { kind: "totp", code: codeIn(totp, 0) })).toEqual({
      ok: true,
      token: begun.id,
    });
  });
});

// ---------------------------------------------------------------------------
// Two connections racing: needs committed rows.
// ---------------------------------------------------------------------------

async function stepUpTableCommitted(): Promise<boolean> {
  if (!connectionString || !(await ensureCommittedMigrations())) return false;
  const c = new Client({ connectionString: process.env.DATABASE_URL_DIRECT ?? connectionString });
  await c.connect();
  try {
    return (await c.query(`SELECT to_regclass('public.admin_step_ups') IS NOT NULL AS ok`)).rows[0]!.ok === true;
  } finally {
    await c.end();
  }
}

const describeCommitting = (await stepUpTableCommitted()) ? describeWithDb : describe.skip;

describeCommitting("step-up consumed from two connections", () => {
  const url = process.env.DATABASE_URL_DIRECT ?? connectionString;
  const clients: Client[] = [];
  const userId = `staff-race-${crypto.randomUUID()}`;

  beforeAll(async () => {
    for (let i = 0; i < 3; i++) {
      const c = new Client({ connectionString: url });
      await c.connect();
      clients.push(c);
    }
  });
  afterAll(async () => {
    await clients[0]?.query(`DELETE FROM admin_step_ups WHERE user_id = $1`, [userId]);
    await clients[0]?.query(`DELETE FROM admin_credentials WHERE user_id = $1`, [userId]);
    await Promise.all(clients.map((c) => c.end()));
  });

  test("two consumes racing on one token: exactly one succeeds", async () => {
    const [setup, a, b] = clients as [Client, Client, Client];
    const now = new Date();
    const { rows } = await setup.query(
      `INSERT INTO admin_step_ups (user_id, action, target_id, challenge, verified_kind, verified_at, expires_at)
       VALUES ($1, $2, $3, 'c', 'totp', $4, $5) RETURNING id`,
      [userId, ACTION, TARGET, now, new Date(now.getTime() + STEP_UP_TTL_MS)],
    );
    const token = String(rows[0]!.id);
    const i = { token, userId, action: ACTION, targetId: TARGET, now };

    const results = await Promise.allSettled([consumeStepUp(a, i), consumeStepUp(b, i)]);
    expect(results.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<string>).value)).toEqual([
      "totp",
    ]);
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(failed).toHaveLength(1);
    expect(failed[0]!.reason).toBeInstanceOf(StepUpError);
  });
  test("wrong answers sent at once still stop at five", async () => {
    const [setup] = clients as [Client];
    const pool = new Pool({ connectionString: url, max: 8 });
    try {
      const secret = new OTPAuth.Secret({ size: 20 });
      const totp = new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret });
      const now = new Date();
      await setup.query(`INSERT INTO admin_credentials (user_id, kind, totp_secret_enc, label) VALUES ($1, 'totp', $2, 'app')`, [
        userId,
        encryptSecret(secret.base32, TOTP_KEY),
      ]);
      const { rows } = await setup.query(
        `INSERT INTO admin_step_ups (user_id, action, target_id, challenge, expires_at)
         SELECT $1, $2, $3, 'c', $4 FROM generate_series(1, 8) RETURNING id`,
        [userId, ACTION, TARGET, new Date(now.getTime() + STEP_UP_TTL_MS)],
      );
      const d: StepUpDeps = {
        db: {
          query: (text, values) => pool.query(text, values),
          transaction: async (fn) => {
            const c = await pool.connect();
            try {
              await c.query("BEGIN");
              const result = await fn(c);
              await c.query("COMMIT");
              return result;
            } catch (error) {
              await c.query("ROLLBACK");
              throw error;
            } finally {
              c.release();
            }
          },
        },
        totpKey: TOTP_KEY,
        rp: async () => RP,
        now: () => now,
      };
      const wrong = totp.generate({ timestamp: now.getTime() }) === "000000" ? "111111" : "000000";
      const results = await Promise.all(
        rows.map((r) => completeStepUp(d, { userId, email: "race@example.test" }, String(r.id), { kind: "totp", code: wrong })),
      );
      const reasons = results.map((r) => (r.ok ? "ok" : r.reason)).sort();
      expect(reasons).toEqual(["throttled", "throttled", "throttled", "wrong", "wrong", "wrong", "wrong", "wrong"]);
    } finally {
      await pool.end();
    }
  });
});
