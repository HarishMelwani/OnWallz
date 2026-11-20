import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../lib/types";
import { canWrite, normAddress, postsFor } from "../lib/store";
import { timeAgo, untilTomorrow } from "../lib/format";
import { Sigil } from "./Sigil";
import { Composer } from "./Composer";

type Props = {
  snap: Snapshot;
  handle: string;
  onWrite: (text: string, identity: { mode: 0 | 1; tag?: string }) => Promise<string | null>;
  onReply: (postId: string, text: string) => Promise<string | null>;
  onHome: () => void;
  goCreate: () => void;
  walletConnected: boolean;
  onConnect: () => void;
  /** Whether the chain says this wall already has an owner. */
  wallClaimed: boolean | null;
  onClaim: () => void;
};

export function Wall({
  snap,
  handle,
  onWrite,
  onReply,
  onHome,
  goCreate,
  walletConnected,
  onConnect,
  wallClaimed,
  onClaim,
}: Props) {
  const page = snap.pages[handle];
  const posts = postsFor(snap, handle);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  // The newest note gets a brief highlight, so a landed write is unmistakable.
  const [landed, setLanded] = useState<number | null>(null);
  const prevCount = useRef(posts.length);
  useEffect(() => {
    if (posts.length > prevCount.current && posts.length > 0) {
      const newest = posts[posts.length - 1].index;
      setLanded(newest);
      const id = setTimeout(() => setLanded(null), 1200);
      prevCount.current = posts.length;
      return () => clearTimeout(id);
    }
    prevCount.current = posts.length;
  }, [posts.length]);
  const [replyText, setReplyText] = useState("");
  const [busy, setBusy] = useState(false);
  const [replyElapsed, setReplyElapsed] = useState(0);
  useEffect(() => {
    if (!busy) {
      setReplyElapsed(0);
      return;
    }
    const started = Date.now();
    const id = setInterval(() => setReplyElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);
  const [error, setError] = useState<string | null>(null);

  if (!page) {
    // No wall yet: nobody has written about this identity. Claiming is not
    // offered here on purpose - a wall has to exist before it can be claimed.
    return (
      <div className="card" style={{ overflow: "hidden" }}>
        <div className="wall-head">
          <Sigil seed={`page:${handle}`} size={52} />
          <div className="who grow">
            <h2>@{handle}</h2>
            <div className="hint">Nobody has written on this wall yet.</div>
          </div>
        </div>

        {error && (
          <div className="composer">
            <div className="notice">{error}</div>
          </div>
        )}

        {!walletConnected ? (
          <div className="composer">
            <div className="notice">
              <span className="grow">connect a wallet to write the first message.</span>
              <button className="btn sm" onClick={onConnect}>
                connect Nulo
              </button>
            </div>
          </div>
        ) : (
          <Composer
            mode="ready"
            ownerName={handle}
           
            busy={busy}
            onSend={(text, identity) => send(text, identity)}
          />
        )}
      </div>
    );
  }

  const isOwner = !!(snap.me && normAddress(page.owner) === snap.me.id);
  const check = canWrite(snap, handle);



  async function send(text: string, identity: { mode: 0 | 1; tag?: string }) {
    setBusy(true);
    setError(null);
    try {
      const err = await onWrite(text, identity);
      if (err) setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function submitReply(p: string) {
    if (!replyText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const err = await onReply(p, replyText.trim());
      if (err) setError(err);
      else {
        setReplyTo(null);
        setReplyText("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div className="wall-head">
        <Sigil seed={`page:${handle}`} size={52} />
        <div className="who grow">
          <h2>{page.display}</h2>
          <div className="row" style={{ marginTop: 4 }}>
            <span className="handle">{handle}</span>
            <span className="chip">
              {posts.length} {posts.length === 1 ? "note" : "notes"}
            </span>
            {isOwner && <span className="chip accent">yours</span>}
            {!isOwner && walletConnected && wallClaimed === false && posts.length > 0 && (
              <button className="btn sm" onClick={onClaim}>
                claim @{handle}
              </button>
            )}
          </div>
        </div>
      </div>

      {!isOwner && !walletConnected && (
        <div className="composer">
          <div className="notice">
            <span className="grow">connect a wallet to write here.</span>
            <button className="btn sm" onClick={onConnect}>
              connect Nulo
            </button>
          </div>
        </div>
      )}

      {!isOwner && walletConnected && check.status === "ready" && (
        <Composer mode="ready" ownerName={page.display} busy={busy} onSend={(t, id) => send(t, id)} />
      )}


      {!isOwner && walletConnected && check.status === "blocked" && (
        <div className="composer">
          <div className="notice">
            you&rsquo;ve written on this wall today. the next window opens in{" "}
            <strong>{untilTomorrow()}</strong>.
          </div>
        </div>
      )}


      {isOwner && (
        <div className="composer">
          <div className="notice">
            <span className="grow">
              {walletConnected
                ? "this is your wall. reply to a note and its writer gets one more."
                : "this is your wall. reconnect to reply."}
            </span>
            {!walletConnected && (
              <button className="btn sm" onClick={onConnect}>
                reconnect
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="composer" style={{ paddingTop: 0 }}>
          <div className="notice">{error}</div>
        </div>
      )}

      <div className="posts">

        {posts.length === 0 ? (
          <div className="empty">
            <span className="glyph">·</span>
            nothing here yet.
            <br />
            <span className="hint">send the link to someone who has something to say.</span>
          </div>
        ) : (
          posts.map((p) => (
            <article className={`post${p.index === landed ? " landed" : ""}`} key={p.id}>
              <Sigil seed={p.id} size={40} />
              <div className="body">
                <div className="meta">
                  <span className="muted" style={{ fontSize: 13 }}>
                    {p.mode === 1 && p.tag ? `@${p.tag}` : "someone"}
                  </span>
                  {p.mode === 1 && (
                    <span className="chip" style={{ marginLeft: 6 }}>
                      self-declared
                    </span>
                  )}
                  {p.ts ? <span className="when">· {timeAgo(p.ts)}</span> : null}
                </div>
                {p.deleted ? (
                  <div className="text muted" style={{ fontStyle: "italic" }}>
                    withdrawn by its author
                  </div>
                ) : (
                  <div className="text">{p.text}</div>
                )}

                {p.replied && (
                  <div className="reply">
                    <span className="who">{page.display} replied</span>
                    <span className="text">{p.replyText}</span>
                  </div>
                )}

                {walletConnected && !p.replied && replyTo !== p.id && (
                  <button
                    className="btn ghost sm"
                    style={{ marginTop: 10, paddingLeft: 0 }}
                    onClick={() => {
                      setReplyTo(p.id);
                      setReplyText("");
                    }}
                  >
                    reply ↗
                  </button>
                )}

                {walletConnected && replyTo === p.id && (
                  <div style={{ marginTop: 12 }} className="stack">
                    <textarea
                      className="textarea"
                      style={{ minHeight: 64 }}
                      placeholder="answer them."
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      autoFocus
                      maxLength={140}
                    />
                    <div className="row">
                      <button
                        className="btn ghost sm"
                        onClick={() => {
                          setReplyTo(null);
                          setReplyText("");
                        }}
                      >
                        cancel
                      </button>
                      <span className="grow" />
                      <button
                        className={`btn primary sm ${busy ? "sealing" : ""}`}
                        disabled={busy || !replyText.trim()}
                        onClick={() => submitReply(p.id)}
                      >
                        {busy ? (
                          <>
                            <span className="brick-spin" aria-hidden="true" />
                            sealing…
                          </>
                        ) : (
                          "reply"
                        )}
                      </button>
                    </div>
                    {busy && (
                      <p className="seal-line" role="status" aria-live="polite">
                        <span className="seal-bar" aria-hidden="true" />
                        <span>
                          proving on your device · {replyElapsed}s
                          {replyElapsed > 20 ? ", the proof is the slow part" : ""}
                        </span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}