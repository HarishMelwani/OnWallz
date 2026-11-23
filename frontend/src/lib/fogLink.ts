/**
 * The Fog badge: which `.fog` name a wall linked, read from the contract's own logs.
 *
 * Links live in events, not storage, because the contract is at its storage ceiling and
 * a badge is a fact with a date, not mutable state. The latest FogLinked for a wall,
 * not cancelled by a FogUnlinked, is the current link. It only counts while the Fog
 * registry still resolves that name to the claimant.
 */
import { liveAddress, NODE_URL } from "./config";
import { checkFogName } from "./fog";

const LINKED_TAG = "0x12cd12f6659e6d1eeefaaf3cf124ae1038d59cc7a41197226096b5a9e2b86517";
const UNLINKED_TAG = "0x1cadabccc4d93f12079e60fd65df378cb1136f87d279dc6ab122455dddc0c2b1";
const PAGE = 20;
const TTL = 30_000;

export type FogLink = {
  wall: string;
  claimant: string;
  node: string;
  label: string;
  /** Unix seconds, as Fog reports it. */
  expiresAt: number;
};

type Log = {
  logData: string[];
  blockNumber: number;
  txIndexWithinBlock: number;
  logIndexWithinTx: number;
};

let cache: Map<string, FogLink> | null = null;
let loadedAt = 0;
let inFlight: Promise<Map<string, FogLink>> | null = null;

const decoder = new TextDecoder();

function decodePacked(value: bigint): string {
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

async function logsForTag(tag: string): Promise<Log[]> {
  const out: Log[] = [];
  let afterLog: Record<string, unknown> | null = null;
  for (let page = 0; page < 40; page++) {
    const query = afterLog ? { tag, afterLog } : tag;
    const res = await fetch(NODE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "node_getPublicLogsByTags",
        params: [{ contractAddress: liveAddress(), tags: [query] }],
      }),
    });
    const json = (await res.json()) as { result?: Log[][]; error?: { message?: string } };
    if (json.error) throw new Error(json.error.message ?? "fog log query failed");
    const logs = json.result?.[0] ?? [];
    if (logs.length === 0) break;
    out.push(...logs);
    const last = logs[logs.length - 1];
    afterLog = {
      blockNumber: last.blockNumber,
      txIndexWithinBlock: last.txIndexWithinBlock,
      logIndexWithinTx: last.logIndexWithinTx,
    };
    if (logs.length < PAGE) break;
  }
  return out;
}

export async function loadFogLinks(force = false): Promise<Map<string, FogLink>> {
  if (!force && cache && Date.now() - loadedAt < TTL) return cache;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const [linked, unlinked] = await Promise.all([logsForTag(LINKED_TAG), logsForTag(UNLINKED_TAG)]);
    const all = [
      ...linked.map((log) => ({ log, kind: "link" as const })),
      ...unlinked.map((log) => ({ log, kind: "unlink" as const })),
    ].sort(
      (a, b) =>
        a.log.blockNumber - b.log.blockNumber ||
        a.log.txIndexWithinBlock - b.log.txIndexWithinBlock ||
        a.log.logIndexWithinTx - b.log.logIndexWithinTx,
    );

    const map = new Map<string, FogLink>();
    for (const { log, kind } of all) {
      const data = (log.logData ?? []).map((hex) => BigInt(hex));
      if (data.length < 2) continue;
      const wall = data[1].toString();
      if (kind === "unlink") {
        map.delete(wall);
        continue;
      }
      // [tag, wall, claimant, node, expires_at, label]
      if (data.length < 6) continue;
      map.set(wall, {
        wall,
        claimant: data[2].toString(),
        node: data[3].toString(),
        expiresAt: Number(data[4]),
        label: decodePacked(data[5]),
      });
    }
    cache = map;
    loadedAt = Date.now();
    inFlight = null;
    return map;
  })();

  return inFlight;
}

/** The link for a wall, but only while Fog still resolves the name to the claimant. */
export async function verifiedFogLink(wallId: string): Promise<FogLink | null> {
  const links = await loadFogLinks();
  const link = links.get(wallId);
  if (!link) return null;
  if (link.expiresAt * 1000 < Date.now()) return null;
  const gate = await checkFogName(link.label, link.claimant);
  if (gate.kind !== "owned") return null;
  return link;
}
