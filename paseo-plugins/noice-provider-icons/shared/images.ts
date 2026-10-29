export const MAX_IMAGE_BYTES = 128 * 1024;
const header = /^data:(image\/(?:svg\+xml|png|webp|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/;

/** Validate bytes, not a filename or the browser-supplied MIME alone. SVG stays an image, never inline DOM. */
export function validateImage(source: string): string | null {
  const match = header.exec(source);
  if (!match) return "Choose an SVG, PNG, WebP or JPEG image.";
  if (match[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) return "Image exceeds 128 KiB. Use a small icon.";
  let bytes: string;
  try { bytes = atob(match[2]); } catch { return "Invalid base64 image."; }
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return "Image exceeds 128 KiB or is empty.";
  const starts = (...values: number[]) => values.every((value, i) => bytes.charCodeAt(i) === value);
  switch (match[1]) {
    case "image/png":
      if (bytes.length < 33 || !starts(137, 80, 78, 71, 13, 10, 26, 10) || bytes.slice(12, 16) !== "IHDR") return "Invalid PNG image.";
      break;
    case "image/jpeg":
      if (bytes.length < 4 || !starts(255, 216, 255) || bytes.slice(-2) !== "\xff\xd9") return "Invalid JPEG image.";
      break;
    case "image/webp":
      if (bytes.length < 20 || bytes.slice(0, 4) !== "RIFF" || bytes.slice(8, 12) !== "WEBP" || !["VP8 ", "VP8L", "VP8X"].includes(bytes.slice(12, 16))) return "Invalid WebP image.";
      break;
    case "image/svg+xml": {
      // Comments (editor headers) carry no content; strip them with indexOf so an unclosed one stays linear.
      const text = bytes.trim().replace(/^<\?xml\s[^?]*\?>\s*/i, "");
      const kept: string[] = [];
      let from = 0;
      for (let at = text.indexOf("<!--"); at !== -1; at = text.indexOf("<!--", from)) {
        const end = text.indexOf("-->", at + 4);
        if (end === -1) return "Invalid SVG image.";
        kept.push(text.slice(from, at));
        from = end + 3;
      }
      kept.push(text.slice(from));
      const svg = kept.join("").trim();
      if (!/^<svg\b[\s\S]*(?:<\/svg\s*>|\/>)$/i.test(svg)) return "Invalid SVG image.";
      // `url(#id)` and `href="#id"` (clip paths, gradients) point inside the file and stay allowed.
      if (/<\s*(?:script|foreignObject|iframe|object|embed|image|use|animate\w*|set|a)\b|<[!?]|\bon\w+\s*=|src\s*=|href\s*=(?!\s*["']?#)|url\s*\((?!\s*["']?#)|@import|javascript\s*:/i.test(svg)) return "SVG must be a self-contained static image (no scripts, external resources or embedded content).";
      break;
    }
  }
  return null;
}

/** `original` paints the image as-is; `monochrome` uses its alpha as a mask in Paseo's glyph color. */
export type IconStyle = "original" | "monochrome";
export interface Mapping { provider: string; image: string; name: string; style: IconStyle }
export function resolveMapping(mappings: readonly Mapping[], provider: string): Mapping | undefined {
  return mappings.find((mapping) => mapping.provider === provider);
}
export function putMapping(mappings: readonly Mapping[], mapping: Mapping): Mapping[] {
  return [...mappings.filter((entry) => entry.provider !== mapping.provider), mapping];
}
