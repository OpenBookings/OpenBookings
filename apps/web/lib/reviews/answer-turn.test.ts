import { describe, expect, it } from 'bun:test';
import { guestAnswerTurn } from './answer-turn';

const host = { role: 'host' as const, status: 'published' };
const guest = { role: 'guest' as const, status: 'published' };

describe('guestAnswerTurn', () => {
  it('answers a published host reply, once', () => {
    expect(guestAnswerTurn({ threadRoles: ['host'], replies: [host] })).toBe('answer');
    expect(guestAnswerTurn({ threadRoles: ['host', 'guest'], replies: [host, guest] })).toBe('wait');
    expect(guestAnswerTurn({ threadRoles: ['host', 'guest', 'host'], replies: [host, guest, host] })).toBe('closed');
  });

  it("nothing to answer before the property replies, or when its reply is held or removed (the guest doesn't see it)", () => {
    expect(guestAnswerTurn({ threadRoles: [], replies: [] })).toBe('wait');
    expect(guestAnswerTurn({ threadRoles: ['host'], replies: [] })).toBe('wait');
  });

  it("a removed host reply still counts: the guest's answer under it doesn't open another turn", () => {
    // host (removed), guest: the host's turn on the server, though the guest sees only their answer.
    expect(guestAnswerTurn({ threadRoles: ['host', 'guest'], replies: [{ role: 'guest', status: 'published' }] })).toBe('wait');
    // host, guest (removed), host: closed on the server, though the guest's view has two host replies.
    expect(guestAnswerTurn({ threadRoles: ['host', 'guest', 'host'], replies: [host, { role: 'guest', status: 'removed' }, host] })).toBe(
      'closed',
    );
  });
});
