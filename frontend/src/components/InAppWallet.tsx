import { useState } from "react";
import { connectInApp } from "../lib/wallet";
import { exportBackup, forgetWallet, hasStoredWallet } from "../lib/inAppStore";

type Props = {
  onState: (s: Record<string, unknown>) => void;
  onConnected: (address: string) => void;
  onClose: () => void;
};

/**
 * Create, import, export or forget the in-page wallet. Everything here happens inside
 * this browser: no extension, no permission prompt, no fee juice (testnet pays through
 * the sponsored contract).
 */
export function InAppWallet({ onState, onConnected, onClose }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backup, setBackup] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [confirmReplace, setConfirmReplace] = useState(false);

  async function run(mode: "create" | "import" | "resume", text?: string) {
    setBusy(mode);
    setError(null);
    const result = await connectInApp(mode, onState as never, text);
    setBusy(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onConnected(result.address);
    if (mode === "create") {
      setBackup(exportBackup());
    } else {
      onClose();
    }
  }

  return (
    <div className="verify-overlay" role="dialog" aria-modal="true" aria-labelledby="inapp-title">
      <div className="verify-card" style={{ width: "min(440px, 100%)", alignItems: "stretch", textAlign: "left" }}>
        <p className="eyebrow" id="inapp-title">
          in-app wallet
        </p>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          A wallet inside this browser. Keys stay here, proofs run here, so a write takes
          longer than with Nulo. Your backup below is the only way to recover it.
        </p>

        {backup ? (
          <>
            <p className="eyebrow" style={{ marginBottom: 4 }}>
              your backup, keep it
            </p>
            <textarea
              className="textarea mono"
              readOnly
              rows={8}
              value={backup}
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="row">
              <button className="btn primary" onClick={onClose}>
                I saved it
              </button>
              <button
                className="btn ghost"
                onClick={() => {
                  void navigator.clipboard?.writeText(backup);
                }}
              >
                copy
              </button>
            </div>
          </>
        ) : (
          <>
            {hasStoredWallet() && (
              <button className="btn" disabled={busy !== null} onClick={() => void run("resume")}>
                {busy === "resume" ? "opening…" : "continue with the wallet saved here"}
              </button>
            )}

            <button
              className="btn primary"
              disabled={busy !== null}
              onClick={() => {
                if (hasStoredWallet() && !confirmReplace) {
                  setConfirmReplace(true);
                  return;
                }
                void run("create");
              }}
            >
              {busy === "create"
                ? "creating… this can take a few seconds"
                : confirmReplace
                  ? "creating will replace the saved wallet, tap again"
                  : hasStoredWallet()
                    ? "create a different wallet"
                    : "create a new wallet"}
            </button>

            <label className="hint" htmlFor="inapp-import">
              or import a backup
            </label>
            <textarea
              id="inapp-import"
              className="textarea mono"
              rows={4}
              placeholder="paste the backup you exported earlier"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <div className="row">
              <button
                className="btn"
                disabled={busy !== null || !importText.trim()}
                onClick={() => void run("import", importText)}
              >
                {busy === "import" ? "importing…" : "import this backup"}
              </button>
              {hasStoredWallet() && (
                <button
                  className="btn ghost"
                  disabled={busy !== null}
                  onClick={() => {
                    forgetWallet();
                    setBackup(null);
                    setError(null);
                  }}
                >
                  forget the saved wallet
                </button>
              )}
            </div>
          </>
        )}

        {error && (
          <p className="hint" style={{ color: "var(--danger, #b00020)", margin: 0 }}>
            {error}
          </p>
        )}

        {!backup && (
          <button className="btn ghost sm" onClick={onClose} disabled={busy !== null}>
            not now
          </button>
        )}
      </div>
    </div>
  );
}
