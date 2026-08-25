// Turns raw fetched HTML into plain text worth feeding to the model:
// strips non-content tags, collapses whitespace, and drops pages that
// carry almost nothing (typical of JS-only SPAs we can't render here).
const STRIP_TAG_PATTERN = /<(script|style|noscript|svg|nav|footer|header|form|iframe|template)\b[^>]*>[\s\S]*?<\/\1>/gi;
const COOKIE_BANNER_PATTERN = /<[^>]+\b(class|id)=["'][^"']*(cookie|consent|gdpr)[^"']*["'][^>]*>[\s\S]*?<\/[a-z0-9]+>/gi;
const TAG_PATTERN = /<[^>]+>/g;
const MIN_USABLE_CHARS = 200;

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

export function extractReadableText(html: string): string {
  let cleaned = html;
  cleaned = cleaned.replace(COOKIE_BANNER_PATTERN, " ");
  cleaned = cleaned.replace(STRIP_TAG_PATTERN, " ");
  cleaned = cleaned.replace(TAG_PATTERN, " ");
  cleaned = decodeEntities(cleaned);
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return dedupeRepeatedLines(cleaned);
}

// Boilerplate (nav labels, repeated CTAs) tends to survive as identical
// short runs; collapsing exact repeats keeps the signal-to-noise ratio up
// without a real DOM/readability pass.
function dedupeRepeatedLines(text: string): string {
  const seen = new Set<string>();
  const parts = text.split(/(?<=[.!?])\s+/);
  const kept: string[] = [];
  for (const part of parts) {
    const key = part.trim().toLowerCase();
    if (key.length < 3) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(part.trim());
  }
  return kept.join(" ");
}

export function isContentSufficient(text: string): boolean {
  return text.length >= MIN_USABLE_CHARS;
}

export type ExtractedPage = { url: string; text: string };

export function extractPage(url: string, html: string): ExtractedPage {
  return { url, text: extractReadableText(html) };
}
