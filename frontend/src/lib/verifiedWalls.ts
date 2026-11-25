/**
 * Which walls currently carry a valid Fog badge.
 *
 * A wall counts only while the Fog registry still resolves the linked label to the
 * claimant recorded in the link event. That is the same rule the badge on the wall uses,
 * so a handle turns green exactly when its badge would render.
 */
import { useEffect, useState } from "react";
import { checkFogName } from "./fog";
import { loadFogLinks } from "./fogLink";

const TTL = 30_000;
let cache: Set<string> | null = null;
let loadedAt = 0;
let inFlight: Promise<Set<string>> | null = null;

/** Wall ids are compared in their decimal field form, matching the link events. */
export function wallKeyOf(value: string): string {
  return BigInt(value).toString();
}

export async function loadVerifiedWalls(force = false): Promise<Set<string>> {
  if (!force && cache && Date.now() - loadedAt < TTL) return cache;
  if (inFlight && !force) return inFlight;

  inFlight = (async () => {
    const links = await loadFogLinks(force);
    const verified = new Set<string>();
    await Promise.all(
      [...links.values()].map(async (link) => {
        const gate = await checkFogName(link.label, link.claimant);
        if (gate.kind === "owned") verified.add(wallKeyOf(link.wall));
      }),
    );
    cache = verified;
    loadedAt = Date.now();
    inFlight = null;
    return verified;
  })();

  return inFlight;
}

export function useVerifiedWalls(): Set<string> {
  const [walls, setWalls] = useState<Set<string>>(() => cache ?? new Set());
  useEffect(() => {
    let cancelled = false;
    loadVerifiedWalls()
      .then((set) => {
        if (!cancelled) setWalls(set);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return walls;
}

export function useVerifiedHandle(handle: string | null): boolean {
  const verified = useVerifiedWalls();
  const [isVerified, setIsVerified] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!handle) {
      setIsVerified(false);
      return;
    }
    (async () => {
      const { wallIdOf } = await import("./direct");
      const id = wallKeyOf((await wallIdOf(handle)).toString());
      if (!cancelled) setIsVerified(verified.has(id));
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [handle, verified]);
  return isVerified;
}
