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
 * Every note is one public log tagged with its wall. The tag is derived on chain from the
 * wall id and a fixed domain, so a client that knows the wall can ask the node for that
 * tag alone. That is what keeps reading a wall proportional to its own notes instead of
 * to every note on the contract.
 */
const DOM_SEP_WALL_NOTES = 0x574c4e54;
const WALL_TEXT_CACHE_MS = 30_000;
const wallText = new Map<string, { at: number; texts: Map<number, string> }>();
const wallTextInFlight = new Map<string, Promise<Map<number, string>>>();

async function noteTag(wall: Fr): Promise<string> {
  const { computeLogTag } = await import("@aztec-labs/stdlib/hash");
  return (await computeLogTag(wall, DOM_SEP_WALL_NOTES as never)).toString();
}

/** Text of every note on one wall, keyed by index. Paginated by that wall's tag. */
export async function loadWallTexts(wall: Fr, force = false): Promise<Map<number, string>> {
  const key = wall.toString();
  const cached = wallText.get(key);
  if (!force && cached && Date.now() - cached.at < WALL_TEXT_CACHE_MS) return cached.texts;
  const existing = wallTextInFlight.get(key);
  if (existing && !force) return existing;

  const run = (async () => {
    const texts = new Map<number, string>();
    const contract = liveAddress();
    const tag = await noteTag(wall);
    let afterLog: Record<string, unknown> | null = null;
    try {
      for (let page = 0; page < 40; page++) {
        const tagQuery = afterLog ? { tag, afterLog } : tag;
        const res = await fetch(NODE_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "node_getPublicLogsByTags",
            params: [{ contractAddress: contract, tags: [tagQuery] }],
          }),
        });
        const json = (await res.json()) as {
          result?: { logData?: string[]; blockNumber?: number; txIndexWithinBlock?: number; logIndexWithinTx?: number }[][];
          error?: { message?: string };
        };
        if (json.error) throw new Error(json.error.message ?? "note log query failed");
        const logs = json.result?.[0] ?? [];
        if (logs.length === 0) break;
        for (const log of logs) {
          const data = (log.logData ?? []).map((hex) => BigInt(hex));
          // [tag, wall, index, length, ...32 text fields]
          if (data.length < 36) continue;
          const index = Number(data[2]);
          const length = Number(data[3]);
          texts.set(index, textOf(data.slice(4, 36).map((v) => new Fr(v)), length));
        }
        const last = logs[logs.length - 1];
        if (!last || last.blockNumber === undefined) break;
        afterLog = {
          blockNumber: last.blockNumber,
          txIndexWithinBlock: last.txIndexWithinBlock,
          logIndexWithinTx: last.logIndexWithinTx,
        };
        if (logs.length < 20) break;
      }
      console.info(`[onwallz] notes read for ${key.slice(0, 10)}…: ${texts.size}`);
    } catch (err) {
      console.warn("[onwallz] could not read note logs:", err);
    }
    wallText.set(key, { at: Date.now(), texts });
    wallTextInFlight.delete(key);
    return texts;
  })();

  wallTextInFlight.set(key, run);
  return run;
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
  const texts = await loadWallTexts(wall);
  const posts = await Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const id = await poseidon2Hash([wall, new Fr(index)]);
      const [length, timeRaw, replied, replyText, nonce] = await Promise.all([
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
      const text = texts.get(index) ?? "";
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
        // Only used to explain a note whose log could not be read.
        long: lengthValue > 0 && text.length === 0,
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

export type DirectActivity = {
  seq: number;
  wall: string;
  handle: string;
  index: number;
  text: string;
  mode: number;
  ts: number | null;
  replied: boolean;
  replyText: string | null;
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
      const itemIndex = Number(indexRaw.toString());
      const [length, timeRaw, displayRaw, nonce, texts, repliedRaw, replyRaw] = await Promise.all([
        readMap("post_len", id),
        readMap("post_time", id),
        readMap("display", wallRaw),
        readMap("post_nonce", id),
        loadWallTexts(wallRaw),
        readMap("replied", id),
        readMap("reply_text", id),
      ]);
      const text = texts.get(itemIndex) ?? "";
      const didReply = BigInt(repliedRaw.toString()) !== 0n;
      return {
        seq,
        wall: wallRaw.toString(),
        handle: BigInt(displayRaw.toString()) === 0n ? "" : textOf([displayRaw]),
        index: itemIndex,
        text,
        mode: 0,
        ts: Number(timeRaw.toString()) > 0 ? Number(timeRaw.toString()) * 1000 : timeOfNonce(nonce),
        replied: didReply,
        replyText: didReply ? textOf([replyRaw]) : null,
      } satisfies DirectActivity;
    }),
  );
  return rows;
}

export async function isClaimedDirect(handle: string): Promise<boolean> {
  const wall = await wallIdOf(handle);
  return BigInt((await readMap("claimed", wall)).toString()) !== 0n;
}
