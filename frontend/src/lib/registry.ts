/**
 * The list of registered walls, built without a server or an indexer.
 *
 * `Created` events give every wall id that exists; `display` gives the name behind each
 * id. Together they are the registry, and the Home page filters it locally so typing is
 * instant after the first load.
 */
import { createAztecNodeClient } from "@aztec-labs/aztec.js/node";
import { AztecAddress } from "@aztec-labs/aztec.js/addresses";
import { Fr } from "@aztec-labs/aztec.js/fields";
import { deriveStorageSlotInMap } from "@aztec-labs/stdlib/hash";
import { NODE_URL, liveAddress } from "./config";
import { storageSlot } from "./direct";

/** Log tag for Created(Field): the event's signature fixes it. */
const CREATED_TAG = "0x3013bb0e528a103b693c8562b9c93fb1ff23c46aa27ecd8d7433fc18a2fb3bb5";
const PAGE = 20;
const TTL = 30_000;

export type RegisteredWall = { name: string; wall: string; block: number };

let cache: RegisteredWall[] | null = null;
let loadedAt = 0;
let inFlight: Promise<RegisteredWall[]> | null = null;

const decoder = new TextDecoder();

function packedToString(value: bigint): string {
  if (value === 0n) return "";
  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    const b = parseInt(hex.slice(i, i + 2), 16);
    if (b === 0) break;
    bytes.push(b);
  }
  return decoder.decode(new Uint8Array(bytes));
}

async function nameOfWall(wall: bigint): Promise<string> {
  const node = createAztecNodeClient(NODE_URL);
  const slot = await deriveStorageSlotInMap(storageSlot("display"), new Fr(wall));
  const value = await node.getPublicStorageAt(
    "latest",
    AztecAddress.fromStringUnsafe(liveAddress()),
    slot,
  );
  return packedToString(BigInt(value.toString()));
}

export async function loadRegisteredWalls(force = false): Promise<RegisteredWall[]> {
  if (!force && cache && Date.now() - loadedAt < TTL) return cache;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const walls: { wall: bigint; block: number }[] = [];
    try {
      let afterLog: Record<string, unknown> | null = null;
      for (let page = 0; page < 40; page++) {
        const tagQuery = afterLog ? { tag: CREATED_TAG, afterLog } : CREATED_TAG;
        const res = await fetch(NODE_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "node_getPublicLogsByTags",
            params: [{ contractAddress: liveAddress(), tags: [tagQuery] }],
          }),
        });
        const json = (await res.json()) as {
          result?: { logData?: string[]; blockNumber?: number; txIndexWithinBlock?: number; logIndexWithinTx?: number }[][];
          error?: { message?: string };
        };
        if (json.error) throw new Error(json.error.message ?? "registry query failed");
        const logs = json.result?.[0] ?? [];
        if (logs.length === 0) break;
        for (const log of logs) {
          const data = (log.logData ?? []).map((hex) => BigInt(hex));
          // [tag, wall]
          if (data.length >= 2) walls.push({ wall: data[1], block: log.blockNumber ?? 0 });
        }
        const last = logs[logs.length - 1];
        if (!last || last.blockNumber === undefined) break;
        afterLog = {
          blockNumber: last.blockNumber,
          txIndexWithinBlock: last.txIndexWithinBlock,
          logIndexWithinTx: last.logIndexWithinTx,
        };
        if (logs.length < PAGE) break;
      }

      const named = await Promise.all(
        walls.map(async ({ wall, block }) => ({
          name: await nameOfWall(wall),
          wall: wall.toString(),
          block,
        })),
      );
      cache = named
        .filter((w) => w.name.length > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
      loadedAt = Date.now();
      console.info(`[onwallz] registered walls: ${cache.length}`);
    } catch (err) {
      console.warn("[onwallz] could not load registered walls:", err);
      cache ??= [];
    }
    inFlight = null;
    return cache ?? [];
  })();

  return inFlight;
}

/** Names starting with the typed prefix, for the home search. */
export function searchWalls(all: RegisteredWall[], query: string): RegisteredWall[] {
  const q = query.trim().replace(/^@/, "").toLowerCase();
  if (!q) return all.slice(0, 8);
  return all.filter((w) => w.name.toLowerCase().startsWith(q)).slice(0, 8);
}

export function hasExactWall(all: RegisteredWall[], handle: string): boolean {
  const h = handle.trim().replace(/^@/, "").toLowerCase();
  return all.some((w) => w.name.toLowerCase() === h);
}
