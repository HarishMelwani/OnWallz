import { useEffect, useRef, useState } from "react";

/**
 * Diagnostics page (#/probe). Shows what the page actually sees: whether the
 * wallet content script answers the discovery postMessage, and what came back.
 */
export function Probe() {
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const seen = useRef<string[]>([]);

  const push = (line: string) => {
    seen.current = [...seen.current, line];
    setLines([...seen.current]);
  };

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window) return;
      const raw = typeof e.data === "string" ? e.data : safeJson(e.data);
      const ports = e.ports?.length ?? 0;
      push(`message ← ${raw.slice(0, 220)}${ports ? `  [${ports} port]` : ""}`);
    };
    window.addEventListener("message", onMessage);
    push(`origin        ${window.location.origin}`);
    push(`secure        ${window.isSecureContext}`);
    push(`nulo present  ${"nulo" in window || "aztec" in window ? "maybe" : "no global"}`);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function run() {
    setRunning(true);
    push("--- starting discovery ---");
    try {
      const { WalletManager } = await import("@aztec-labs/wallet-sdk/manager");
      const { Fr } = await import("@aztec-labs/foundation/curves/bn254");
      push("sdk loaded ok");
      const manager = WalletManager.configure({ extensions: { enabled: true } });
      const discovery = manager.getAvailableWallets({
        chainInfo: { chainId: Fr.ZERO, version: Fr.ZERO },
        appId: "onwallz",
        timeout: 10_000,
      });
      const timer = setTimeout(() => push("no response in 10s"), 10_000);
      for await (const provider of discovery.wallets) {
        clearTimeout(timer);
        push(`FOUND: ${provider.name} (${provider.id})`);
        break;
      }
      clearTimeout(timer);
      discovery.cancel?.();
      push("--- done ---");
    } catch (err) {
      push(`ERROR: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <p className="eyebrow">diagnostics</p>
        <h1>What the page can see.</h1>
      </div>
      <button className="btn primary" onClick={run} disabled={running}>
        {running ? "running…" : "run discovery test"}
      </button>
      <button
        className="btn"
        onClick={() => navigator.clipboard?.writeText(lines.join("\n"))}
      >
        copy log
      </button>
      <pre className="card pad mono" style={{ fontSize: 12, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
        {lines.join("\n") || "…"}
      </pre>
    </div>
  );
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}