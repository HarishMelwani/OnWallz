/**
 * An in-page wallet, for people who cannot or will not install an extension.
 *
 * The wallet lives in this browser: keys in localStorage, PXE state in IndexedDB, proofs
 * generated on this device. That makes it slow compared to Nulo, and it makes the backup
 * string the only way to recover the wallet. Both are stated in the interface.
 */
import { EmbeddedWallet } from "@aztec-labs/wallets/embedded";
import { Fr } from "@aztec-labs/aztec.js/fields";
import { Fq } from "@aztec-labs/foundation/curves/bn254";
import type { Wallet } from "@aztec-labs/aztec.js/wallet";
import { NODE_URL } from "./config";

import {
  exportBackup,
  forgetWallet,
  parseBackup,
  saveKeys,
  storedRaw,
  type InAppKeys,
} from "./inAppStore";

export { exportBackup, forgetWallet, hasStoredWallet } from "./inAppStore";
export type { InAppKeys } from "./inAppStore";

async function boot(keys: InAppKeys): Promise<{ wallet: Wallet; address: string }> {
  // The default store is SQLite over OPFS, run in a worker. In headless browsers (and
  // some mobile webviews) that worker is unavailable, so we use the IndexedDB store,
  // which is pure main-thread code.
  const { AztecIndexedDBStore } = await import("@aztec-labs/kv-store/deprecated/indexeddb");
  // The store wants a Logger object, not the console helper. A silent one is enough:
  // nothing here should print into the user's console.
  const log = {
    debug: () => {},
    verbose: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    createChild: () => log,
  };
  const pxeStore = await AztecIndexedDBStore.open(log as never, "onwallz-pxe");
  const walletStore = await AztecIndexedDBStore.open(log as never, "onwallz-wallet");
  const embedded = await EmbeddedWallet.create(NODE_URL, {
    pxe: { store: pxeStore },
    walletDb: { store: walletStore },
  });
  const account = await embedded.createSchnorrInitializerlessAccount(
    Fr.fromString(keys.secret),
    Fr.fromString(keys.salt),
    Fq.fromString(keys.signingKey),
    "onwallz",
  );
  const address = account.address.toString();
  saveKeys({ ...keys, address });
  return { wallet: embedded as unknown as Wallet, address };
}

export async function createWallet(): Promise<{ wallet: Wallet; address: string; backup: string }> {
  const keys: InAppKeys = {
    v: 1,
    secret: Fr.random().toString(),
    salt: Fr.random().toString(),
    signingKey: Fq.random().toString(),
    address: "",
  };
  const { wallet, address } = await boot(keys);
  return { wallet, address, backup: exportBackup() ?? "" };
}

export async function importWallet(backup: string): Promise<{ wallet: Wallet; address: string }> {
  return boot(parseBackup(backup));
}

export async function resumeWallet(): Promise<{ wallet: Wallet; address: string }> {
  const raw = storedRaw();
  if (!raw) throw new Error("this browser has no saved wallet");
  return boot(parseBackup(raw));
}
