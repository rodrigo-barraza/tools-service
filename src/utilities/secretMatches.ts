import { createHash, timingSafeEqual } from "node:crypto";

// ─── Constant-Time Secret Comparison ──────────────────────────────
// Both sides are hashed first: equal-length buffers for timingSafeEqual,
// so the comparison takes the same time whatever was sent, and neither
// the secret's length nor a matching prefix shows in it.

function secretDigest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Whether `provided` is `secret`. An unset secret matches nothing. */
export function secretMatches(
  provided: unknown,
  secret: string | undefined,
): boolean {
  if (!secret || typeof provided !== "string" || provided.length === 0) {
    return false;
  }
  return timingSafeEqual(secretDigest(provided), secretDigest(secret));
}
