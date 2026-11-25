/** Per-wall "last seen" markers, so new notes and replies can be counted. */
export type Seen = { notes: number; replies: number };

const key = (wall: string) => `onwallz.seen.${wall}`;

export function hasSeen(wall: string): boolean {
  try {
    return localStorage.getItem(key(wall)) !== null;
  } catch {
    return false;
  }
}

export function readSeen(wall: string): Seen {
  try {
    const raw = localStorage.getItem(key(wall));
    if (!raw) return { notes: 0, replies: 0 };
    const value = JSON.parse(raw) as Partial<Seen>;
    return { notes: Number(value.notes) || 0, replies: Number(value.replies) || 0 };
  } catch {
    return { notes: 0, replies: 0 };
  }
}

export function writeSeen(wall: string, seen: Seen): void {
  try {
    localStorage.setItem(key(wall), JSON.stringify(seen));
  } catch {
    // private mode: markers are a convenience, not state
  }
}

export function unreadCount(
  posts: { replied: boolean }[],
  seen: Seen,
): { notes: number; replies: number; total: number } {
  const replied = posts.filter((p) => p.replied).length;
  const notes = Math.max(0, posts.length - seen.notes);
  const replies = Math.max(0, replied - seen.replies);
  return { notes, replies, total: notes + replies };
}
