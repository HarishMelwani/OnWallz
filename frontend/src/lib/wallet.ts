/**
 * Nulo wallet connection.
 *
 * Nulo exposes the canonical `@aztec-labs/wallet-sdk` surface, so this is the
 * standard handshake every Aztec dApp performs:
 *
 *   1. WalletManager.configure -> getAvailableWallets (discovers the extension)
 *   2. provider.establishSecureChannel(appId) -> PendingConnection (user allows)
 *   3. pending.confirm() -> Wallet (user verifies the connection hash)
 *   4. wallet.requestCapabilities(manifest) -> granted accounts
 *
 * Accounts arrive from the capability grant, not from the connect call.
 * Every step reports progress so a stuck handshake is visible, not silent.
 */
import { WalletManager, type WalletProvider } from "@aztec-labs/wallet-sdk/manager";
import type { Wallet } from "@aztec-labs/aztec.js/wallet";
import { Fr } from "@aztec-labs/foundation/curves/bn254";
import {
  ALLOW_DEPLOY,
  CHAIN_ID_OVERRIDE,
  FEE_JUICE_ADDRESS,
  FPC_ADDRESS,
  VERSION_OVERRIDE,
  liveAddress,
} from "./config";

export const APP_ID = "OnWallz";
const APP_VERSION = "0.1.0";
const DISCOVERY_TIMEOUT = 8_000;

export type WalletStatus =
  | "idle"
  | "discovering"
  | "connecting"
  | "awaiting-approval"
  | "verifying"
  | "connected"
  | "error";

export type WalletState = {
  status: WalletStatus;
  address: string | null;
  walletName: string | null;
  error: string | null;
  /** Emoji grid the user must match against the one their wallet shows. */
  emojis: string | null;
};

let wallet: Wallet | null = null;
let provider: WalletProvider | null = null;
let cancelDiscovery: (() => void) | null = null;
/** Resolves the pending connect once the user answers the emoji check. */
let answerVerification: ((ok: boolean) => void) | null = null;

/** Called by the UI when the user compares the emoji grids. */
export function confirmVerification(matches: boolean): void {
  answerVerification?.(matches);
  answerVerification = null;
}

export function getWallet(): Wallet | null {
  return wallet;
}

/**
 * Scopes are built per connection because the wallet may only honour explicit
 * contract addresses, not "*" - asking for "*" produced SCOPE_VIOLATION (4100)
 * on every view call.
 */
function isAddress(v: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(v);
}

function buildManifest() {
  // Built from Nulo's own capability types: a scope is either "*" or a list of
  // {contract, function} patterns, and "contracts"/"contractClasses" take a list of
  // addresses/ids. The app is granted exactly the contracts it touches - the wall
  // contract, plus the fee contract when private fees are configured.
  const wall = liveAddress();
  const targets = [wall, FPC_ADDRESS, FEE_JUICE_ADDRESS].filter((a) => typeof a === "string" && a.length > 0);
  // A deploy session must reach protocol registries and publish a class, so it asks
  // for the wide grants. Normal use never does: the flag is off by default.
  const patterns: unknown = ALLOW_DEPLOY
    ? "*"
    : targets.length
      ? targets.map((contract) => ({ contract, function: "*" }))
      : "*";
  return {
    version: "1.0",
    metadata: {
      name: APP_ID,
      version: APP_VERSION,
      url: typeof window !== "undefined" ? window.location.origin : undefined,
    },
    capabilities: [
      // read the connected account; the app never signs on your behalf
      { type: "accounts", canGet: true, canCreateAuthWit: false },
      // send transactions, but only to those contracts
      { type: "transaction", scope: patterns },
      // register and read metadata for those contracts only
      { type: "contracts", contracts: ALLOW_DEPLOY ? "*" : targets, canRegister: true, canGetMetadata: true },
      // Only when VITE_ALLOW_DEPLOY=1: publishing a contract class is a deployment
      // permission and has no place in normal use.
      ...(ALLOW_DEPLOY
        ? [{ type: "contractClasses", classes: "*", canGetMetadata: true, canRegister: true }]
        : []),
      // simulate on the same contracts (views + pre-flight)
      { type: "simulation", transactions: { scope: patterns }, utilities: { scope: patterns } },
    ],
  };
}

type GrantedAccount = { address: string; name: string };

/**
 * The granted side of a capability response lists accounts as `{ alias, item }`,
 * where `item` is an `AztecAddress`. Older/looser shapes emit plain strings or
 * `{ address }`. All of them are accepted here — reading only `.address` was
 * why a successful grant looked like "no account shared".
 */
function addressOf(entry: unknown): string | null {
  if (typeof entry === "string") return entry;
  if (!entry || typeof entry !== "object") return null;
  const e = entry as {
    item?: unknown;
    address?: unknown;
    alias?: unknown;
  };
  for (const candidate of [e.item, e.address]) {
    if (typeof candidate === "string" && candidate.length) return candidate;
    if (candidate && typeof (candidate as { toString(): string }).toString === "function") {
      const s = (candidate as { toString(): string }).toString();
      if (s && s !== "[object Object]") return s;
    }
  }
  return null;
}

function grantedAccounts(result: unknown): GrantedAccount[] {
  const root = result as { granted?: unknown };
  const granted = Array.isArray(root?.granted)
    ? root.granted
    : Array.isArray(result)
      ? result
      : [];

  const out: GrantedAccount[] = [];
  for (const cap of granted) {
    const c = cap as { type?: string; accounts?: unknown[] };
    if (c?.type !== "accounts" || !Array.isArray(c.accounts)) continue;
    for (const entry of c.accounts) {
      const address = addressOf(entry);
      if (!address) continue;
      const alias = (entry as { alias?: unknown })?.alias;
      out.push({ address, name: typeof alias === "string" ? alias : "" });
    }
  }
  return out;
}

/** The pair the wallet must match exactly. Missing values are an error, not a
 *  reason to guess: a wrong chain silently connects to a contract that is not
 *  there. */
function configuredChainInfo(): { chainId: Fr; version: Fr } {
  return {
    chainId: chainField(CHAIN_ID_OVERRIDE, "VITE_CHAIN_ID"),
    version: chainField(VERSION_OVERRIDE, "VITE_VERSION"),
  };
}

function chainField(value: string, name: string): Fr {
  if (!value) {
    throw new Error(`${name} is not set. the wallet needs the exact chain to connect to`);
  }
  let big: bigint;
  try {
    big = BigInt(value.trim());
  } catch {
    throw new Error(`${name} must be a decimal or 0x-hex number, got "${value}"`);
  }
  return Fr.fromString(`0x${big.toString(16)}`);
}

function delay(ms: number): Promise<never | undefined> {
  return new Promise((resolve) => setTimeout(() => resolve(undefined), ms));
}

/**
 * Collect discovered wallets for a short window and prefer Nulo. Other Aztec
 * wallets (Azguard, for instance) speak the same protocol, so taking whichever
 * answers first would connect the wrong one.
 */
async function pickWallet(
  discovery: { wallets: AsyncIterable<WalletProvider> },
): Promise<WalletProvider | undefined> {
  const candidates: WalletProvider[] = [];
  const collect = (async () => {
    try {
      for await (const p of discovery.wallets) {
        candidates.push(p);
        if (/nulo/i.test(`${p.name} ${p.id}`)) return;
      }
    } catch {
      // discovery cancelled or timed out
    }
  })();
  await Promise.race([collect, delay(2_500)]);
  if (candidates.length > 1) {
    console.info("[onwallz] wallets found:", candidates.map((c) => c.name).join(", "));
  }
  return candidates.find((p) => /nulo/i.test(`${p.name} ${p.id}`)) ?? candidates[0];
}

let lastAccounts: GrantedAccount[] = [];

export async function connect(
  onState: (s: Partial<WalletState>) => void,
): Promise<{ accounts: GrantedAccount[] } | { error: string }> {
  if (wallet && lastAccounts.length) {
    // already connected in this session
    return { accounts: lastAccounts };
  }

  try {
    onState({ status: "discovering", error: null, walletName: null });

    const manager = WalletManager.configure({ extensions: { enabled: true } });

    // Wallets disagree about how to label a local network: some store the real
    // chain id, others leave it at 0 and rely on the RPC. Ask for the exact
    // chain first, then fall back to 0 rather than telling the user their wallet
    // is on the wrong network when it simply labels it differently.
    async function discover(chainInfo: { chainId: Fr; version: Fr }) {
      const session = manager.getAvailableWallets({
        chainInfo,
        appId: APP_ID,
        timeout: DISCOVERY_TIMEOUT,
      });
      cancelDiscovery = session.cancel;
      console.info(
        "[onwallz] looking for wallet on chain",
        chainInfo.chainId.toString(),
        "version",
        chainInfo.version.toString(),
      );
      const provider = await pickWallet(session as never);
      cancelDiscovery?.();
      cancelDiscovery = null;
      return provider;
    }

    // Wallets disagree about chain labels, and a wallet sitting on another network
    // simply does not answer. Try the declared chain, then the two fallbacks that
    // matter in practice: "unknown" (0) and the local network's id.
    const configured = configuredChainInfo();
    const attempts: { chainId: Fr; version: Fr }[] = [
      configured,
      { chainId: Fr.ZERO, version: Fr.ZERO },
    ];
    if (!configured.chainId.equals(new Fr(31337)) && !configured.chainId.equals(Fr.ZERO)) {
      attempts.push({ chainId: new Fr(31337), version: new Fr(31337) });
    }

    let chainInfo = configured;
    let found: WalletProvider | undefined;
    for (const attempt of attempts) {
      chainInfo = attempt;
      found = await discover(attempt);
      if (found) break;
    }
    console.info("[onwallz] discovery result:", found ? found.name : "nothing");

    if (!found) {
      const message =
        `no wallet answered. is Nulo installed, unlocked, and on the same network? ` +
        `this app asks for chain ${configured.chainId.toString()} (testnet); ` +
        `switch Nulo's network if it is pointing somewhere else.`;
      onState({ status: "error", error: message });
      return { error: message };
    }

    onState({ status: "connecting", walletName: found.name ?? "wallet" });

    console.info("[onwallz] opening secure channel to", found.name);
    const pending = await found.establishSecureChannel(APP_ID);

    // The wallet shows the same grid; the user must confirm they match before we
    // trust the channel. Without this the app would connect blindly.
    const { hashToEmoji } = await import("@aztec-labs/wallet-sdk/crypto");
    const emojis = hashToEmoji(pending.verificationHash);
    onState({ status: "verifying", emojis });

    const matches = await new Promise<boolean>((resolve) => {
      answerVerification = resolve;
    });
    if (!matches) {
      pending.cancel();
      const message = "you cancelled: the emoji grid did not match your wallet";
      onState({ status: "error", error: message, emojis: null });
      return { error: message };
    }
    onState({ status: "awaiting-approval", emojis: null });

    const connected = await pending.confirm();
    wallet = connected;
    provider = found;

    console.info("[onwallz] connected, asking for accounts");
    const granted = await connected.requestCapabilities(buildManifest() as never);
    console.info("[onwallz] capability grant:", granted);
    const accounts = grantedAccounts(granted);

    if (!accounts.length) {
      const message =
        "connected, but no account was shared. approve the account request in Nulo, then try again.";
      onState({ status: "error", error: message });
      return { error: message };
    }

    lastAccounts = accounts;
    const address = accounts[0].address;
    onState({
      status: "connected",
      address,
      walletName: found.name ?? "wallet",
      error: null,
    });
    return { accounts };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onState({ status: "error", error: message });
    return { error: message };
  }
}

export async function disconnect(onState: (s: Partial<WalletState>) => void) {
  try {
    cancelDiscovery?.();
  } catch {
    // ignore
  }
  cancelDiscovery = null;
  try {
    await provider?.disconnect();
  } catch {
    // best effort
  }
  provider = null;
  wallet = null;
  lastAccounts = [];
  onState({ status: "idle", address: null, walletName: null, error: null });
}