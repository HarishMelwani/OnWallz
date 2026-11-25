import type { ReactNode } from "react";
import { useVerifiedHandle } from "../lib/verifiedWalls";

/** A handle that turns green while the wall holds a valid Fog badge. */
export function Handle({
  handle,
  className = "at",
  children,
}: {
  handle: string;
  className?: string;
  children?: ReactNode;
}) {
  const verified = useVerifiedHandle(handle);
  return (
    <span className={`${className}${verified ? " verified" : ""}`}>
      {children ?? `@${handle}`}
    </span>
  );
}
