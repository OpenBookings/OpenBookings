import { describe, expect, test } from 'bun:test';
import { TURNSTILE_ACTIONS, verifyTurnstile } from './turnstile';

/** siteverify answering `body` with `status`, recording what it was sent. */
function siteverify(body: unknown, status = 200) {
  const sent: URLSearchParams[] = [];
  const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push(init?.body as URLSearchParams);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { sent, fetchFn };
}

const config = { secret: 'secret', hostnames: 'openbookings.co, web.localhost' };
const solved = { success: true, action: TURNSTILE_ACTIONS.reviewReport, hostname: 'openbookings.co' };

describe('verifyTurnstile', () => {
  test('a solved token for this action and an approved host passes, and the IP goes along', async () => {
    const { sent, fetchFn } = siteverify(solved);
    expect(await verifyTurnstile('token', '203.0.113.7', TURNSTILE_ACTIONS.reviewReport, { ...config, fetchFn })).toBe(true);
    expect(sent[0]?.get('secret')).toBe('secret');
    expect(sent[0]?.get('response')).toBe('token');
    expect(sent[0]?.get('remoteip')).toBe('203.0.113.7');
  });

  test('turnstile verify returns false when siteverify errors', async () => {
    const down = siteverify({ error: 'nope' }, 500);
    expect(await verifyTurnstile('token', '203.0.113.7', TURNSTILE_ACTIONS.reviewReport, { ...config, fetchFn: down.fetchFn })).toBe(false);

    const unreachable = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    expect(await verifyTurnstile('token', '203.0.113.7', TURNSTILE_ACTIONS.reviewReport, { ...config, fetchFn: unreachable })).toBe(false);

    const garbled = (async () => new Response('not json', { status: 200 })) as unknown as typeof fetch;
    expect(await verifyTurnstile('token', '203.0.113.7', TURNSTILE_ACTIONS.reviewReport, { ...config, fetchFn: garbled })).toBe(false);
  });

  test("a token minted for another surface, or on a host we didn't approve, fails", async () => {
    const checkout = siteverify({ ...solved, action: TURNSTILE_ACTIONS.checkout });
    expect(await verifyTurnstile('token', null, TURNSTILE_ACTIONS.reviewReport, { ...config, fetchFn: checkout.fetchFn })).toBe(false);
    const elsewhere = siteverify({ ...solved, hostname: 'evil.example' });
    expect(await verifyTurnstile('token', null, TURNSTILE_ACTIONS.reviewReport, { ...config, fetchFn: elsewhere.fetchFn })).toBe(false);
    const unsolved = siteverify({ ...solved, success: false });
    expect(await verifyTurnstile('token', null, TURNSTILE_ACTIONS.reviewReport, { ...config, fetchFn: unsolved.fetchFn })).toBe(false);
  });

  test('no token, no secret or no host allowlist fails without calling Cloudflare', async () => {
    const { sent, fetchFn } = siteverify(solved);
    expect(await verifyTurnstile('', null, TURNSTILE_ACTIONS.reviewReport, { ...config, fetchFn })).toBe(false);
    expect(await verifyTurnstile(undefined, null, TURNSTILE_ACTIONS.reviewReport, { ...config, fetchFn })).toBe(false);
    expect(await verifyTurnstile('token', null, TURNSTILE_ACTIONS.reviewReport, { ...config, secret: undefined, fetchFn })).toBe(false);
    expect(await verifyTurnstile('token', null, TURNSTILE_ACTIONS.reviewReport, { ...config, hostnames: '', fetchFn })).toBe(false);
    expect(sent).toHaveLength(0);
  });

  test("an unknown client IP isn't sent", async () => {
    const { sent, fetchFn } = siteverify(solved);
    await verifyTurnstile('token', 'unknown', TURNSTILE_ACTIONS.reviewReport, { ...config, fetchFn });
    expect(sent[0]?.has('remoteip')).toBe(false);
  });
});
