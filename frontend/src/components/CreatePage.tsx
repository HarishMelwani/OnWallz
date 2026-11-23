import { useState } from "react";
import type { WalletState } from "../lib/wallet";

type Props = {
  onCreate: (handle: string, display: string) => Promise<string | null>;
  wallet: WalletState;
  onChain: boolean;
  onConnect: () => void;
};

export function CreatePage({ onCreate, wallet, onChain, onConnect }: Props) {
  const [handle, setHandle] = useState("");
  const [display, setDisplay] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const connected = wallet.status === "connected" && !!wallet.address;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const err = await onCreate(handle, display);
    setError(err);
    setPending(false);
  }

  if (!connected) {
    return (
      <div className="stack" style={{ maxWidth: 460 }}>
        <div>
          <p className="eyebrow">step one</p>
          <h1>Make your wall.</h1>
          <p className="lede" style={{ marginTop: 12 }}>
            A wall belongs to a wallet. Connect yours and the page is registered to it
            . nobody can claim your handle without that address.
          </p>
        </div>

        <div className="card pad stack">
          <p className="eyebrow">wallet</p>
          <h3 style={{ margin: 0 }}>
            {wallet.status === "error" ? "Nulo didn't answer." : "No wallet connected."}
          </h3>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            {wallet.error ?? "Registration happens through your wallet, so it has to be connected first."}
          </p>
          <button
            className="btn primary"
            onClick={onConnect}
            disabled={wallet.status === "discovering" || wallet.status === "connecting" || wallet.status === "awaiting-approval"}
          >
            {wallet.status === "discovering"
              ? "looking for Nulo…"
              : wallet.status === "connecting" || wallet.status === "awaiting-approval"
                ? "check the Nulo window…"
                : "connect Nulo"}
          </button>
          <span className="hint">your address becomes the owner of the page, not its name.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="stack" style={{ maxWidth: 460 }}>
      <div>
        <p className="eyebrow">step one</p>
        <h1>Make your wall.</h1>
        <p className="lede" style={{ marginTop: 12 }}>
          One page, one handle. People can write on it, and you will never know who.
        </p>
      </div>

      <form className="card pad stack" onSubmit={submit}>
        <div className="connected-line">
          <span className="dot" />
          <span className="mono">{wallet.address}</span>
        </div>

        <div className="field">
          <label htmlFor="handle">handle</label>
          <div className="prefix-wrap">
            <span className="at">@</span>
            <input
              id="handle"
              className="input prefix mono"
              placeholder="yourname"
              value={handle}
              autoFocus
              onChange={(e) => setHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))}
              maxLength={20}
            />
          </div>
          <span className="hint">your address on the wall. lowercase, permanent.</span>
        </div>

        <div className="field">
          <label htmlFor="display">display name</label>
          <input
            id="display"
            className="input"
            placeholder="what people see at the top"
            value={display}
            onChange={(e) => setDisplay(e.target.value)}
            maxLength={31}
          />
        </div>

        {error && <div className="notice">{error}</div>}

        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? (onChain ? "signing…" : "creating…") : "create my wall"}
        </button>

        <span className="hint">
          {onChain
            ? "this sends a create_page transaction. Nulo simulates and proves it, then asks you to approve."
            : "your wallet signs for the page. contract address not set, so the record stays in this browser."}
        </span>
      </form>
    </div>
  );
}