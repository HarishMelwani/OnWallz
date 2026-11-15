import { useEffect, useState } from "react";

const LIMIT = 93;

type Identity = { mode: 0 | 1; tag?: string };

type Props = {
  mode: "ready" | "bonus";
  ownerName: string;
  busy?: boolean;
  onSend: (text: string, identity: Identity) => void;
};

export function Composer({ mode, ownerName, busy, onSend }: Props) {
  const [text, setText] = useState("");
  
  
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);
  const left = LIMIT - text.length;
  const ready = text.trim().length > 0 && left >= 0;

  
  const canSend = ready;

  function send() {
    console.info("[onwallz] composer click", { canSend, ready, len: text.length });
    if (!canSend) return;
    // Always anonymous: the author is never recorded, and the wallet never attaches one.
    onSend(text.trim(), { mode: 0 });
    setText("");
  }

  return (
    <div className="composer">
      {mode === "bonus" && (
        <div className="notice good" style={{ marginBottom: 12 }}>
          {ownerName} replied to you, so you can write again.
        </div>
      )}
      <div className="field">
        <label htmlFor="note">
          write on {ownerName}&rsquo;s wall <span className="muted">. they won&rsquo;t know it was you</span>
        </label>
        <textarea
          id="note"
          className="textarea"
          placeholder="say the thing."
          value={text}
          maxLength={LIMIT}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
          }}
        />
      </div>
      <div className="row">
        <span className={`counter ${left < 0 ? "over" : ""}`}>
          {text.length}/{LIMIT}
        </span>
        <span className="spacer grow" />
        <span className="hint" style={{ marginRight: 8 }}>
          <span className="kbd">⌘</span> <span className="kbd">↵</span>
        </span>
        <button
          type="button"
          className={`btn primary ${busy ? "sealing" : ""}`}
          disabled={!canSend || busy}
          onClick={send}
        >
          {busy ? (
            <>
              <span className="brick-spin" aria-hidden="true" />
              sealing…
            </>
          ) : (
            "leave it"
          )}
        </button>
      </div>

      {busy && (
        <p className="seal-line" role="status" aria-live="polite">
          <span className="seal-bar" aria-hidden="true" />
          <span>
            proving on your device · {elapsed}s
            {elapsed > 20 ? ", the proof is the slow part, not the network" : ""}
          </span>
        </p>
      )}
    </div>
  );
}