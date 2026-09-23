// ─── Declined image generations ─────────────────────────────
//
// Prism reports a forced image generation that drew nothing as
// `refusal: { category, explanation }` — the prompt's block reason, else the
// finish reason (IMAGE_SAFETY, PROHIBITED_CONTENT, NO_IMAGE, …). Older Prism
// builds sent only `safetyBlock`, or nothing at all.
//
// Only a content-policy decline can be talked around by softening the
// prompt (nudity → robes, violence → calmer). A decline for anything else —
// a copyrighted likeness, personal information, the model choosing not to
// draw — comes back the same however the words are softened, so it ends the
// attempt at once. Before this, every miss was softened three times and then
// reported as "try a more specific prompt": the agent redrew the same refused
// subject up to five times (32 of Lupos's 34 image failures, 30 days to
// 2026-09-22), four image-model calls per try.

/** Content-policy declines that the softening tiers can plausibly get past. */
export const SOFTENABLE_DECLINES: ReadonlySet<string> = new Set([
  "SAFETY",
  "IMAGE_SAFETY",
  "PROHIBITED_CONTENT",
  "IMAGE_PROHIBITED_CONTENT",
  "BLOCKLIST",
  // No reason reported (a Prism build before refusals): keep the old
  // softening behaviour rather than guess.
  "UNKNOWN",
]);

export interface ImageDecline {
  category: string;
  explanation: string | null;
  softenable: boolean;
}

export interface ImageGenerationResult {
  text?: string;
  images?: { data: string; mimeType?: string }[];
  safetyBlock?: boolean;
  refusal?: { category?: string | null; explanation?: string | null } | null;
}

/** Why a generation drew nothing — null when it drew an image. */
export function declineOf(result: ImageGenerationResult): ImageDecline | null {
  if (!result.safetyBlock && !result.refusal && (result.images?.length ?? 0) > 0) {
    return null;
  }
  const category =
    result.refusal?.category || (result.safetyBlock ? "SAFETY" : "UNKNOWN");
  const explanation =
    result.refusal?.explanation?.trim() ||
    (result.refusal ? null : result.text?.trim()) ||
    null;
  return { category, explanation, softenable: SOFTENABLE_DECLINES.has(category) };
}
