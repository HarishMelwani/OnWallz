/**
 * The on-chain half of walls.
 *
 * Every call goes through the connected wallet (Nulo), which simulates and
 * proves locally. None of these functions reveal the author: `write` takes no
 * author argument, because the contract has no field for one.
 */
import { Contract } from "@aztec-labs/aztec.js/contracts";
import {
  isClaimedDirect,
  readActivityDirect,
  readWallDirect,
  wallIdOf,
} from "./direct";
import { AztecAddress } from "@aztec-labs/aztec.js/addresses";
import { Fr } from "@aztec-labs/aztec.js/fields";
import { loadContractArtifact } from "@aztec-labs/stdlib/abi";
import rawArtifact from "../artifacts/onwallz.json";
import * as config from "./config";
import { NODE_URL } from "./config";
import { getWallet } from "./wallet";

/**
 * `aztec compile` emits a raw compilation artifact. Converting it to JSON and
 * back loses the typed field objects, so it is converted here, at runtime,
 * from the raw file.
 */
const artifact = loadContractArtifact(rawArtifact as never);

export function isConfigured(): boolean {
  return config.hasContract();
}

export function contractAddress(): string {
  return config.liveAddress();
}

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(NODE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? "node error");
  return json.result;
}




/**
 * Sends are sent with normal fee handling: `skipFeeEnforcement` let the wallet
 * prompt without a balance, but it also left it unable to estimate the fee,
 * which showed up as "Couldn't estimate fee" in the approval window.
 */

/**
 * Fee payment through the private piggy bank, when one is configured.
 *
 * The FPC is a contract with no owner and no public surface: it pays the fee, so
 * the transaction's `feePayer` is the same address for everyone. Returns an empty
 * object when no FPC is configured, which keeps normal fee payment intact.
 */
let fpcMethod: unknown = null;

async function feeOptions(required = false): Promise<Record<string, unknown>> {
  if (!config.hasFpc()) {
    if (required) {
      throw new Error(
        "private fees are required but no piggy bank is configured (VITE_FPC_ADDRESS)",
      );
    }
    return {};
  }
  if (fpcMethod) return { fee: { paymentMethod: fpcMethod } };
  const wallet = getWallet();
  if (!wallet) return {};
  const [{ FPCFeePaymentMethod, registerPrivateContract }, { Fr }] = await Promise.all([
    import("@alejoamiras/private-fee-juice"),
    import("@aztec-labs/aztec.js/fields"),
  ]);
  const fpc = await registerPrivateContract(wallet, Fr.fromString(config.FPC_DEPLOY_SALT), {
    assertCanonical: true,
  });
  fpcMethod = new FPCFeePaymentMethod(fpc.address);
  return { fee: { paymentMethod: fpcMethod } };
}

const SEND_OPTS = {} as const;



/**
 * Options for a read-only view call.
 *
 * Nulo refuses to process contract simulation unless the contract address is
 * within the account's scope, so the contract is granted explicitly on every
 * view call. Writes are unaffected.
 */
function viewOpts(from: string) {
  // Only `from` is part of the wallet's simulate API. `additionalScopes` belongs
  // to send options; passing it here yields INVALID_PARAMS (-32602).
  return { from: AztecAddress.fromStringUnsafe(from) } as never;
}


/**
 * Reads go through the dev read service (reader.mjs) on the local node.
 *
 * The browser PXE fights the bundler - CommonJS interop failures and a SQLite
 * worker that the dev optimizer breaks - so reads run in Node against the same
 * chain and contract. This is a reader only: it stores nothing.
 */

let registeredFor: string | null = null;

/** The wallet needs the contract instance before it can execute a call. */
async function contract(): Promise<Contract> {
  const wallet = getWallet();
  if (!wallet) throw new Error("connect a wallet first");
  const address = contractAddress();
  if (!config.isAddress(address)) throw new Error("no contract address");

  if (registeredFor !== address) {
    const instance = await rpc("node_getContract", [address]);
    if (!instance) {
      throw new Error(`no contract instance at ${address} on this network`);
    }
    await (wallet as unknown as {
      registerContract(i: unknown, a: unknown): Promise<void>;
    }).registerContract(instance, artifact);
    registeredFor = address;
  }

  return Contract.at(AztecAddress.fromStringUnsafe(address), artifact as never, wallet as never);
}

/**
 * Publishes the contract from the connected account, so the wallet learns the
 * instance as a side effect of creating it. The fee comes from whatever the
 * wallet uses on that network — on testnet, the sponsored payer.
 */
export async function deployWalls(from: string): Promise<string> {
  const wallet = getWallet();
  if (!wallet) throw new Error("connect a wallet first");
  const deployed = (await Contract.deploy(wallet as never, artifact as never, [])
    .send({ from: AztecAddress.fromStringUnsafe(from) })) as {
    contract?: { address: { toString(): string } };
    instance?: { address: { toString(): string } };
  };
  const address = (deployed.contract?.address ?? deployed.instance?.address)?.toString();
  if (!address) throw new Error("deployed, but no address came back");
  await config.persistAddress(address);
  registeredFor = address;
  return address;
}

/* ---------- encoding ---------- */

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Pack up to 31 UTF-8 bytes into a field. Handles and display names only. */
export function toField(value: string): Fr {
  const bytes = enc.encode(value).slice(0, 31);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return Fr.fromString(hex === "" ? "0x0" : `0x${hex}`);
}

export function fromField(field: Fr): string {
  const hex = field.toString().replace(/^0x/, "");
  const padded = hex.length % 2 ? `0${hex}` : hex;
  const bytes = new Uint8Array(padded.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return dec.decode(bytes).replace(/\0+$/, "");
}

/** Pack message text into the contract's three fields (93 bytes max). */
export function packText(text: string): { fields: Fr[]; length: number } {
  const bytes = enc.encode(text).slice(0, 93);
  const fields: Fr[] = [];
  for (let i = 0; i < 3; i++) {
    let hex = "";
    for (const b of bytes.slice(i * 31, (i + 1) * 31)) hex += b.toString(16).padStart(2, "0");
    fields.push(Fr.fromString(hex === "" ? "0x0" : `0x${hex}`));
  }
  return { fields, length: bytes.length };
}

export function unpackText(fields: Fr[]): string {
  const bytes: number[] = [];
  for (const f of fields) {
    const hex = f.toString().replace(/^0x/, "");
    const padded = hex.length % 2 ? `0${hex}` : hex;
    for (let i = 0; i < padded.length; i += 2) {
      const byte = parseInt(padded.slice(i, i + 2), 16);
      if (byte !== 0) bytes.push(byte);
    }
  }
  return dec.decode(new Uint8Array(bytes));
}

export function randomNonce(): Fr {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return Fr.fromString(`0x${hex}`);
}

/* ---------- calls ---------- */


/**
 * Resolve a username to its wall id, exactly as `open_wall` derives it.
 *
 * Walls are keyed by poseidon2([name, len, DOMAIN_WALL]), NOT by the packed name,
 * so every read and write must go through this. Skipping it silently reads an
 * empty wall, which is why it lives here rather than at each call site.
 */
const wallIdCache = new Map<string, string>();

async function wallKey(handle: string, _from?: string): Promise<Fr> {
  const { wallIdOf: directWallId } = await import("./direct");
  return directWallId(handle);
}
export function wallLabel(field: Fr): string {
  const text = fromField(field);
  if (/^[a-z0-9_]{1,15}$/.test(text)) return text;
  return field.toString().slice(0, 10);
}

/**
 * Claim an OnWallz username. This is NOT X verification - it records that this
 * wallet claimed the name. Uniqueness is enforced on-chain by a nullifier.
 */
export async function claim(name: string, from: string) {
  const clean = name.trim().replace(/^@/, "").toLowerCase();
  const { fields, length } = packText(clean);

  // The claim must prove non-authorship, so it carries every note's public nonce.
  // These are public values; the keys derived from them are checked on chain.
  const wallData = await readWallDirect(clean);
  const notes = wallData.posts.length;
  if (notes === 0) throw new Error("nobody has written on this wall yet");
  if (notes > 16) throw new Error("this wall has more notes than a claim can verify");

  const nonces: Fr[] = Array.from({ length: 16 }, (_, i) =>
    wallData.posts[i] ? Fr.fromString(wallData.posts[i].nonce) : Fr.ZERO,
  );

  const c = await contract();
  return c.methods
    .claim(fields[0], length, nonces, notes)
    .send({ from: AztecAddress.fromStringUnsafe(from), ...SEND_OPTS, ...(await feeOptions()) } as never);
}
export async function isClaimed(wall: string, _from?: string): Promise<boolean> {
  return isClaimedDirect(wall);
}
export async function wallIdFor(name: string, from: string): Promise<string> {
  return (await wallKey(name, from)).toString();
}

export async function writeOnWall(
  wall: string,
  text: string,
  from: string,
  identity?: { mode: 0 | 1; tag?: string },
) {
  const { fields, length } = packText(text);
  const packed = packText(wall.trim().replace(/^@/, "").toLowerCase());
  const nameField = packed.fields[0];
  // Anonymous by default: mode 0 must carry tag 0 (contract enforces this).
  const mode = identity?.mode ?? 0;
  const tag = mode === 1 && identity?.tag ? toField(identity.tag) : Fr.ZERO;
  const c = await contract();
  const key = await wallKey(wall, from);
  const sent = await c
    // The packed username travels with the write so the wall can render as
    // @name even before anyone claims it.
    .methods.write(key, fields, length, randomNonce(), mode, tag, nameField, packed.length)
    .send({ from: AztecAddress.fromStringUnsafe(from), ...SEND_OPTS, ...(await feeOptions()) } as never);
  return sent;
}

/** Deterministic wall id for a username, as computed on-chain. */
export async function replyToPost(wall: string, postId: string, text: string, from: string) {
  const c = await contract();
  const key = await wallKey(wall, from);

  // Local rows identify a note as "handle:index"; the contract wants
  // poseidon2(wall, index), which we can hash here.
  let fieldId = postId;
  if (postId.includes(":")) {
    const [handle, rawIndex] = postId.split(":");
    const wallField = await wallKey(handle || wall, from);
    const { poseidon2Hash } = await import("@aztec-labs/foundation/crypto/poseidon");
    fieldId = (await poseidon2Hash([wallField, new Fr(Number(rawIndex))])).toString();
  }

  return c
    .methods.reply(key, Fr.fromString(fieldId), toField(text))
    .send({ from: AztecAddress.fromStringUnsafe(from), ...SEND_OPTS, ...(await feeOptions()) } as never);
}

/**
 * The handle owned by an address, or null. This is what restores a wall after
 * the browser has forgotten everything: the contract is the source of truth.
 */
export async function pageOf(owner: string, from: string): Promise<string | null> {
  const c = await contract();
  const handle = (await c
    .methods.page_of(AztecAddress.fromStringUnsafe(owner))
    .simulate(viewOpts(from))) as unknown as Fr;
  if (!handle || handle.equals(Fr.ZERO)) return null;
  const name = fromField(handle);
  return name.length ? name : null;
}

export async function readPage(handle: string, from: string) {
  const c = await contract();
  const [owner, display, count] = (await c
    .methods.page(await wallKey(handle, from))
    .simulate(viewOpts(from))) as unknown as [unknown, Fr, unknown];
  return {
    owner: String(owner),
    display: fromField(display),
    count: Number(count),
  };
}

export async function readPost(wall: string, index: number, from: string) {
  const c = await contract();
  const [text, length, mode, tag] = (await c
    .methods.read_post(await wallKey(wall, from), index)
    .simulate(viewOpts(from))) as unknown as [Fr[], unknown, unknown, Fr];
  return {
    text: unpackText(text),
    length: Number(length),
    mode: Number(mode),
    // 0 when anonymous; a self-declared handle tag when the writer chose public.
    tag: tag.equals(Fr.ZERO) ? null : fromField(tag),
  };
}
/**
 * Read every note on a wall straight from the contract. The local store is only
 * a cache: this is what makes the chain authoritative for the wall view.
 */
export async function readWall(wall: string, _from?: string) {
  // Straight from public storage: no server, no PXE, works on a static deploy.
  const data = await readWallDirect(wall);
  return data.posts.map((p) => ({
    index: p.index,
    text: p.text,
    mode: p.mode,
    tag: p.tag,
    replied: p.replied,
    replyText: p.replyText,
    deleted: false,
  }));
}
export async function readActivity(limit: number, _from?: string) {
  const rows = await readActivityDirect(limit);
  return rows.map((it) => ({
    seq: it.seq,
    wall: it.wall,
    handle: it.handle,
    postId: `${it.wall}:${it.index}`,
    text: it.text,
    mode: it.mode,
    tag: null,
    replied: false,
    replyText: null,
  }));
}
