import type { Link } from "../shared/links";

/** One sub-row of an unfolded row: `url` opens; `query` is the variant's literal `?query#fragment`, empty for the bare URL. */
export interface VariantRow {
  url: string;
  query: string;
  /** Its newest mention; none for a bare URL that was never mentioned on its own. */
  lastAt?: number;
}

/** A run of a sub-row's text: URL syntax and keys are faded; `value` runs are query values and the fragment. */
export interface UrlPart {
  text: string;
  value: boolean;
}

/** The URL without its query string and fragment. Plain string work: React Native's `URL` can't set `search`. */
function withoutQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut < 0 ? url : url.slice(0, cut);
}

/**
 * The sub-rows of a row with variants: the bare URL first, then the other variants newest first.
 * The bare URL is the variant without query or fragment when it was mentioned; else it is derived
 * from the newest variant, and a `/index.html` the row's key dropped (the webshare's `/dir/`) is
 * dropped from it too.
 */
export function variantRows(link: Link): VariantRow[] {
  const variants = link.variants;
  if (!variants?.length) return [];
  const bare = variants.find((variant) => !variant.query);
  let first: VariantRow;
  if (bare) first = { url: bare.url, query: "", lastAt: bare.lastAt };
  else {
    let url = withoutQuery(variants[0]!.url);
    if (url.endsWith("/index.html") && !link.key.endsWith("/index.html")) url = url.slice(0, -"index.html".length);
    first = { url, query: "" };
  }
  const rest = variants.filter((variant) => variant !== bare).map((variant) => ({ url: variant.url, query: variant.query, lastAt: variant.lastAt }));
  return [first, ...rest];
}

/**
 * A variant's literal `?query#fragment` in runs: `?`, `&`, `=`, keys and `#` faded, each value
 * and the fragment not; adjacent runs of one kind are joined.
 */
export function queryParts(query: string): UrlPart[] {
  const parts: UrlPart[] = [];
  const push = (text: string, value: boolean) => {
    if (!text) return;
    const last = parts.at(-1);
    if (last && last.value === value) last.text += text;
    else parts.push({ text, value });
  };
  const hash = query.indexOf("#");
  const search = hash < 0 ? query : query.slice(0, hash);
  const body = search.startsWith("?") ? search.slice(1) : search;
  if (search.startsWith("?")) push("?", false);
  body.split("&").forEach((pair, index) => {
    if (index) push("&", false);
    const eq = pair.indexOf("=");
    if (eq < 0) return push(pair, false);
    push(pair.slice(0, eq + 1), false);
    push(pair.slice(eq + 1), true);
  });
  if (hash >= 0) {
    push("#", false);
    push(query.slice(hash + 1), true);
  }
  return parts;
}

/**
 * A row's path shortened until `fits` accepts it: the full path; the first segment (host or `~`),
 * `/…/` and the last two segments; `…/` and the last two; `…/` and the last segment, cut at the
 * end with `…`. A trailing `/` stays with the last segment.
 */
export function shortenPath(path: string, fits: (text: string) => boolean): string {
  if (fits(path)) return path;
  const slash = path.endsWith("/") && path.length > 1 ? "/" : "";
  const segments = (slash ? path.slice(0, -1) : path).split("/");
  const lastTwo = `${segments.slice(-2).join("/")}${slash}`;
  if (segments.length > 3) {
    const kept = `${segments[0]}/…/${lastTwo}`;
    if (fits(kept)) return kept;
  }
  if (segments.length > 2 && fits(`…/${lastTwo}`)) return `…/${lastTwo}`;
  const last = `${segments.length > 1 ? "…/" : ""}${segments.at(-1)}${slash}`;
  if (fits(last)) return last;
  // The longest start of `last` that fits with a closing `…`.
  let low = 0;
  let high = last.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(`${last.slice(0, mid)}…`)) low = mid;
    else high = mid - 1;
  }
  return `${last.slice(0, low)}…`;
}
