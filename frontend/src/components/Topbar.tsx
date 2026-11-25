import { useEffect, useState } from "react";
import type { WalletState } from "../lib/wallet";
import { Logo } from "./Logo";

type Props = {
  me: string | null;
  wallet: WalletState;
  onHome: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onOpenInApp: () => void;
  meVerified: boolean;
};

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function Topbar({ me, wallet, onHome, onConnect, onDisconnect, onOpenInApp, meVerified }: Props) {
  const [dark, setDark] = useState(() => {
    // A link can select the theme, which also makes screenshots and shared links
    // land in the state they describe.
    const fromUrl = new URLSearchParams(window.location.search).get("theme");
    if (fromUrl === "dark") return true;
    if (fromUrl === "light") return false;
    return document.documentElement.dataset.theme === "dark";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("onwallz.theme", dark ? "dark" : "light");
  }, [dark]);

  const [waited, setWaited] = useState(0);
  useEffect(() => {
    if (wallet.status !== "discovering") {
      setWaited(0);
      return;
    }
    const startedAt = Date.now();
    const id = setInterval(() => setWaited(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(id);
  }, [wallet.status]);

  const connected = wallet.status === "connected" && !!wallet.address;
  const busy =
    wallet.status === "discovering" ||
    wallet.status === "connecting" ||
    wallet.status === "awaiting-approval";

  return (
    <header className="topbar">
      <a
        href="#/"
        className="wordmark"
        onClick={(e) => {
          e.preventDefault();
          onHome();
        }}
      >
        <Logo />
        <span className="wordmark-text">
          OnWallz<span className="dot">.</span>
        </span>
      </a>

      <a className="btn ghost sm" href="#/feed" style={{ marginLeft: 8 }}>
        feed
      </a>



      <span className="spacer" />

      {me && <span className={`at${meVerified ? " verified" : ""}`}>@{me}</span>}

      {connected ? (
        <span className="row" style={{ gap: 6 }}>
          <span className="chip connected mono" title={wallet.address ?? undefined}>
            <span className="dot" />
            {short(wallet.address!)}
          </span>
          <button className="btn ghost sm" onClick={onDisconnect} title="disconnect this wallet">
            disconnect
          </button>
        </span>
      ) : busy ? (
        <span className="chip mono muted">
          <span className="dot pending" />
          {wallet.status === "discovering"
            ? waited >= 2
              ? `waking Nulo… ${waited}s`
              : "looking for Nulo…"
            : wallet.status === "connecting"
              ? "opening Nulo…"
              : "approve in Nulo…"}
        </span>
      ) : (
        <span className="row" style={{ gap: 6 }}>
          <button className="btn sm" onClick={onConnect} title={wallet.error ?? "connect Nulo"}>
            connect Nulo
          </button>
          <button
            className="btn ghost sm"
            onClick={onOpenInApp}
            title="no extension needed: create a wallet in this browser"
          >
            in-app wallet
          </button>
        </span>
      )}

      <button
        className="btn ghost sm"
        onClick={() => setDark(!dark)}
        aria-label={dark ? "switch to light" : "switch to dark"}
        title={dark ? "light" : "dark"}
      >
        {dark ? "☾" : "☀"}
      </button>
    </header>
  );
}