import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time byte comparison. Lives in a `.server` module so the Node
 * `node:crypto` import is never pulled into the client bundle.
 */
export function safeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
