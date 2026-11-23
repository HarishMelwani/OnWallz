import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "./lib/types";
import * as db from "./lib/store";
import type { WalletState } from "./lib/wallet";
import { hasContract, liveAddress } from "./lib/config";
import { Topbar } from "./components/Topbar";
import { Home } from "./components/Home";
import { Wall } from "./components/Wall";
import { Probe } from "./components/Probe";
import { Deploy } from "./components/Deploy";
import { InAppWallet } from "./components/InAppWallet";
import { Feed } from "./components/Feed";

type Route =
  | { name: "home" }
  | { name: "feed" }
  | { name: "wall"; handle: string }
  | { name: "deploy" }
  | { name: "probe" };

function parse(hash: string): Route {
  const h = hash.replace(/^#\/?/, "");
  if (h.startsWith("w/")) return { name: "wall", handle: decodeURIComponent(h.slice(2)) };
  if (h === "feed") return { name: "feed" };
  if (h === "deploy") return { name: "deploy" };
  if (h === "probe") return { name: "probe" };
  return { name: "home" };
}

export default function App() {
  const [snap, setSnap] = useState<Snapshot>(() => db.load());
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  const [toast, setToast] = useState<string | null>(null);
  const [inAppOpen, setInAppOpen] = useState(false);
  // Remembered across reloads so a refresh never looks like "no wall yet".
  // Cleared only by an explicit disconnect.
  const [lastAddress, setLastAddress] = useState<string | null>(() =>
    localStorage.getItem("onwallz.last"),
  );
  const [wallet, setWallet] = useState<WalletState>({
    status: "idle",
    address: null,
    walletName: null,
    error: null,
    emojis: null,
  });


  useEffect(() => {
    const onHash = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  function go(hash: string) {
    window.location.hash = hash;
  }

  function commit(next: Snapshot) {
    setSnap(next);
    db.save(next);
  }

  const patchWallet = (s: Partial<WalletState>) => setWallet((w) => ({ ...w, ...s }));

  // The identity is whatever wallet is connected right now. Disconnecting drops
  // it instantly: no page, no ownership, no "yours" badge.
  const live = wallet.status === "connected" && !!wallet.address;
  // Identity comes from a connected wallet, never from a remembered address: a
  // logged-out visitor must not see a cached wall as if it were theirs.
  const knownAddress = wallet.status === "connected" ? wallet.address : null;
  const session = db.sessionFor(snap, knownAddress);

  const view = route;

  // Latest snapshot without making it an effect dependency (committing would loop).
  const [refreshKey, setRefreshKey] = useState(0);
  const [wallClaimed, setWallClaimed] = useState<boolean | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // The contract is the source of truth for a wall. On every wall view (and
  // after a write) we re-read it and replace the cached posts for that wall.
  useEffect(() => {
    if (view.name !== "wall") return;
    if (!hasContract()) return;
    // Reads are public. Without a wallet we still need *an* address to simulate
    // the view calls, so fall back to the contract's own address - it exists and
    // owns nothing, which is exactly what a visitor is.
    const from = wallet.address ?? "";
    let cancelled = false;
    (async () => {
      try {
        const chainLib = await import("./lib/chain");
        const rows = await chainLib.readWall(view.handle, from);
        if (cancelled) return;
        // A wall exists as soon as someone has written on it - not when its
        // owner founds it. Bring it into view from chain state alone.
        const claimed = await chainLib.isClaimed(view.handle, from);
        if (!cancelled) setWallClaimed(claimed);
        let next = db.replaceWallPosts(sessionRef.current, view.handle, rows);
        // A wall exists from the moment its owner creates it, even with zero notes, so
        // adopt on the claimed flag too. Otherwise an empty wall looked like a missing one.
        if ((rows.length > 0 || claimed) && !next.pages[view.handle]) {
          next = db.adoptPage(next, view.handle, view.handle, claimed ? "claimed" : "");
        }
        commit(next);
      } catch (err) {
        // Leave the cached view in place, but never hide why it stayed stale.
        console.warn("[onwallz] could not read the wall from the contract:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, wallet.status, wallet.address, refreshKey]);


  useEffect(() => {
    if (knownAddress) {
      console.info(
        "[onwallz] session:",
        { address: knownAddress, owns: session.me?.handle ?? null },
        "pages:",
        Object.values(snap.pages).map((p) => `${p.handle}→${p.owner.slice(0, 10)}`),
      );
    }
  }, [knownAddress, session.me?.handle, snap.pages]);

  useEffect(() => {
  }, [route.name, session.me?.handle]);

  async function connect() {
    const walletLib = await import("./lib/wallet");
    const result = await walletLib.connect(patchWallet);
    if ("error" in result) {
      setToast(result.error);
      return;
    }

    // A wallet may share several accounts. Prefer the one that already owns a
    // wall, so reconnecting never looks like "this wallet has no wall".
    const accounts = result.accounts;
    const owning = accounts.find((a) => db.pageForOwner(snap, a.address));
    const address = (owning ?? accounts[0]).address;

    if (address !== wallet.address) patchWallet({ address });
    setLastAddress(address);
    localStorage.setItem("onwallz.last", address);
    localStorage.setItem("onwallz.connected", "1");

    // Ownership lives in the wallet's private note. Ask the contract rather than the
    // cache, so a cleared browser or a new device still finds the wall.
    if (hasContract()) {
      try {
        const chain = await import("./lib/chain");
        const owned = await chain.myWall(address);
        if (owned && !db.pageForOwner(snap, address)) {
          commit(db.adoptPage(snap, owned, owned, address));
          setToast(`restored @${owned} from your wallet`);
          return;
        }
      } catch (err) {
        console.warn("[onwallz] could not read your wall from the contract:", err);
      }
    }

    setToast(
      accounts.length > 1
        ? `connected as ${address.slice(0, 6)}…${address.slice(-4)} (${accounts.length} accounts)`
        : "wallet connected",
    );
  }

  /** Ask the contract which wall this wallet owns, and adopt it locally. */
  async function restoreWall(): Promise<string | null> {
    if (wallet.status !== "connected" || !wallet.address) return "connect your wallet first";
    try {
      const chain = await import("./lib/chain");
      const owned = await chain.myWall(wallet.address);
      if (!owned) return "this wallet has no wall yet";
      commit(db.adoptPage(snap, owned, owned, wallet.address));
      setToast(`restored @${owned} from your wallet`);
      return null;
    } catch (err) {
      return `could not read your wall: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /** Called after the in-page wallet is created, imported or resumed. */
  async function connectedInApp(address: string) {
    setLastAddress(address);
    localStorage.setItem("onwallz.last", address);
    localStorage.setItem("onwallz.connected", "1");
    // The modal stays open after a create so the backup can be shown; it closes
    // itself once the user confirms they saved it.
    setToast("in-app wallet ready");
    try {
      const chain = await import("./lib/chain");
      const owned = await chain.myWall(address);
      if (owned && !db.pageForOwner(snap, address)) {
        commit(db.adoptPage(snap, owned, owned, address));
        setToast(`restored @${owned} from your wallet`);
      }
    } catch {
      // a wallet with no wall is a normal state
    }
  }

  async function disconnect() {
    const walletLib = await import("./lib/wallet");
    await walletLib.disconnect(patchWallet);
    localStorage.removeItem("onwallz.last");
    localStorage.removeItem("onwallz.connected");
    setLastAddress(null);
    setToast("disconnected");
  }

  async function create(handle: string, display: string): Promise<string | null> {
    const h = handle.trim().toLowerCase();

    if (wallet.status !== "connected" || !wallet.address) {
      return "connect your wallet first. a page belongs to an address";
    }

    if (hasContract()) {
      try {
        const chain = await import("./lib/chain");
        await chain.createWall(h, wallet.address);
        setToast("your wall is on Aztec");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return message;
      }
    }

    const { snapshot, error } = db.createPage(snap, h, display, wallet.address);
    if (error) return error;
    commit(snapshot);
    go(`#/w/${h}`);
    return null;
  }




  async function write(
    wall: string,
    text: string,
    identity: { mode: 0 | 1; tag?: string },
  ): Promise<string | null> {
    if (wallet.status !== "connected" || !wallet.address) {
      return "connect your wallet to write";
    }
    // No local pre-flight and no local mirror: the transaction is the state
    // change. If the contract rejects it, nothing was written.
    setToast("sending to the chain…");
    try {
      const chain = await import("./lib/chain");
      console.info("[onwallz] write: resolving wall", wall);
      const before = (await chain.readWall(wall, wallet.address)).length;
      await chain.writeOnWall(wall, text, wallet.address, identity);

      // The transaction is submitted, not proven-in-page. Poll the chain briefly so
      // the note appears the moment it is actually readable, without a manual reload.
      for (let attempt = 0; attempt < 12; attempt++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const rows = await chain.readWall(wall, wallet.address);
          if (rows.length > before) break;
        } catch {
          // transient read error: keep waiting
        }
      }
      console.info("[onwallz] write: submitted");
    } catch (err) {
      const message = `the contract rejected this: ${err instanceof Error ? err.message : String(err)}`;
      console.error("[onwallz] write failed:", err);
      setToast(message);
      return message;
    }
    setRefreshKey((k) => k + 1);
    setToast("left on the wall. no name attached.");
    return null;
  }


  async function reply(wall: string, postId: string, text: string): Promise<string | null> {
    if (wallet.status !== "connected" || !wallet.address) {
      return "connect your wallet to reply";
    }
    try {
      const chain = await import("./lib/chain");
      await chain.replyToPost(wall, postId, text, wallet.address);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      return `the contract rejected this reply: ${err instanceof Error ? err.message : String(err)}`;
    }
    setRefreshKey((k) => k + 1);
    setToast("replied");
    return null;
  }

  async function linkFogName(handle: string, label: string): Promise<string | null> {
    if (wallet.status !== "connected" || !wallet.address) {
      return "connect your wallet to link a Fog name";
    }
    try {
      const chain = await import("./lib/chain");
      await chain.linkFog(handle, label, wallet.address);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
    setToast("fog name linked");
    return null;
  }

  async function unlinkFogName(handle: string): Promise<string | null> {
    if (wallet.status !== "connected" || !wallet.address) {
      return "connect your wallet first";
    }
    try {
      const chain = await import("./lib/chain");
      await chain.unlinkFog(handle, wallet.address);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
    setToast("fog name unlinked");
    return null;
  }

  return (
    <div className="shell">
      <Topbar
        me={session.me?.handle ?? null}
        wallet={wallet}
        onHome={() => go("#/")}
        onConnect={connect}
        onDisconnect={disconnect}
        onOpenInApp={() => setInAppOpen(true)}
      />

      {wallet.status === "verifying" && wallet.emojis && (
        <div
          className="verify-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="verify-title"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              void import("./lib/wallet").then((w) => w.confirmVerification(false));
            }
          }}
        >
          <div className="verify-card">
            <p className="eyebrow" id="verify-title">
              match these with {wallet.walletName ?? "your wallet"}
            </p>
            <div className="emoji-grid" aria-label="connection verification emojis">
              {[...wallet.emojis].map((e, i) => (
                <span key={i} role="img" aria-label={`emoji ${i + 1}`}>
                  {e}
                </span>
              ))}
            </div>
            <p className="hint" style={{ margin: 0 }}>
              Your wallet shows the same nine emojis. If any differ, someone may be
              intercepting this connection, so refuse it.
            </p>
            <div className="row">
              <button
                className="btn primary"
                autoFocus
                onClick={async () => (await import("./lib/wallet")).confirmVerification(true)}
              >
                they match
              </button>
              <button
                className="btn ghost"
                onClick={async () => (await import("./lib/wallet")).confirmVerification(false)}
              >
                they don&rsquo;t match
              </button>
            </div>
          </div>
        </div>
      )}

      <main className={`main ${view.name === "home" || view.name === "feed" ? "wide" : ""}`}>
        {view.name === "home" && (
          <Home
            snap={session}
            onLookup={(h) => go(`#/w/${h}`)}
            onCreate={(h) => create(h, h)}
            onRestore={restoreWall}
            walletError={wallet.status === "error" ? wallet.error : null}
            onConnect={connect}
            walletConnected={wallet.status === "connected"}
            address={knownAddress}
          />
        )}

        {view.name === "probe" && <Probe />}

        {view.name === "deploy" && (
          <Deploy wallet={wallet} onConnect={connect} address={knownAddress} />
        )}

        {view.name === "feed" && (
          <Feed
            address={wallet.address}
            contractReady={hasContract()}
            goWall={(wall) => go(`#/w/${encodeURIComponent(wall)}`)}
          />
        )}



        {view.name === "wall" && (
          <Wall
            snap={session}
            handle={view.handle}
            onWrite={(t, id) => write(view.handle, t, id)}
            onReply={(id, t) => reply(view.handle, id, t)}
            onHome={() => go("#/")}
            goCreate={() => go("#/")}
            walletConnected={wallet.status === "connected"}
            onConnect={connect}
            wallClaimed={wallClaimed}
            onLinkFog={linkFogName}
            onUnlinkFog={unlinkFogName}
          />
        )}
      </main>

      <footer className="foot">OnWallz · anonymous authorship on aztec · nulo wallet</footer>

      {inAppOpen && (
        <InAppWallet
          onState={patchWallet as never}
          onConnected={(address) => {
            void connectedInApp(address);
          }}
          onClose={() => setInAppOpen(false)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}