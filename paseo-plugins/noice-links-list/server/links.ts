import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { Link } from "../shared/links";
import { DEFAULT_WEBSHARE_FOLDER } from "../shared/settings";
import { findMentions, type Mention } from "./extract";
import { snippetAt } from "./snippet";

/** Optional mapping from the webshare folder to a configured HTTP origin. */
export interface Site {
  home: string;
  webshareDir: string;
  webshareOrigin: string;
}

/** `webshareFolder` with `~` as `home`, relative to `home`, no trailing `/`; empty means the default. */
export function siteFor(home: string, webshareOrigin = "", webshareFolder = DEFAULT_WEBSHARE_FOLDER): Site {
  const folder = (webshareFolder.trim() || DEFAULT_WEBSHARE_FOLDER).replace(/^~(?=$|\/)/, home);
  return { home, webshareDir: path.resolve(home, folder), webshareOrigin: webshareOrigin ? new URL(webshareOrigin).origin : "" };
}

/** A message's prose as one transcript record or timeline row gives it. */
export interface Prose {
  role: "user" | "assistant";
  text: string;
  /** Epoch ms. */
  at: number;
}

/** One distinct full URL of a link, as merging tracks it. */
interface VariantEntry {
  url: string;
  query: string;
  title?: string;
  /** Epoch ms of the mention `title` came from. */
  titleAt: number;
  count: number;
  lastAt: number;
  /** Order of its newest mention among all merges: breaks `lastAt` ties (one message, several URLs) as the row's own newest-wins rule does. */
  seq: number;
}

let mentionSeq = 0;

/**
 * A link plus what merging needs: `name` (the page or file name), the link texts seen, a file's
 * path and line, `disk` (the path checked for `missing`: a file, or a webshare URL's file) and,
 * for URLs, each distinct full URL by its normalized form.
 */
interface Entry extends Omit<Link, "title" | "copy" | "missing" | "variants"> {
  name: string;
  /** The newest mention's link text. */
  text?: string;
  /** Every distinct link text. */
  texts: Set<string>;
  /** Some link text named a variant (`[tree](page.html?v=tree)`), not the page. */
  labelled: boolean;
  file?: string;
  line?: string;
  disk?: string;
  variants: Map<string, VariantEntry>;
}

/** One mention, classified: the row it makes plus, for URLs, which full URL it was. */
export interface Classified extends Omit<Entry, "lastAt" | "texts" | "labelled" | "variants"> {
  /** How the mention reads: its link text, else `name`. */
  title: string;
  variant?: { id: string; url: string; query: string; label: boolean };
}

/** Links of one chat by dedupe key. */
export type LinkMap = Map<string, Entry>;

const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|svg|avif|bmp|ico|heic)$/i;
const CODE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs|json|ya?ml|toml|sh|py|rs|go|css|html?|lua|sql)$/i;
const TEXT_EXT = /\.(?:md|txt|jsonl|log|csv)$/i;

/** `~/…/a/b` once a folder is longer than the row can show. */
export function shortDir(dir: string, home: string): string {
  const shown = dir === home || dir.startsWith(`${home}/`) ? `~${dir.slice(home.length)}` : dir;
  if (shown.length <= 34) return shown;
  const parts = shown.split("/");
  return `${shown.startsWith("~") ? "~/…/" : "…/"}${parts.slice(-2).join("/")}`;
}

/**
 * The page a URL names: scheme and host lowercased, default port dropped (both by `URL`), no
 * trailing `/`, no query, no fragment; on the webshare `/dir/index.html` is `/dir/`.
 */
function pagePath(url: URL, site: Site): string {
  const pathname = url.origin === site.webshareOrigin ? url.pathname.replace(/\/index\.html$/, "/") : url.pathname;
  return pathname.replace(/\/+$/, "");
}

/** The last path segment (`pull/12` for numeric ones), else the host. */
function urlTitle(host: string, pathname: string): string {
  const segments = pathname.split("/").filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
  const last = segments.at(-1);
  if (!last) return host;
  return /^\d+$/.test(last) && segments.length > 1 ? `${segments.at(-2)}/${last}` : last;
}

/** Link text that names a variant: a query parameter's value, name or `name=value`, or the fragment. */
function isVariantLabel(text: string, url: URL): boolean {
  const label = text.trim().toLowerCase();
  if (label && label === url.hash.slice(1).toLowerCase()) return true;
  for (const [name, value] of url.searchParams) {
    if ([value, name, `${name}=${value}`].some((part) => part.toLowerCase() === label)) return true;
  }
  return false;
}

/** The row's key, name, shown path and variant for a URL; `text` is the mention's link text. */
function urlParts(url: URL, site: Site, text: string | undefined) {
  const page = pagePath(url, site);
  const key = `${url.protocol}//${url.host}${page}`;
  const query = `${url.search}${url.hash}`;
  // As written, without scheme, query and fragment; a trailing `/` stays, a webshare `index.html` goes.
  let shown = url.origin === site.webshareOrigin ? url.pathname.replace(/\/index\.html$/, "/") : url.pathname;
  try {
    shown = decodeURI(shown);
  } catch {
    // Keep it encoded.
  }
  return {
    key,
    name: urlTitle(url.host, page),
    path: `${url.host}${shown === "/" ? "" : shown}`,
    url: url.href,
    variant: { id: `${key}${query}`, url: url.href, query, label: !!text && !!query && isVariantLabel(text, url) },
  };
}

function isDirectory(file: string): boolean {
  try {
    return statSync(file).isDirectory();
  } catch {
    return false;
  }
}

/** What a mention is in the popover: web/image (opens a URL) or file (copies the path). */
export function classify(mention: Mention, site: Site): Classified | null {
  const text = mention.title;
  if (mention.kind === "url") {
    let url: URL;
    try {
      url = new URL(mention.target);
    } catch {
      return null;
    }
    const image = IMAGE_EXT.test(url.pathname);
    let disk: string | undefined;
    if (url.origin === site.webshareOrigin) {
      try {
        disk = path.posix.join(site.webshareDir, decodeURIComponent(url.pathname));
      } catch {
        // Not a path we can check.
      }
    }
    const parts = urlParts(url, site, text);
    return {
      ...parts,
      kind: image ? "image" : "web",
      title: text ?? parts.name,
      ...(text ? { text } : {}),
      where: url.host,
      glyph: image ? "Image" : url.origin === site.webshareOrigin ? "AppWindow" : "Globe",
      ...(disk ? { disk } : {}),
    };
  }
  const file = mention.target;
  const dir = mention.dirHint || isDirectory(file);
  const name = `${path.posix.basename(file)}${dir ? "/" : ""}`;
  const where = shortDir(path.posix.dirname(file), site.home);
  if (site.webshareOrigin && (file === site.webshareDir || file.startsWith(`${site.webshareDir}/`))) {
    const url = new URL(`${site.webshareOrigin}${encodeURI(file.slice(site.webshareDir.length) || "/")}${dir && file !== site.webshareDir ? "/" : ""}`);
    const image = IMAGE_EXT.test(file);
    return {
      ...urlParts(url, site, text),
      kind: image ? "image" : "web",
      name,
      title: text ?? name,
      ...(text ? { text } : {}),
      where,
      glyph: image ? "Image" : "AppWindow",
      disk: file,
    };
  }
  return {
    key: `file:${file}`,
    kind: "file",
    // Under the home folder as `~/…`; `listLinks` adds the `:line`.
    path: `${file === site.home || file.startsWith(`${site.home}/`) ? `~${file.slice(site.home.length)}` : file}${dir ? "/" : ""}`,
    name,
    title: text ?? name,
    ...(text ? { text } : {}),
    where,
    file,
    disk: file,
    ...(mention.line ? { line: mention.line } : {}),
    glyph: dir ? "Folder" : IMAGE_EXT.test(file) ? "Image" : CODE_EXT.test(file) ? "FileCode" : TEXT_EXT.test(file) ? "FileText" : "File",
  };
}

/**
 * Folds one mention in: the newest mention sets the row (where, URL, time, snippet); the newest
 * link text is kept over a derived name; a file keeps the newest `:line` seen. A URL also counts
 * toward its variant (its distinct full URL).
 */
export function merge(links: LinkMap, link: Classified, at: number): void {
  const { title: _title, variant, ...row } = link;
  const prev = links.get(link.key);
  const variants = prev?.variants ?? new Map<string, VariantEntry>();
  const texts = prev?.texts ?? new Set<string>();
  if (link.text) texts.add(link.text);
  if (variant) {
    const seq = ++mentionSeq;
    const seen = variants.get(variant.id);
    if (!seen) {
      variants.set(variant.id, { url: variant.url, query: variant.query, ...(link.text ? { title: link.text } : {}), titleAt: at, count: 1, lastAt: at, seq });
    } else {
      seen.count += 1;
      if (at >= seen.lastAt) {
        seen.lastAt = at;
        seen.seq = seq;
        seen.url = variant.url;
      }
      if (link.text && (!seen.title || at >= seen.titleAt)) {
        seen.title = link.text;
        seen.titleAt = at;
      }
    }
  }
  const labelled = (prev?.labelled ?? false) || !!variant?.label;
  if (!prev) {
    links.set(link.key, { ...row, lastAt: at, texts, labelled, variants });
    return;
  }
  const [newer, older] = at >= prev.lastAt ? [{ ...row, lastAt: at }, prev] : [prev, row];
  const text = newer.text ?? older.text;
  links.set(link.key, {
    ...newer,
    texts,
    labelled,
    variants,
    ...(text ? { text } : {}),
    ...(newer.line ?? older.line ? { line: newer.line ?? older.line } : {}),
    ...(newer.snippet ?? older.snippet ? { snippet: newer.snippet ?? older.snippet } : {}),
  });
}

/**
 * The row's name: the page or file name when a link text named a variant or the variants'
 * texts disagree; else the one link text (newest one for a single URL); else the name.
 */
function rowTitle(entry: Entry): string {
  if (entry.labelled) return entry.name;
  if (entry.variants.size > 1) return entry.texts.size === 1 ? [...entry.texts][0]! : entry.name;
  return entry.text ?? entry.name;
}

export function addProse(links: LinkMap, prose: Prose, site: Site): void {
  const { prose: text, found } = findMentions(prose.text, prose.role, { home: site.home, exists: existsSync });
  const classified = found.map(({ mention }) => classify(mention, site));
  const spans = found.map(({ start, end }, index) => ({ start, end, label: classified[index]?.title ?? text.slice(start, end) }));
  classified.forEach((link, index) => {
    if (!link) return;
    const snippet = snippetAt(text, spans, index);
    merge(links, snippet ? { ...link, snippet } : link, prose.at);
  });
}

/**
 * Newest first, as the popover shows them; paths are checked on disk on every call. `variants`
 * only for 2+ distinct full URLs, or (`everyVariant`, for the links page to merge across tabs)
 * for every URL link.
 */
export function listLinks(links: LinkMap, everyVariant = false): Link[] {
  return [...links.values()]
    .sort((a, b) => b.lastAt - a.lastAt)
    .map((entry) => {
      const { name: _name, text: _text, texts: _texts, labelled: _labelled, variants, file, line, disk, ...link } = entry;
      return {
        ...link,
        title: rowTitle(entry),
        ...(file ? { copy: `${file}${line ?? ""}`, path: `${link.path}${line ?? ""}` } : {}),
        ...(disk && !existsSync(disk) ? { missing: true } : {}),
        ...(variants.size > (everyVariant ? 0 : 1)
          ? {
              variants: [...variants.values()]
                .sort((a, b) => b.lastAt - a.lastAt || b.seq - a.seq)
                .map(({ url, query, title, count, lastAt }) => ({ url, query, ...(title ? { title } : {}), count, lastAt })),
            }
          : {}),
      };
    });
}

/**
 * What the chat's sub-agents add: their links whose key the chat itself never mentioned, one row
 * per link, marked `via` the sub-agent that mentioned it last. Newest first. `everyVariant` as in `listLinks`.
 */
export function subagentLinks(chat: LinkMap, subagents: readonly { name: string; links: LinkMap }[], everyVariant = false): Link[] {
  const added = new Map<string, Link>();
  for (const subagent of subagents) {
    for (const link of listLinks(subagent.links, everyVariant)) {
      if (chat.has(link.key)) continue;
      const prev = added.get(link.key);
      if (!prev || link.lastAt > prev.lastAt) added.set(link.key, { ...link, via: subagent.name });
    }
  }
  return [...added.values()].sort((a, b) => b.lastAt - a.lastAt);
}
