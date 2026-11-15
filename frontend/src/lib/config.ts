/** Deployment config. Dependency-free so it can be imported anywhere without
 *  pulling the Aztec SDK into the initial bundle. */
export const ONWALLZ_ADDRESS = (import.meta.env.VITE_ONWALLZ_ADDRESS ?? "").trim();

export const NODE_URL = (
  import.meta.env.VITE_NODE_URL ?? "https://aztec-testnet.drpc.org"
).trim();

export const CHAIN_ID_OVERRIDE = (import.meta.env.VITE_CHAIN_ID ?? "").trim();

export const VERSION_OVERRIDE = (import.meta.env.VITE_VERSION ?? "").trim();

/**
 * Optional: the private fee piggy bank. When set, transactions can be paid by a
 * contract that has no owner instead of by the user's wallet, so the on-chain
 * fee payer stops pointing at the author. Empty means "pay fees normally".
 */
export const FPC_ADDRESS = (import.meta.env.VITE_FPC_ADDRESS ?? "").trim();

/** Deployment salt for the FPC class (canonical value is 0x…01). */
export const FPC_DEPLOY_SALT = (import.meta.env.VITE_FPC_DEPLOY_SALT ?? "0x01").trim();

export function hasFpc(): boolean {
  return FPC_ADDRESS.length > 0 && isAddress(FPC_ADDRESS);
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;

const ZERO_ADDRESS = `0x${"0".repeat(64)}`;

/** A zero address is syntactically valid and means "nothing deployed". */
export function isAddress(value: string): boolean {
  const trimmed = value.trim();
  return ADDRESS_RE.test(trimmed) && trimmed.toLowerCase() !== ZERO_ADDRESS;
}

/** Read from ./contract.json at boot. This is the durable home of the address:
 *  a build ships it, and the dev server rewrites it on every deploy. */
let fromFile = "";

export async function loadContractFile(): Promise<string> {
  const res = await fetch(new URL("contract.json", document.baseURI));
  if (!res.ok) {
    throw new Error(`contract.json was not served (${res.status})`);
  }
  const json = (await res.json()) as { address?: unknown };
  if (typeof json.address !== "string") {
    throw new Error("contract.json has no address string");
  }
  // An empty address is a real state: nothing deployed yet. Anything else must
  // parse, or the app is pointing at a contract that does not exist.
  if (json.address.trim() === "") {
    fromFile = "";
    return fromFile;
  }
  if (!isAddress(json.address)) {
    throw new Error(`contract.json holds an invalid address: ${json.address}`);
  }
  fromFile = json.address.trim();
  return fromFile;
}

const STORAGE_KEY = "onwallz.contract";

/** Precedence: build env, then the shipped file, then a fresh in-browser deploy. */
export function liveAddress(): string {
  if (isAddress(ONWALLZ_ADDRESS)) return ONWALLZ_ADDRESS;
  if (isAddress(fromFile)) return fromFile;
  const stored = localStorage.getItem(STORAGE_KEY) ?? "";
  if (isAddress(stored)) return stored.trim();
  return "";
}

/** Remember a deploy for this browser session only; the file is the durable copy. */
export function saveAddress(address: string): void {
  if (!isAddress(address)) {
    throw new Error(`refusing to store a non-address: "${address}"`);
  }
  fromFile = address.trim();
  localStorage.setItem(STORAGE_KEY, address.trim());
}

/** Write the address to public/contract.json through the dev server. */
export async function persistAddress(address: string): Promise<void> {
  saveAddress(address);
  try {
    await fetch("/__onwallz/contract", { method: "POST", body: address.trim() });
  } catch {
    // a build has no dev server; env or the file already covers it
  }
}

export function hasContract(): boolean {
  return isAddress(liveAddress());
}
/** L2 protocol address of the fee juice contract (claims touch it). */
export const FEE_JUICE_ADDRESS = "0x0000000000000000000000000000000000000000000000000000000000000003";

/** Deployment is opt-in: set VITE_ALLOW_DEPLOY=1 only for a deploy session. */
export const ALLOW_DEPLOY = (import.meta.env.VITE_ALLOW_DEPLOY ?? "") === "1";
