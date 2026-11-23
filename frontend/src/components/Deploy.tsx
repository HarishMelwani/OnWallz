import { useState } from "react";
import type { WalletState } from "../lib/wallet";
import { isAddress, liveAddress, persistAddress } from "../lib/config";

type Props = {
  wallet: WalletState;
  onConnect: () => void;
  address: string | null;
};

export function Deploy({ wallet, onConnect, address }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  const connected = wallet.status === "connected" && !!wallet.address;
  const current = done ?? (liveAddress() || null);

  async function run() {
    if (!wallet.address) return;
    setPending(true);
    setError(null);
    try {
      const chain = await import("../lib/chain");
      const deployed = await chain.deployWalls(wallet.address);
      await persistAddress(deployed);
      setDone(deployed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  async function useExisting() {
    const value = manual.trim();
    if (!isAddress(value)) {
      setError("that is not a contract address (0x + 64 hex characters)");
      return;
    }
    await persistAddress(value);
    setDone(value);
    setError(null);
  }

  return (
    <div className="stack" style={{ maxWidth: 540 }}>
      <div>
        <p className="eyebrow">one time</p>
        <h1>Point OnWallz at a contract.</h1>
        <p className="lede" style={{ marginTop: 12 }}>
          The contract has to exist on a network before anyone can own a page.
        </p>
      </div>

      <div className="card pad stack">
        <div className="connected-line">
          <span className={connected ? "dot" : "dot pending"} />
          <span className="mono">{wallet.address ?? "no wallet connected"}</span>
        </div>

        {!connected && (
          <button className="btn primary" onClick={onConnect}>
            connect Nulo
          </button>
        )}

        {connected && (
          <button className="btn primary" onClick={run} disabled={pending}>
            {pending ? "deploying… check Nulo" : "deploy a new contract"}
          </button>
        )}

        {error && <div className="notice">{error}</div>}

        {current && (
          <div className="stack" style={{ gap: 8 }}>
            <p className="eyebrow" style={{ margin: 0 }}>using contract</p>
            <span className="mono" style={{ wordBreak: "break-all", fontSize: 13 }}>
              {current}
            </span>
            <button className="btn" onClick={() => location.assign("#/")}>
              go to OnWallz
            </button>
            <span className="hint">
              copy this into VITE_ONWALLZ_ADDRESS in .env.local. storage can be cleared,
              a build cannot.
            </span>
          </div>
        )}

        <div className="field">
          <label htmlFor="existing">already deployed? paste the address</label>
          <input
            id="existing"
            className="input mono"
            placeholder="0x…"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
          <button className="btn" onClick={useExisting} disabled={!manual.trim()}>
            use this address
          </button>
        </div>
      </div>
    </div>
  );
}