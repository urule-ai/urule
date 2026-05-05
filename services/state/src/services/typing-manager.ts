/**
 * Typing indicators — short-lived "user is currently typing" flags scoped
 * to a room. Each ping has a TTL (default 6 seconds, matching Slack/Discord
 * conventions); stale entries are pruned on read so the in-memory map
 * doesn't grow unbounded with abandoned sessions.
 *
 * Future: when the room presence story moves to NATS KV (CLAUDE.md
 * mentions this is on the roadmap for state), this manager moves with
 * it. Today it's in-memory like the rest of state.
 */
export interface TypingPing {
  userId: string;
  roomId: string;
  startedAt: string;   // ISO 8601
  expiresAt: string;   // ISO 8601
}

export class TypingManager {
  private pings = new Map<string, TypingPing>();

  // 6 seconds matches Slack's default "Someone is typing…" client TTL.
  // Override per ping if a caller wants a different duration.
  private static readonly DEFAULT_TTL_MS = 6000;

  private key(userId: string, roomId: string): string {
    return `${userId}:${roomId}`;
  }

  /**
   * Mark `userId` as typing in `roomId`. If already marked, refreshes
   * the expiry — clients should ping every ~3s while the user is still
   * actively typing.
   */
  ping(userId: string, roomId: string, ttlMs: number = TypingManager.DEFAULT_TTL_MS): TypingPing {
    const now = new Date();
    const expires = new Date(now.getTime() + ttlMs);
    const entry: TypingPing = {
      userId,
      roomId,
      startedAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    };
    this.pings.set(this.key(userId, roomId), entry);
    return entry;
  }

  /** Manual stop (typically: user submitted the message). */
  clear(userId: string, roomId: string): boolean {
    return this.pings.delete(this.key(userId, roomId));
  }

  /**
   * List currently-typing users in a room. Prunes expired entries as a
   * side effect so callers always see a fresh view.
   */
  listInRoom(roomId: string): TypingPing[] {
    const now = Date.now();
    const active: TypingPing[] = [];
    for (const [key, p] of this.pings) {
      if (Date.parse(p.expiresAt) <= now) {
        this.pings.delete(key);
        continue;
      }
      if (p.roomId === roomId) active.push(p);
    }
    return active;
  }

  /** Test/diagnostic helper — total tracked entries (incl. stale). */
  size(): number {
    return this.pings.size;
  }
}
