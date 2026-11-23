/**
 * Reads straight from the chain, with no server and no PXE.
 *
 * Every value OnWallz renders is public storage, and the node exposes both the
 * storage slots (in the artifact) and `getPublicStorageAt`. That is enough to
 * reconstruct walls and the feed in the browser, which is what makes a static
 * deployment possible.
 */
import { Fr } from "@aztec-labs/aztec.js/fields";
import { AztecAddress } from "@aztec-labs/aztec.js/addresses";
import { createAztecNodeClient } from "@aztec-labs/aztec.js/node";
import { poseidon2Hash } from "@aztec-labs/foundation/crypto/poseidon";
import { deriveStorageSlotInMap } from "@aztec-labs/stdlib/hash";
import artifact from "../artifacts/onwallz.json";
import { liveAddress, NODE_URL } from "./config";

/* ---------- storage layout, read from the compiled artifact ---------- */

function slotsFromArtifact(): Record<string, bigint> {
  const out: Record<string, bigint> = {};
  // Walk every branch of the artifact's value tree. Descending only through
  // `.value` missed the storage layout entirely, which silently left every slot
  // at 0 - reads then returned zeroes and every wall looked empty.
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const rec = node as Record<string, unknown>;
    if (typeof rec.name === "string" && rec.value && typeof rec.value === "object") {
      const fields = (rec.value as Record<string, unknown>).fields;
      if (Array.isArray(fields)) {
        const slot = fields.find(
          (x) => (x as Record<string, unknown>)?.name === "slot",
        ) as { value?: { value?: string } } | undefined;
        if (slot?.value?.value) out[rec.name] = BigInt(`0x${slot.value.value}`);
      }
    }
    for (const value of Object.values(rec)) walk(value);
  };
  // A bundler may wrap a JSON default export, so accept both shapes.
  const rec = artifact as { outputs?: unknown; default?: { outputs?: unknown } };
  walk(rec.outputs ?? rec.default?.outputs);
  if (Object.keys(out).length < 5) {
    throw new Error("storage layout missing from the compiled artifact");
  }
  return out;
}

const SLOT = slotsFromArtifact();

/** Storage slot by field name, from the compiled artifact. */
export function storageSlot(name: string): bigint {
  return SLOT[name] ?? 0n;
}
const DOMAIN_WALL = 0x57414c4c;

let nodeClient: ReturnType<typeof createAztecNodeClient> | null = null;
function node() {
  if (!nodeClient) nodeClient = createAztecNodeClient(NODE_URL);
  return nodeClient;
}

/** Public storage value at a map slot, or 0 when never written. */
async function readMap(name: string, key: Fr): Promise<Fr> {
  const contract = AztecAddress.fromStringUnsafe(liveAddress());
  const slot = await deriveStorageSlotInMap(SLOT[name] ?? 0n, key);
  return node().getPublicStorageAt("latest", contract, slot);
}

async function readPlain(name: string): Promise<Fr> {
  const contract = AztecAddress.fromStringUnsafe(liveAddress());
  return node().getPublicStorageAt("latest", contract, new Fr(SLOT[name] ?? 0n));
}

// TextEncoder/TextDecoder, not Buffer: this module runs in the browser, where
// Node globals do not exist.
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const pack = (value: string): Fr => {
  let f = 0n;
  for (const b of encoder.encode(value)) f = (f << 8n) | BigInt(b);
  return new Fr(f);
};

const bytesOf = (field: Fr): number[] => {
  let hex = BigInt(field.toString()).toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
};

const textOf = (fields: Fr[], length = Number.MAX_SAFE_INTEGER): string => {
  const bytes: number[] = [];
  for (const f of fields) {
    for (const b of bytesOf(f)) {
      if (b === 0) return decoder.decode(new Uint8Array(bytes));
      bytes.push(b);
    }
  }
  return decoder.decode(new Uint8Array(bytes.slice(0, length)));
};

/** Wall id for a handle, exactly as the contract derives it. */
export async function wallIdOf(handle: string): Promise<Fr> {
  const name = handle.trim().replace(/^@/, "").toLowerCase();
  return poseidon2Hash([pack(name), new Fr(name.length), new Fr(DOMAIN_WALL)]);
}

/** The posting time carried in the nonce, or null for notes written before that. */
export function timeOfNonce(nonce: Fr): number | null {
  const ms = Number(BigInt(nonce.toString()) >> 88n);
  // Anything that is not a plausible timestamp means an old random nonce.
  if (!Number.isFinite(ms) || ms < 1_700_000_000_000 || ms > Date.now() + 86_400_000) return null;
  return ms;
}

/**
 * Long notes live in the PostedLong event, not in public storage. The event's log tag is
 * derived from its signature, so we try the plausible renderings once and keep the one
 * that answers.
 */
// Verified against the deployed contract: this is the exact signature the macro derives.
/**
 * Long notes live in the PostedLong event. Its log tag depends only on the event's
 * signature and a protocol domain separator, so it is a constant; querying with it is a
 * plain JSON-RPC call, which avoids hashing in the browser entirely.
 */
const LONG_TAG = "0x1f8ad554bf91381ab2a301e80f5bda26f64b258bab728a573571bc8bf8033424";

let longCache: Map<string, string> | null = null;
let longInFlight: Promise<Map<string, string>> | null = null;
let longLoadedAt = 0;
const LONG_CACHE_MS = 30_000;

function longKey(wall: Fr, index: number): string {
  return `${wall.toString()}:${index}`;
}

async function loadLongNotes(force = false): Promise<Map<string, string>> {
  // The cache is short lived: a note written after the last fetch would otherwise look
  // unreadable until a reload.
  if (!force && longCache && Date.now() - longLoadedAt < LONG_CACHE_MS) return longCache;
  if (longInFlight) return longInFlight;

  longInFlight = (async () => {
    const map = new Map<string, string>();
    const contract = liveAddress();
    let afterLog: Record<string, unknown> | null = null;
    try {
      // The node returns at most one page per tag, so we follow the cursor until the
      // tag is exhausted. Without this, older notes silently fall off the list.
      for (let page = 0; page < 40; page++) {
        const tagQuery = afterLog ? { tag: LONG_TAG, afterLog } : LONG_TAG;
        const body = {
          jsonrpc: "2.0",
          id: 1,
          method: "node_getPublicLogsByTags",
          params: [{ contractAddress: contract, tags: [tagQuery] }],
        };
        const res = await fetch(NODE_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as {
          result?: { logData?: string[]; blockNumber?: number; txIndexWithinBlock?: number; logIndexWithinTx?: number }[][];
          error?: { message?: string };
        };
        if (json.error) throw new Error(json.error.message ?? "log query failed");
        const logs = json.result?.[0] ?? [];
        if (logs.length === 0) break;

        for (const log of logs) {
          const data = (log.logData ?? []).map((hex) => BigInt(hex));
          // [tag, wall, index, length, digest, ...32 text fields]
          if (data.length < 37) continue;
          const wall = new Fr(data[1]);
          const index = Number(data[2]);
          const length = Number(data[3]);
          map.set(longKey(wall, index), textOf(data.slice(5, 37).map((v) => new Fr(v)), length));
        }

        const last = logs[logs.length - 1];
        if (!last || last.blockNumber === undefined) break;
        afterLog = {
          blockNumber: last.blockNumber,
          txIndexWithinBlock: last.txIndexWithinBlock,
          logIndexWithinTx: last.logIndexWithinTx,
        };
        // A page smaller than the node's cap is the last page.
        if (logs.length < 20) break;
      }
      console.info(`[onwallz] long notes loaded: ${map.size}`);
    } catch (err) {
      console.warn("[onwallz] could not load long notes:", err);
    }
    longCache = map;
    longLoadedAt = Date.now();
    longInFlight = null;
    return map;
  })();

  return longInFlight;
}

export type DirectPost = {
  index: number;
  id: string;
  text: string;
  mode: number;
  tag: string | null;
  replied: boolean;
  replyText: string | null;
  /** Public nonce, needed to build a claim that proves non-authorship. */
  nonce: string;
  /** Posting time decoded from the nonce, when the note carries one. */
  ts: number | null;
  /** True when the text lives in the event rather than in storage. */
  long: boolean;
};

export type DirectWall = {
  handle: string;
  wall: string;
  claimed: boolean;
  name: string;
  posts: DirectPost[];
};

export async function readWallDirect(handle: string): Promise<DirectWall> {
  const name = handle.trim().replace(/^@/, "").toLowerCase();
  const wall = await wallIdOf(name);

  const [claimedRaw, displayRaw, countRaw] = await Promise.all([
    readMap("claimed", wall),
    readMap("display", wall),
    readMap("post_count", wall),
  ]);

  const count = Number(countRaw.toString());
  const posts = await Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const id = await poseidon2Hash([wall, new Fr(index)]);
      const [text0, length, timeRaw, replied, replyText, nonce] = await Promise.all([
        readMap("post_text", id),
        readMap("post_len", id),
        readMap("post_time", id),
        readMap("replied", id),
        readMap("reply_text", id),
        readMap("post_nonce", id),
      ]);
      // The public half stores block time in seconds; notes written before that have
      // 0 here, and fall back to whatever the nonce carries.
      const seconds = Number(timeRaw.toString());
      // Short notes keep their text in three consecutive storage slots; long notes were
      // written to the PostedLong event and only their digest is in state.
      const lengthValue = Number(length.toString());
      let text: string;
      if (lengthValue > 93) {
        const longs = await loadLongNotes();
        text = longs.get(longKey(wall, index)) ?? "";
        if (!text) {
          // The note may have been written after the cache was built.
          const fresh = await loadLongNotes(true);
          text = fresh.get(longKey(wall, index)) ?? "";
        }
      } else {
        const text1 = await readMapOffset("post_text", id, 1);
        const text2 = await readMapOffset("post_text", id, 2);
        text = textOf([text0, text1, text2], lengthValue);
      }
      const didReply = BigInt(replied.toString()) !== 0n;
      return {
        index,
        id: id.toString(),
        text,
        mode: 0,
        tag: null,
        replied: didReply,
        replyText: didReply ? textOf([replyText]) : null,
        nonce: nonce.toString(),
        long: lengthValue > 93,
        ts: seconds > 0 ? seconds * 1000 : timeOfNonce(nonce),
      } satisfies DirectPost;
    }),
  );

  return {
    handle: name,
    wall: wall.toString(),
    claimed: BigInt(claimedRaw.toString()) !== 0n,
    name: BigInt(displayRaw.toString()) === 0n ? "" : textOf([displayRaw]),
    posts,
  };
}

/** Storage slot for element `offset` of a static array stored in a map. */
async function readMapOffset(name: string, key: Fr, offset: number): Promise<Fr> {
  const contract = AztecAddress.fromStringUnsafe(liveAddress());
  const slot = await deriveStorageSlotInMap(SLOT[name] ?? 0n, key);
  return node().getPublicStorageAt("latest", contract, new Fr(BigInt(slot.toString()) + BigInt(offset)));
}

export type DirectActivity = {
  seq: number;
  wall: string;
  handle: string;
  index: number;
  text: string;
  mode: number;
  ts: number | null;
};

export async function readActivityDirect(limit: number): Promise<DirectActivity[]> {
  const total = Number((await readPlain("activity_count")).toString());
  const start = Math.max(0, total - limit);
  const seqs: number[] = [];
  for (let seq = total - 1; seq >= start; seq--) seqs.push(seq);

  const rows = await Promise.all(
    seqs.map(async (seq) => {
      const [wallRaw, postRaw, indexRaw] = await Promise.all([
        readMap("activity_wall", new Fr(seq)),
        readMap("activity_post", new Fr(seq)),
        readMap("activity_index", new Fr(seq)),
      ]);
      const id = await poseidon2Hash([wallRaw, new Fr(Number(indexRaw.toString()))]);
      const [text0, length, timeRaw, displayRaw, nonce] = await Promise.all([
        readMap("post_text", id),
        readMap("post_len", id),
        readMap("post_time", id),
        readMap("display", wallRaw),
        readMap("post_nonce", id),
      ]);
      const itemIndex = Number(indexRaw.toString());
      const lengthValue = Number(length.toString());
      let text: string;
      if (lengthValue > 93) {
        const longs = await loadLongNotes();
        text = longs.get(longKey(wallRaw, itemIndex)) ?? "";
        if (!text) {
          const fresh = await loadLongNotes(true);
          text = fresh.get(longKey(wallRaw, itemIndex)) ?? "";
        }
      } else {
        const text1 = await readMapOffset("post_text", id, 1);
        const text2 = await readMapOffset("post_text", id, 2);
        text = textOf([text0, text1, text2], lengthValue);
      }
      return {
        seq,
        wall: wallRaw.toString(),
        handle: BigInt(displayRaw.toString()) === 0n ? "" : textOf([displayRaw]),
        index: itemIndex,
        text,
        mode: 0,
        ts: Number(timeRaw.toString()) > 0 ? Number(timeRaw.toString()) * 1000 : timeOfNonce(nonce),
      } satisfies DirectActivity;
    }),
  );
  return rows;
}

export async function isClaimedDirect(handle: string): Promise<boolean> {
  const wall = await wallIdOf(handle);
  return BigInt((await readMap("claimed", wall)).toString()) !== 0n;
}
