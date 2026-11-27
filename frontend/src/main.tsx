import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { loadContractFile } from "./lib/config";
import "./styles.css";

// Dark first: a gallery needs a dark room. Light stays one toggle away, and an
// explicit choice is remembered over the default.
const stored = localStorage.getItem("onwallz.theme");
document.documentElement.dataset.theme = stored === "light" ? "light" : "dark";

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