import type { Page, Post, Snapshot } from "./types";
import { dayKey, randomHex } from "./format";

const KEY = "onwallz.demo.v2";

const empty: Snapshot = { me: null, pages: {}, posts: [], spentBonus: [] };

export function load(): Snapshot {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...empty };
    const s = JSON.parse(raw) as Snapshot;
    // `me` is never restored: it is derived from whichever wallet is connected.
    return { me: null, pages: s.pages ?? {}, posts: s.posts ?? [], spentBonus: s.spentBonus ?? [] };
  } catch {
    return { ...empty };
  }
}

export function save(s: Snapshot) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function postId(wall: string, index: number): string {
  return `${wall}:${index}`;
}

export function postsFor(s: Snapshot, wall: string): Post[] {
  return s.posts.filter((p) => p.wall === wall).sort((a, b) => b.index - a.index);
}

export type WriteCheck =
  | { status: "ready" }
  | { status: "blocked" };

/** Mirrors the contract: one post per person per wall per day, plus one bonus
 *  per post the wall owner has replied to. */
export function canWrite(s: Snapshot, wall: string): WriteCheck {
  // `me` is a local claim record, and claims live in private notes now, so it is
  // usually null even when a wallet is connected. Writing does not require a
  // claim: the contract decides, and the composer is already gated on connection.
  if (!s.me) return { status: "ready" };
  const me = s.me.id;
  const page = s.pages[wall];
  // Reads come from the chain now, so the local snapshot often has no page for a
  // wall that exists. A missing page must not block writing: the first message is
  // what creates the wall.
  if (!page) return { status: "ready" };
  if (page.owner === me) return { status: "blocked" };

  const today = dayKey();
  const mineToday = s.posts.some(
    (p) => p.wall === wall && p.mine === true && dayKey(p.ts) === today,
  );
  if (!mineToday) return { status: "ready" };

  return { status: "blocked" };
}

export function write(
  s: Snapshot,
  wall: string,
  text: string,
  bonusPostId?: string,
  identity: { mode: 0 | 1; tag?: string } = { mode: 0 },
): { snapshot: Snapshot; error?: string } {
  const page = s.pages[wall];
  if (!page) return { snapshot: s, error: "that wall does not exist" };
  if (s.me && normAddress(page.owner) === s.me.id) return { snapshot: s, error: "you cannot write on your own wall" };

  const check = canWrite(s, wall);
  if (check.status === "blocked") return { snapshot: s, error: "you have written here today" };

  const index = s.posts.filter((p) => p.wall === wall).length;
  const post: Post = {
    id: postId(wall, index),
    wall,
    index,
    text: text.trim(),
    ts: Date.now(),
    mode: identity.mode,
    tag: identity.mode === 1 ? (identity.tag ?? null) : null,
    mine: !!s.me,
    replied: false,
  };
  const next: Snapshot = { ...s, posts: [...s.posts, post] };
  return { snapshot: next };
}

export function reply(
  s: Snapshot,
  wall: string,
  id: string,
  text: string,
): { snapshot: Snapshot; error?: string } {
  const page = s.pages[wall];
  if (!page) return { snapshot: s, error: "no such wall" };
  if (!s.me || normAddress(page.owner) !== s.me.id) {
    return { snapshot: s, error: "only the wall owner can reply" };
  }
  const posts = s.posts.map((p) =>
    p.id === id && !p.replied
      ? { ...p, replied: true, replyText: text.trim(), repliedAt: Date.now() }
      : p,
  );
  return { snapshot: { ...s, posts } };
}

/** Creating a page requires the wallet address that will own it. */
export function createPage(
  s: Snapshot,
  handle: string,
  display: string,
  address: string,
): { snapshot: Snapshot; error?: string } {
  const h = handle.trim().toLowerCase();
  if (!address) return { snapshot: s, error: "connect your wallet first" };
  if (!/^[a-z0-9_]{2,20}$/.test(h)) return { snapshot: s, error: "2-20 letters, numbers or _" };
  if (s.pages[h]) return { snapshot: s, error: "that handle is taken" };
  if (!display.trim()) return { snapshot: s, error: "add a display name" };
  if (s.me) return { snapshot: s, error: "you already have a page" };

  const owner = address.toLowerCase();
  const existing = Object.values(s.pages).find((p) => normAddress(p.owner) === normAddress(owner));
  if (existing) return { snapshot: s, error: `this wallet already owns @${existing.handle}` };

  const page: Page = { handle: h, display: display.trim(), owner, createdAt: Date.now() };
  return {
    snapshot: {
      ...s,
      me: { handle: h, id: owner, address: owner },
      pages: { ...s.pages, [h]: page },
    },
  };
}

/** The page owned by a wallet address, or null. This is the session identity. */
/** One comparison function for every address check: no `0x`, lowercase, trimmed. */
export const normAddress = (a: string) => a.trim().toLowerCase().replace(/^0x/, "");

export function pageForOwner(
  s: Snapshot,
  address: string | null | undefined,
): { handle: string; id: string; address: string } | null {
  if (!address) return null;
  const owner = normAddress(address);
  const page = Object.values(s.pages).find((p) => normAddress(p.owner) === owner);
  return page ? { handle: page.handle, id: normAddress(page.owner), address: normAddress(page.owner) } : null;
}

/** The snapshot as it should look for the connected wallet. */
export function sessionFor(s: Snapshot, address: string | null | undefined): Snapshot {
  return { ...s, me: pageForOwner(s, address) };
}

/** Walls with recent activity, newest first. */
export function feed(s: Snapshot, limit = 8): Post[] {
  return [...s.posts].sort((a, b) => b.ts - a.ts).slice(0, limit);
}

export function wallsWithActivity(s: Snapshot): string[] {
  const seen = new Set<string>();
  for (const p of [...s.posts].sort((a, b) => b.ts - a.ts)) seen.add(p.wall);
  return [...seen];
}
/**
 * Replace a wall's cached posts with authoritative ones read from the contract.
 * Anonymous posts carry no tag; public ones carry a self-declared handle.
 */
export function replaceWallPosts(
  s: Snapshot,
  wall: string,
  rows: {
    index: number;
    text: string;
    mode: number;
    tag: string | null;
    replied: boolean;
    replyText: string | null;
    ts?: number | null;
    long?: boolean;
    deleted?: boolean;
  }[],
): Snapshot {
  const kept = s.posts.filter((p) => p.wall !== wall);
  const fresh: Post[] = rows.map((r) => ({
    id: postId(wall, r.index),
    wall,
    index: r.index,
    text: r.text,
    ts: r.ts ?? 0,
    long: r.long,
    mode: r.mode === 1 ? 1 : 0,
    tag: r.mode === 1 ? r.tag : null,
    mine: false,
    replied: r.replied,
    replyText: r.replyText ?? undefined,
    deleted: r.deleted ?? false,
  }));
  return { ...s, posts: [...kept, ...fresh] };
}

/**
 * Record a page that the contract told us about (used after reconnect).
 * Local only - the contract remains the source of truth.
 */
export function adoptPage(
  s: Snapshot,
  handle: string,
  display: string,
  owner: string,
  genesis = false,
): Snapshot {
  return {
    ...s,
    pages: { ...s.pages, [handle]: { handle, display, owner, createdAt: Date.now(), genesis } },
  };
}
