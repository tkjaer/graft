import type { TextAnchor } from "../types";

/**
 * Create a text anchor from a full document text and the selected text.
 * Captures ~50 chars of surrounding context for disambiguation.
 */
export function createAnchorFromText(
  fullText: string,
  anchorText: string,
): TextAnchor {
  const idx = fullText.indexOf(anchorText);
  const prefix =
    idx >= 0 ? fullText.substring(Math.max(0, idx - 50), idx) : "";
  const suffix =
    idx >= 0
      ? fullText.substring(
          idx + anchorText.length,
          idx + anchorText.length + 50,
        )
      : "";
  return { text: anchorText, prefix, suffix };
}

/**
 * Resolve a text anchor against a plain string.
 * Returns character offsets { from, to } or null if not found.
 */
export function resolveAnchorInText(
  fullText: string,
  anchor: TextAnchor,
): { from: number; to: number } | null {
  const candidates: number[] = [];
  let searchFrom = 0;
  while (true) {
    const i = fullText.indexOf(anchor.text, searchFrom);
    if (i < 0) break;
    candidates.push(i);
    searchFrom = i + 1;
  }

  if (candidates.length === 0) return null;

  // Pick best candidate using prefix matching
  let bestIdx = candidates[0];
  if (candidates.length > 1 && anchor.prefix) {
    let bestScore = -1;
    for (const i of candidates) {
      const before = fullText.substring(
        Math.max(0, i - anchor.prefix.length),
        i,
      );
      let score = 0;
      for (
        let j = 1;
        j <= Math.min(before.length, anchor.prefix.length);
        j++
      ) {
        if (
          before[before.length - j] ===
          anchor.prefix[anchor.prefix.length - j]
        )
          score++;
        else break;
      }
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
  }

  return { from: bestIdx, to: bestIdx + anchor.text.length };
}
