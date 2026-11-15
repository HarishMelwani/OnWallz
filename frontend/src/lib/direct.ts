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
      const [text0, length, mode, tag, replied, replyText, nonce] = await Promise.all([
        readMap("post_text", id),
        readMap("post_len", id),
        readMap("post_mode", id),
        readMap("post_tag", id),
        readMap("replied", id),
        readMap("reply_text", id),
        readMap("post_nonce", id),
      ]);
      // [Field; 3] occupies three consecutive slots from the map's base.
      const text1 = await readMapOffset("post_text", id, 1);
      const text2 = await readMapOffset("post_text", id, 2);
      const text = textOf([text0, text1, text2], Number(length.toString()));
      const didReply = BigInt(replied.toString()) !== 0n;
      return {
        index,
        id: id.toString(),
        text,
        mode: Number(mode.toString()),
        tag: BigInt(tag.toString()) === 0n ? null : tag.toString(),
        replied: didReply,
        replyText: didReply ? textOf([replyText]) : null,
        nonce: nonce.toString(),
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
      const [text0, length, mode, displayRaw] = await Promise.all([
        readMap("post_text", id),
        readMap("post_len", id),
        readMap("post_mode", id),
        readMap("display", wallRaw),
      ]);
      const text1 = await readMapOffset("post_text", id, 1);
      const text2 = await readMapOffset("post_text", id, 2);
      return {
        seq,
        wall: wallRaw.toString(),
        handle: BigInt(displayRaw.toString()) === 0n ? "" : textOf([displayRaw]),
        index: Number(indexRaw.toString()),
        text: textOf([text0, text1, text2], Number(length.toString())),
        mode: Number(mode.toString()),
      } satisfies DirectActivity;
    }),
  );
  return rows;
}

export async function isClaimedDirect(handle: string): Promise<boolean> {
  const wall = await wallIdOf(handle);
  return BigInt((await readMap("claimed", wall)).toString()) !== 0n;
}
