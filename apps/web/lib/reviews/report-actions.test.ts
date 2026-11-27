import { beforeEach, describe, expect, it } from 'bun:test';
import { mockModules } from '@/lib/mock-modules';

/**
 * The public report form's action. Turnstile and the database are faked; the
 * IP rate limit is the real in-memory one, so each test uses its own IP.
 */

let turnstileOk = true;
let session: { user: { id: string; email: string } } | null = null;
let sessionError: Error | null = null;
const captured: unknown[] = [];
let ip = '';
const verified: { token: unknown; ip: string | null; action: string }[] = [];
const reported: { item: unknown; reporter: unknown; rule: unknown; note: unknown }[] = [];
let reportResult: unknown = { ok: true, reportId: 'report-1' };

await mockModules(
  import.meta.dir,
  {
    'next/headers': () => ({ headers: async () => new Headers({ 'cf-connecting-ip': ip }) }),
    '@sentry/nextjs': () => ({ captureException: (error: unknown) => void captured.push(error) }),
    '@openbookings/db': () => ({ getPool: () => ({}) }),
    '@openbookings/db/reviews': () => ({
      createReviewReport: async (_db: unknown, i: { item: unknown; reporter: unknown; rule: unknown; note: unknown }) => {
        reported.push(i);
        return reportResult;
      },
    }),
    '@/lib/auth': () => ({
      auth: { api: {} },
      getServerSession: async () => {
        if (sessionError) throw sessionError;
        return session;
      },
    }),
    '@/lib/turnstile': () => ({
      TURNSTILE_ACTIONS: { checkout: 'checkout', reviewReport: 'review_report' },
      verifyTurnstile: async (token: unknown, clientIp: string | null, action: string) => {
        verified.push({ token, ip: clientIp, action });
        return turnstileOk;
      },
    }),
  },
  ['@/lib/auth'],
);

const { reportReviewPublic } = await import('./report-actions');

const input = (over: Record<string, unknown> = {}) => ({
  item: { kind: 'review', id: 'review-1' },
  rule: 'abuse',
  note: 'Insults the staff.',
  updates: false,
  turnstileToken: 'token',
  ...over,
});

beforeEach(() => {
  turnstileOk = true;
  session = null;
  sessionError = null;
  captured.length = 0;
  ip = `198.51.100.${Math.floor(Math.random() * 250)}-${crypto.randomUUID()}`;
  verified.length = 0;
  reported.length = 0;
  reportResult = { ok: true, reportId: 'report-1' };
});

describe('reportReviewPublic', () => {
  it('a public report without a valid Turnstile token is refused', async () => {
    turnstileOk = false;
    expect(await reportReviewPublic(input({ turnstileToken: 'forged' }))).toEqual({ ok: false, message: expect.stringMatching(/person/) });
    expect(verified).toEqual([{ token: 'forged', ip, action: 'review_report' }]);
    expect(reported).toEqual([]);
  });

  it('the sixth public report from one IP within an hour is refused', async () => {
    for (let n = 0; n < 5; n += 1) expect(await reportReviewPublic(input())).toEqual({ ok: true, emailStored: false });
    expect(await reportReviewPublic(input())).toEqual({ ok: false, message: expect.stringMatching(/last hour/) });
    expect(reported).toHaveLength(5);
    // Another IP is its own bucket.
    ip = `other-${crypto.randomUUID()}`;
    expect(await reportReviewPublic(input())).toEqual({ ok: true, emailStored: false });
  });

  it("a signed-out reporter gets no updates, whatever the form says", async () => {
    await reportReviewPublic(input({ updates: true }));
    expect(reported[0]?.reporter).toEqual({ kind: 'public', userId: null, email: null });
  });

  it("a signed-in reporter's updates go to the account's email, and only when ticked", async () => {
    session = { user: { id: 'guest-1', email: 'lisa@example.test' } };
    expect(await reportReviewPublic(input({ updates: true, email: 'someone-else@example.test' }))).toEqual({ ok: true, emailStored: true });
    expect(await reportReviewPublic(input({ updates: false }))).toEqual({ ok: true, emailStored: false });
    expect(reported.map((r) => r.reporter)).toEqual([
      { kind: 'public', userId: 'guest-1', email: 'lisa@example.test' },
      { kind: 'public', userId: 'guest-1', email: null },
    ]);
  });

  it("a session that can't be read goes to Sentry; the report is made without updates, and says so", async () => {
    sessionError = new Error('auth store down');
    expect(await reportReviewPublic(input({ updates: true }))).toEqual({ ok: true, emailStored: false });
    expect(captured).toEqual([sessionError]);
    expect(reported[0]?.reporter).toEqual({ kind: 'public', userId: null, email: null });
  });

  it("passes the item, rule and note on, and says when it's already reported", async () => {
    reportResult = { ok: false, error: 'already_open' };
    const result = await reportReviewPublic(input({ item: { kind: 'reply', id: 'reply-1' } }));
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/already reported/) });
    expect(reported[0]).toMatchObject({ item: { kind: 'reply', id: 'reply-1' }, rule: 'abuse', note: 'Insults the staff.' });
  });
});
