import { useEffect, useState } from "react";
import type { Post, Snapshot } from "../lib/types";
import { readActivity } from "../lib/chain";
import { feed, postsFor } from "../lib/store";
import { timeAgo } from "../lib/format";
import { Sigil } from "./Sigil";

type Props = {
  snap: Snapshot;
  onLookup: (handle: string) => void;
  goCreate: () => void; // kept for the caller; no create-wall action exists
  walletError: string | null;
  onConnect: () => void;
  walletConnected: boolean;
  address: string | null;
};

export function Home({
  snap,
  onLookup,
  goCreate,
  walletError,
  onConnect,
  walletConnected,
  address,
}: Props) {
  const [target, setTarget] = useState("");
  const mine = snap.me ? snap.pages[snap.me.handle] : null;
  // Latest activity is read from the chain. The local cache could hold posts
  // written to an older contract, which then appeared here and nowhere else.
  const [recent, setRecent] = useState<Post[]>([]);
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    readActivity(12, address)
      .then((items) => {
        if (cancelled) return;
        setRecent(
          items.map((it) => ({
            id: it.postId,
            wall: it.handle || it.wall.slice(0, 10),
            index: 0,
            text: it.text,
            ts: Date.now(),
            mode: it.mode === 1 ? 1 : 0,
            replied: false,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setRecent([]);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const myWallPosts = mine ? postsFor(snap, mine.handle) : [];
  const waiting = myWallPosts.filter((p) => !p.replied);
  const today = new Date().toDateString();
  const todayCount = snap.posts.filter((p) => new Date(p.ts).toDateString() === today).length;
  const wallCount = Object.keys(snap.pages).length;

  const lookup = (
    <div className="finder-grid">
      <Finder
        tone="primary"
        glyph="wall"
        eyebrow="write on someone’s wall"
        label="whose wall?"
        placeholder="their x handle"
        action="write on this wall"
        onOpen={onLookup}
      />
      <Finder
        tone="quiet"
        glyph="eye"
        eyebrow="what did people write about you?"
        label="your x handle"
        placeholder="your x handle"
        action="check your wall"
        onOpen={onLookup}
      />
    </div>
  );

  if (!mine) {
    return (
      <div className="stack" style={{ gap: 34 }}>
        <section className="hero">
          <p className="eyebrow">anonymous by construction</p>
          <h1 style={{ marginTop: 10 }}>
            Every identity
            <br />
            has a wall.
          </h1>
          <p className="lede" style={{ marginTop: 14 }}>
            Your wall is controlled by the people who write on it, not by you.
          </p>
        </section>

        {walletError && <WalletProblem error={walletError} onConnect={onConnect} />}

        <section className="stack">
          <div className="card pad stack">
            <p className="eyebrow">how it works</p>
            <h3>Someone writes first. Then the wall exists.</h3>
            <p className="muted" style={{ margin: 0 }}>
              Post anonymously on any handle, because that first note is what creates the
              wall. The person behind the name can claim it afterwards, from the wall
              page itself.
            </p>
            {!walletConnected ? (
              <button className="btn" onClick={onConnect}>
                connect Nulo
              </button>
            ) : (
              <p className="hint" style={{ margin: 0 }}>
                You are connected. Search a handle and leave the first message.
              </p>
            )}
          </div>
        </section>

        {lookup}

        <Activity posts={recent} snap={snap} onLookup={onLookup} />
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 30 }}>
      <section className="hero compact">
        <p className="eyebrow">signed in as {mine.display}</p>
        <h1 style={{ marginTop: 8, fontSize: 34 }}>
          @{mine.handle}
          <span className="muted" style={{ fontWeight: 400 }}>
            {" "}
            · {myWallPosts.length} {myWallPosts.length === 1 ? "note" : "notes"}
          </span>
        </h1>
        <p className="lede" style={{ marginBottom: 0 }}>
          {waiting.length > 0
            ? `${waiting.length} ${waiting.length === 1 ? "person is" : "people are"} waiting on a reply from you.`
            : "nothing waiting on you right now."}
        </p>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn primary" onClick={() => onLookup(mine.handle)}>
            open my wall
          </button>
          <span className="chip">{todayCount} written today</span>
          <span className="chip">{wallCount} walls</span>
        </div>
      </section>

      {waiting.length > 0 && (
        <section className="card pad">
          <p className="eyebrow" style={{ marginBottom: 10 }}>
            waiting on you
          </p>
          <div className="feed">
            {waiting.slice(0, 4).map((p) => (
              <button
                key={p.id}
                className="item item-link"
                onClick={() => onLookup(mine.handle)}
              >
                <div className="row">
                  <Sigil seed={p.id} size={22} />
                  <span className="muted" style={{ fontSize: 12 }}>
                    someone → you
                  </span>
                  <span className="when muted" style={{ fontSize: 12 }}>
                    · {timeAgo(p.ts)}
                  </span>
                </div>
                <div className="text">{p.text}</div>
                <span className="hint">reply ↗</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="stack">
        <div className="card pad stack">
          <p className="eyebrow">your wall</p>
          <div className="row">
            <Sigil seed={`page:${mine.handle}`} size={44} />
            <div className="grow">
              <h3>{mine.display}</h3>
              <span className="handle">{mine.handle}</span>
            </div>
          </div>
          <div className="row">
            <button className="btn" onClick={() => onLookup(mine.handle)}>
              open
            </button>
            <span className="hint">share the link. they write, you never learn who.</span>
          </div>
        </div>
        {lookup}
      </section>

      <Activity posts={recent} snap={snap} onLookup={onLookup} />

      <section className="card pad stack" style={{ gap: 12 }}>
        <p className="eyebrow">the rules</p>
        <ol className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
          <li>One page per person. Pick a handle.</li>
          <li>Write on anyone&rsquo;s wall but your own.</li>
          <li>One note per wall per day.</li>
          <li>If the owner replies, you get one more.</li>
          <li>Nobody learns who wrote it, not the owner and not the network.</li>
        </ol>
      </section>
    </div>
  );
}

function Activity({
  posts,
  snap,
  onLookup,
}: {
  posts: ReturnType<typeof feed>;
  snap: Snapshot;
  onLookup: (handle: string) => void;
}) {
  if (!posts.length) return null;
  return (
    <section className="card pad">
      <p className="eyebrow" style={{ marginBottom: 10 }}>
        latest
      </p>
      <div className="feed">
        {posts.map((p) => {
          const wall = snap.pages[p.wall];
          return (
            <button key={p.id} className="item item-link" onClick={() => onLookup(p.wall)}>
              <div className="row">
                <Sigil seed={p.id} size={22} />
                <span className="muted" style={{ fontSize: 12 }}>
                  someone → <span className="mono">@{p.wall}</span>
                </span>
                <span className="when muted" style={{ fontSize: 12 }}>
                  · {timeAgo(p.ts)}
                </span>
                {p.replied && <span className="chip">answered</span>}
              </div>
              <div className="text">{p.text}</div>
              {p.replied && (
                <div className="reply">
                  <span className="who">{wall?.display ?? p.wall} replied</span>
                  <span className="text">{p.replyText}</span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function WalletProblem({ error, onConnect }: { error: string; onConnect: () => void }) {
  const discovery = /answered|detect|found/i.test(error);
  return (
    <section className="card pad stack" style={{ gap: 10, borderColor: "var(--accent)" }}>
      <p className="eyebrow">wallet</p>
      <h3 style={{ margin: 0 }}>
        {discovery ? "Nulo didn’t answer." : "The wallet stopped short."}
      </h3>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        {error}
      </p>
      {discovery && (
        <ul className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8, fontSize: 14 }}>
          <li>the extension is installed and switched on for this site</li>
          <li>the wallet is unlocked (Nulo needs its password or passkey)</li>
          <li>you reloaded the page after installing it</li>
        </ul>
      )}
      <button className="btn" onClick={onConnect}>
        try again
      </button>
    </section>
  );
}

function Finder({
  tone,
  glyph,
  eyebrow,
  label,
  placeholder,
  action,
  onOpen,
}: {
  tone: "primary" | "quiet";
  glyph: "wall" | "eye";
  eyebrow: string;
  label: string;
  placeholder: string;
  action: string;
  onOpen: (handle: string) => void;
}) {
  const [handle, setHandle] = useState("");
  const [preview, setPreview] = useState<{ notes: number; claimed: boolean } | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const clean = handle.trim().toLowerCase();
    if (!clean) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const id = setTimeout(() => {
      import("../lib/chain")
        .then(async (chain) => {
          const rows = await chain.readWall(clean, "");
          const claimed = await chain.isClaimed(clean, "");
          if (!cancelled) setPreview({ notes: rows.length, claimed });
        })
        .catch(() => {
          if (!cancelled) setPreview(null);
        })
        .finally(() => {
          if (!cancelled) setChecking(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [handle]);

  const Icon = glyph === "wall" ? WallGlyph : EyeGlyph;

  return (
    <section className={`finder ${tone}`}>
      <header className="finder-head">
        <span className="finder-glyph" aria-hidden="true">
          <Icon />
        </span>
        <div>
          <h3>{eyebrow}</h3>
          <p className="finder-sub">{label}</p>
        </div>
      </header>

      <div className="prefix-wrap">
        <span className="at">@</span>
        <input
          id={eyebrow}
          className="input prefix mono"
          placeholder={placeholder}
          value={handle}
          onChange={(e) => setHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && handle.trim()) onOpen(handle.trim().toLowerCase());
          }}
        />
      </div>

      <div className="finder-state">
        {checking && !preview && <span className="chip">checking…</span>}
        {preview && preview.notes === 0 && <span className="chip">no notes yet</span>}
        {preview && preview.notes > 0 && (
          <>
            <span className="chip">
              {preview.notes} {preview.notes === 1 ? "note" : "notes"}
            </span>
            <span className={`chip ${preview.claimed ? "accent" : ""}`}>
              {preview.claimed ? "claimed" : "unclaimed"}
            </span>
          </>
        )}
        {!checking && !preview && (
          <span className="finder-hint">
            {glyph === "wall"
              ? "the first note you leave creates this wall"
              : "your wall already exists, or your first visitor will make it"}
          </span>
        )}
      </div>

      <button
        className={`btn ${tone === "primary" ? "primary" : "ghost"} wide`}
        disabled={!handle.trim()}
        onClick={() => onOpen(handle.trim().toLowerCase())}
      >
        {action}
      </button>
    </section>
  );
}

function WallGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="2" y="5" width="8" height="4.5" rx="1" />
      <rect x="12" y="5" width="10" height="4.5" rx="1" />
      <rect x="2" y="11.5" width="5" height="4.5" rx="1" />
      <rect x="9" y="11.5" width="13" height="4.5" rx="1" />
      <rect x="6" y="18" width="12" height="3.5" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function EyeGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}
