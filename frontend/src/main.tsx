import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { loadContractFile } from "./lib/config";
import "./styles.css";

const stored = localStorage.getItem("onwallz.theme");
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
document.documentElement.dataset.theme = stored ?? (prefersDark ? "dark" : "light");

const root = createRoot(document.getElementById("root")!);

// The contract address is resolved before the first render: an app that does not
// know where its contract lives must not decide "you have no page". A failure
// here is shown, not swallowed.
loadContractFile().then(
  () => {
    root.render(
      <StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </StrictMode>,
    );
  },
  (error: unknown) => {
    root.render(
      <div className="empty">
        <span className="glyph">◌</span>
        <h2>OnWallz could not start</h2>
        <p className="muted">{error instanceof Error ? error.message : String(error)}</p>
      </div>,
    );
  },
);