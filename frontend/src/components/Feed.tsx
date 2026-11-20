import { useEffect, useState } from "react";
import { readActivity } from "../lib/chain";
import { Sigil } from "./Sigil";
import { timeAgo } from "../lib/format";

type Item = Awaited<ReturnType<typeof readActivity>>[number];

type Props = {
  address: string | null;
  contractReady: boolean;
  goWall: (wall: string) => void;
};

export function Feed({ address, contractReady, goWall }: Props) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"latest" | "trending">("latest");

  useEffect(() => {
    if (!contractReady) return;
    let cancelled = false;
    setItems(null);
    setError(null);
    readActivity(40, address ?? "")
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    // The feed is public data; polling it keeps new notes visible without a reload.
    const id = setInterval(() => {
      readActivity(40, address ?? "")
        .then((rows) => {
          if (!cancelled) setItems(rows);
        })
        .catch(() => {});
    }, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [contractReady, address]);

  const trending =
    items &&
    Object.values(
      items.reduce<Record<string, { wall: string; handle: string; posts: number; replies: number }>>(
        (acc, it) => {
          const w = it.wall || "unknown";
          acc[w] ??= { wall: w, handle: it.handle || "", posts: 0, replies: 0 };
          if (!acc[w].handle && it.handle) acc[w].handle = it.handle;
          acc[w].posts += 1;
          if (it.replied) acc[w].replies += 1;
          return acc;
        },
        {},
      ),
    )
      // A wall without a stored name cannot be opened by handle, so listing it
      // would be a dead end (and used to show a raw wall id as "@0x…").
      .filter((t) => t.handle.length > 0)
      .sort((a, b) => b.posts - a.posts)
      .slice(0, 10);

  if (!contractReady) {
    return (
      <div className="empty">
        <span className="glyph">◌</span>
        <h2>no contract configured</h2>
        <p className="muted">the feed reads from the chain, so OnWallz needs a deployed contract first.</p>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <header className="row" style={{ alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div className="who grow">
          <h2>the feed</h2>
          <span className="hint">who wrote what, on whose wall</span>
        </div>
        <div className="seg" role="group" aria-label="feed section">
          <button
            className={`btn sm ${tab === "latest" ? "primary" : "ghost"}`}
            onClick={() => setTab("latest")}
          >
            latest
          </button>
          <button
            className={`btn sm ${tab === "trending" ? "primary" : "ghost"}`}
            onClick={() => setTab("trending")}
          >
            trending
          </button>
          <span className="spacer grow" />
        </div>
      </header>

      {error && (
        <div className="composer">
          <div className="notice">could not read the feed: {error}</div>
        </div>
      )}

      {items === null && !error && (
        <div className="posts">
          <div className="empty">
            <span className="glyph">·</span>
            reading the chain…
          </div>
        </div>
      )}

      {items?.length === 0 && (
        <div className="posts">
          <div className="empty">
            <span className="glyph">·</span>
            nothing on any wall yet.
            <br />
            <span className="hint">be the first to leave something.</span>
          </div>
        </div>
      )}

      <section className="card pad">
        <div className="feed">
        {tab === "latest" &&
          items?.map((it) => {
            const target = it.handle || it.wall.slice(0, 10);
            return (
              <button
                key={it.seq}
                className="item item-link"
                onClick={() => goWall(target)}
                title={`open @${target}`}
              >
                <div className="row">
                  <Sigil seed={`${it.seq}`} size={22} />
                  <span className="muted" style={{ fontSize: 12 }}>
                    anonymous wrote on <span className="mono">@{target}</span>
                  </span>
                  {it.ts ? (
                    <span className="muted" style={{ fontSize: 12 }}>
                      · {timeAgo(it.ts)}
                    </span>
                  ) : null}
                  <span className="spacer grow" />
                  <span className="muted" style={{ fontSize: 12 }}>
                    view ↗
                  </span>
                </div>
                <div className="text">{it.text}</div>
                {it.replied && (
                  <div className="reply">
                    <span className="who">@{target} replied</span>
                    <span className="text">{it.replyText}</span>
                  </div>
                )}
              </button>
            );
          })}

        {tab === "trending" &&
          trending?.map((t) => (
            <button
              key={t.wall}
              className="item item-link"
              onClick={() => goWall(t.handle)}
              title={`open @${t.handle}`}
            >
              <div className="row">
                <Sigil seed={t.wall} size={22} />
                <span className="muted" style={{ fontSize: 12 }}>
                  <span className="mono">@{t.handle}</span>
                </span>
                <span className="spacer grow" />
                <span className="muted" style={{ fontSize: 12 }}>
                  view ↗
                </span>
              </div>
              <div className="text">
                {t.posts} {t.posts === 1 ? "note" : "notes"} · {t.replies}{" "}
                {t.replies === 1 ? "reply" : "replies"}
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
