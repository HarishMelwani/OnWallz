/**
 * Fog Names (`.fog`) integration, read-only.
 *
 * A wall is meant for a `.fog` name. Before creating one, the app asks the Fog registry
 * who owns the label and refuses when it belongs to another account. This is an app
 * level check: the OnWallz contract is unchanged, and the name's owner stays Fog's business, not ours.
 */
import { NODE_URL } from "./config";

/** Fog Names v8 on the Aztec testnet, from deployments/testnet-v6.json. */
export const FOG_REGISTRY = "0x274aaed9dfd42afc593f4a7635ba4ed194b45d9bb0cc3a5c7f39f3b310a51468";
export const FOG_SITE = "https://fog-testnet.huantian233.workers.dev";
/** This Fog deployment only registers labels of at least this length. */
export const FOG_MIN_LABEL = 7;

export type FogGate =
  | { kind: "invalid"; message: string }
  | { kind: "unregistered"; label: string }
  | { kind: "owned"; label: string; owner: string }
  | { kind: "other"; label: string }
  | { kind: "error"; message: string };

const LABEL = /^[a-z0-9][a-z0-9-]{1,29}[a-z0-9]$/;

/** Strip the decoration, lowercase, and apply Fog's label rules. */
export function normalizeFogLabel(input: string): { label: string } | { error: string } {
  const label = input.trim().replace(/^@/, "").replace(/\.fog$/i, "").toLowerCase();
  if (!label) return { error: "pick a .fog name first" };
  if (label.length < 3) return { error: "a .fog name needs at least 3 characters" };
  if (label.length > 31) return { error: "a .fog name is at most 31 characters" };
  if (!LABEL.test(label)) return { error: "use lowercase letters, digits and hyphens, no leading or trailing hyphen" };
  if (label.includes("--")) return { error: "two hyphens in a row are not allowed" };
  if (label.startsWith("0x")) return { error: "a name cannot start with 0x" };
  return { label };
}

let readerPromise: Promise<{
  resolveAddress: (name: string) => Promise<{ status: string; address?: { toString(): string } }>;
}> | null = null;

async function reader() {
  readerPromise ??= (async () => {
    const [{ createAztecNodeClient }, { AztecAddress }, fog] = await Promise.all([
      import("@aztec-labs/aztec.js/node"),
      import("@aztec-labs/aztec.js/addresses"),
      import("fog-sdk/read"),
    ]);
    const node = createAztecNodeClient(NODE_URL, { maxBatchSize: 3 });
    const connected = await fog.RegistryReader.connect(
      node,
      AztecAddress.fromStringUnsafe(FOG_REGISTRY),
    );
    return {
      resolveAddress: (name: string) => fog.resolveAddress(connected, name),
    };
  })();
  return readerPromise;
}

/** Who, if anyone, owns this `.fog` name. */
export async function checkFogName(input: string, account: string | null): Promise<FogGate> {
  const parsed = normalizeFogLabel(input);
  if ("error" in parsed) return { kind: "invalid", message: parsed.error };
  const label = parsed.label;

  try {
    const fog = await reader();
    const result = await fog.resolveAddress(label);
    if (result.status === "unregistered") return { kind: "unregistered", label };
    if (result.status !== "resolved") return { kind: "other", label };
    const owner = result.address?.toString() ?? "";
    if (account && owner.toLowerCase() === account.toLowerCase()) {
      return { kind: "owned", label, owner };
    }
    return { kind: "other", label };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "error", message };
  }
}
