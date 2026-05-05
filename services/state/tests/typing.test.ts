import { describe, it, expect } from 'vitest';
import { TypingManager } from '../src/services/typing-manager.js';

describe('TypingManager', () => {
  it('ping registers a typing indicator scoped to (userId, roomId)', () => {
    const tm = new TypingManager();
    const ping = tm.ping('u1', 'r1');
    expect(ping.userId).toBe('u1');
    expect(ping.roomId).toBe('r1');
    expect(tm.listInRoom('r1')).toHaveLength(1);
    expect(tm.listInRoom('other-room')).toHaveLength(0);
  });

  it('subsequent pings for the same user refresh the expiry instead of duplicating', () => {
    const tm = new TypingManager();
    tm.ping('u1', 'r1', 1000);
    tm.ping('u1', 'r1', 5000);
    const list = tm.listInRoom('r1');
    expect(list).toHaveLength(1);
    expect(Date.parse(list[0]!.expiresAt) - Date.now()).toBeGreaterThan(2000);
  });

  it('clear removes the indicator and returns true; second clear returns false', () => {
    const tm = new TypingManager();
    tm.ping('u1', 'r1');
    expect(tm.clear('u1', 'r1')).toBe(true);
    expect(tm.clear('u1', 'r1')).toBe(false);
    expect(tm.listInRoom('r1')).toHaveLength(0);
  });

  it('listInRoom prunes expired entries as a side effect', () => {
    const tm = new TypingManager();
    tm.ping('u1', 'r1', 1);  // expires almost immediately
    tm.ping('u2', 'r1', 60_000);
    // Wait long enough for u1's TTL to lapse without timer flake.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const list = tm.listInRoom('r1');
        expect(list).toHaveLength(1);
        expect(list[0]!.userId).toBe('u2');
        resolve();
      }, 20);
    });
  });

  it('multiple users can be typing in the same room concurrently', () => {
    const tm = new TypingManager();
    tm.ping('u1', 'r1');
    tm.ping('u2', 'r1');
    tm.ping('u3', 'r1');
    expect(tm.listInRoom('r1')).toHaveLength(3);
  });

  it('pings are scoped per-room — same user can be typing in two rooms', () => {
    const tm = new TypingManager();
    tm.ping('u1', 'r1');
    tm.ping('u1', 'r2');
    expect(tm.listInRoom('r1')).toHaveLength(1);
    expect(tm.listInRoom('r2')).toHaveLength(1);
  });
});
