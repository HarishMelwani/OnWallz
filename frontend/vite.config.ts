import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const CONTRACT_FILE = path.resolve(__dirname, "public/contract.json");

/**
 * The deployed address is a fact about the app, not about the visitor. Keeping it
 * in localStorage meant "clear site data" deleted the app's own location, so the
 * address lives in a file instead: the dev server writes it on deploy, the app
 * reads it at boot, and a build ships it.
 */
function contractFile(): Plugin {
  return {
    name: "walls-contract-file",
    configureServer(server) {
      server.middlewares.use("/__onwallz/contract", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          const address = body.trim();
          if (!/^0x[0-9a-fA-F]{64}$/.test(address)) {
            res.statusCode = 400;
            res.end("bad address");
            return;
          }
          fs.writeFileSync(CONTRACT_FILE, `${JSON.stringify({ address }, null, 2)}\n`);
          server.config.logger.info(`[walls] contract address saved: ${address}`);
          res.statusCode = 200;
          res.end("ok");
        });
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    contractFile(),
    nodePolyfills({
      globals: { Buffer: true, global: true, process: true },
      protocolImports: true,
    }),
  ],
  define: {
    global: "globalThis",
    __BUILD_ID__: JSON.stringify((process.env.VERCEL_GIT_COMMIT_SHA || "dev").slice(0, 7)),
  },
  // In-page proving wants cross-origin isolation. Without these the embedded wallet
  // still works, just single-threaded and slower. (One server block only: a duplicate
  // key would silently drop these.)
  server: {
    host: true,
    port: 5173,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  optimizeDeps: {
    include: [
      "@aztec-labs/wallet-sdk/manager",
      "@aztec-labs/foundation/curves/bn254",
    ],

  },
  preview: {
    port: 4173,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  worker: { format: "es" },
});