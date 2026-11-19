// Obsidian-style embeds in assistant replies, display only.
//
//   ![[/abs/file.md]]            the whole file (front matter dropped)
//   ![[~/file.md#L10-L40]]       lines 10–40 (`#L10` is one line)
//   ![[~/file.md#Some heading]]  that heading's section
//   ![[~/file.md|Label]]         any of the above under another label
//   ![[~/shot.svg]]              a picture (png, jpg, gif, webp, avif, svg) under its file link
//   [[~/any/file]]               a plain link to the file
//   ![[2026-11-18-note]]         a name looked up in the vault folder
//   ![[efforts/slip-box/map]]    the vault file whose path ends with these folders and name
//
// An embed draws as a `> [!NOTE]` callout whose first line links the file with
// the title EMBED_TITLE; the md-embed Tern plugin (tern-plugins/md-embed) keys its styling on that
// title. Tern's native view draws the callout as a card; a plain terminal gets
// a quote without the `[!NOTE]` line, since omp's terminal Markdown has no
// callouts. Only `.md` files and pictures on absolute or `~` paths, or names found
// in the vault folder, embed; anything that does not resolve stays as written.
// Needs `extensionRenderers.assistantText` on.
//
// Vault folder: `vaultFolder` in `$PI_CODING_AGENT_DIR/md-embed.json`, re-read when the file changes.
import type { Dirent } from "node:fs";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, normalize, relative } from "node:path";

export const EMBED_TITLE = "Embedded file";
const MAX_LINES = 300;
const MAX_DEPTH = 2;
const MAX_BYTES = 2 * 1024 * 1024;
const MARKDOWN = /\.(md|markdown)$/i;
const PICTURE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

const EMBED = /!\[\[([^\[\]\n]+?)\]\]/g;
const WIKILINK = /(?<!!)\[\[([^\[\]\n]+?)\]\]/g;
/** A trailing `![[` or `[[` the stream has not closed yet. */
const OPEN_TAIL = /!?\[\[[^\[\]\n]*\]?$/;
const FENCE = /^\s*(?:>\s?)*\s*(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;

export interface RenderOptions {
	/** Whether a Tern native view draws the text; false drops the `[!NOTE]` line. */
	callouts: boolean;
}

interface Target {
	path: string;
	fragment: string | undefined;
	alias: string | undefined;
	/** A vault name several vault files match: their paths, and `path` is the vault folder. */
	several?: string[];
}

interface Cached {
	mtimeMs: number;
	size: number;
	lines: string[];
}

const cache = new Map<string, Cached>();

let config: { stamp: string | null; vault: string | undefined } = { stamp: null, vault: undefined };

/** The vault folder from `md-embed.json` (`{ "vaultFolder": "/abs/path" }`); undefined when unset or invalid. */
function vaultFolder(): string | undefined {
	// Per lookup: named profiles point PI_CODING_AGENT_DIR at their own agent dir.
	const file = join(process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".omp", "agent"), "md-embed.json");
	let stamp: string | null;
	try {
		const stat = statSync(file);
		stamp = `${file}:${stat.mtimeMs}:${stat.size}`;
	} catch {
		stamp = null;
	}
	if (stamp === config.stamp) return config.vault;
	let vault: string | undefined;
	try {
		const value: unknown = stamp && JSON.parse(readFileSync(file, "utf8")).vaultFolder;
		const path = typeof value === "string" ? value.trim().replace(/^~(?=$|\/)/, homedir()) : "";
		if (path && isAbsolute(path)) vault = normalize(path);
	} catch {}
	config = { stamp, vault };
	return vault;
}

/**
 * The vault's files by file name, with each folder's mtime when it was read. Reused while every
 * folder keeps its mtime (a file added, removed or renamed changes its folder's), so a lookup costs
 * one stat per folder; nothing runs between lookups. Dot-folders and `node_modules` are skipped;
 * symlinked folders are not followed.
 */
let vaultIndex: { root: string; folders: Map<string, number>; files: Map<string, string[]> } | undefined;

function vaultFiles(root: string): Map<string, string[]> {
	const fresh = (folder: string, mtimeMs: number) => {
		try {
			return statSync(folder).mtimeMs === mtimeMs;
		} catch {
			return false;
		}
	};
	if (vaultIndex?.root === root && [...vaultIndex.folders].every(([folder, mtimeMs]) => fresh(folder, mtimeMs))) {
		return vaultIndex.files;
	}
	const folders = new Map<string, number>();
	const files = new Map<string, string[]>();
	const pending = [root];
	for (let folder = pending.pop(); folder !== undefined; folder = pending.pop()) {
		let entries: Dirent[];
		try {
			folders.set(folder, statSync(folder).mtimeMs);
			entries = readdirSync(folder, { withFileTypes: true });
		} catch {
			folders.set(folder, -1);
			continue;
		}
		for (const entry of entries) {
			const full = join(folder, entry.name);
			if (entry.isDirectory()) {
				if (!entry.name.startsWith(".") && entry.name !== "node_modules") pending.push(full);
			} else if (entry.isFile() || entry.isSymbolicLink()) {
				const same = files.get(entry.name);
				if (same) same.push(full);
				else files.set(entry.name, [full]);
			}
		}
	}
	vaultIndex = { root, folders, files };
	return files;
}

/**
 * A target looked up in the vault folder: not absolute, not `~/`, and every `/`-separated part a
 * name (no empty, `.` or `..` part).
 */
function isVaultName(path: string): boolean {
	if (path.startsWith("/") || path === "~" || path.startsWith("~/")) return false;
	return path.split("/").every(part => part !== "" && part !== "." && part !== "..");
}

/**
 * The vault files a vault name names, `<name>.md` when it has no extension: those whose
 * vault-relative path is the name or ends with `/` + it, so `a/map` finds `efforts/a/map.md` but
 * `map` never finds `roadmap.md`. Only files sharing the name's file name are compared.
 */
function vaultMatches(vault: string, name: string): string[] {
	const want = /\.[a-z\d]+$/i.test(name) ? name : `${name}.md`;
	return (vaultFiles(vault).get(basename(want)) ?? []).filter(full => {
		const rel = relative(vault, full);
		return rel === want || rel.endsWith(`/${want}`);
	});
}

/**
 * `path[#fragment][|alias]` with the path made absolute; undefined unless it names an existing file.
 * A path that is not absolute and not `~/` is looked up in the vault folder by `vaultMatches`; with
 * no match it resolves as before (and, being relative, does not resolve).
 */
function parseTarget(raw: string): Target | undefined {
	const [ref, ...aliasParts] = raw.split("|");
	const alias = aliasParts.join("|").trim() || undefined;
	const hash = ref!.indexOf("#");
	let path = (hash < 0 ? ref! : ref!.slice(0, hash)).trim();
	const fragment = hash < 0 ? undefined : ref!.slice(hash + 1).trim() || undefined;
	const vault = isVaultName(path) ? vaultFolder() : undefined;
	if (vault) {
		const matches = vaultMatches(vault, path);
		if (matches.length > 1) return { path: vault, fragment, alias: alias ?? path, several: matches };
		if (matches.length === 1) path = matches[0]!;
	}
	if (path === "~" || path.startsWith("~/")) path = homedir() + path.slice(1);
	if (!isAbsolute(path)) return undefined;
	path = normalize(path);
	try {
		if (!statSync(path).isFile()) return undefined;
	} catch {
		return undefined;
	}
	return { path, fragment, alias };
}

function readLines(path: string): string[] | undefined {
	const stat = statSync(path);
	if (stat.size > MAX_BYTES) return undefined;
	const hit = cache.get(path);
	if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.lines;
	const lines = readFileSync(path, "utf8").replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
	cache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, lines });
	return lines;
}

/** Lines outside fenced code, as a mask: true where the line is fence or fence content. */
function fencedLines(lines: readonly string[]): boolean[] {
	const mask: boolean[] = [];
	let open: string | undefined;
	for (const line of lines) {
		const fence = FENCE.exec(line)?.[1];
		if (open) {
			mask.push(true);
			if (fence && fence[0] === open[0] && fence.length >= open.length) open = undefined;
		} else if (fence) {
			mask.push(true);
			open = fence;
		} else {
			mask.push(false);
		}
	}
	return mask;
}

/** The slice of `lines` a fragment names and the label suffix for it; undefined when it names nothing. */
function slice(lines: string[], fragment: string | undefined): { lines: string[]; label: string } | undefined {
	if (!fragment) {
		let start = 0;
		if (lines[0] === "---") {
			const end = lines.indexOf("---", 1);
			if (end > 0) start = end + 1;
		}
		while (start < lines.length && lines[start]!.trim() === "") start++;
		return { lines: lines.slice(start), label: "" };
	}
	const range = /^L(\d+)(?:-L?(\d+))?$/i.exec(fragment);
	if (range) {
		const from = Number(range[1]);
		const to = range[2] ? Number(range[2]) : from;
		if (from < 1 || to < from || from > lines.length) return undefined;
		const last = Math.min(to, lines.length);
		return { lines: lines.slice(from - 1, last), label: from === last ? ` · L${from}` : ` · L${from}–${last}` };
	}
	const want = fragment.toLowerCase();
	const fenced = fencedLines(lines);
	for (let i = 0; i < lines.length; i++) {
		const heading = !fenced[i] && HEADING.exec(lines[i]!);
		if (!heading || heading[2]!.trim().toLowerCase() !== want) continue;
		const level = heading[1]!.length;
		let end = i + 1;
		while (end < lines.length) {
			const next = !fenced[end] && HEADING.exec(lines[end]!);
			if (next && next[1]!.length <= level) break;
			end++;
		}
		return { lines: lines.slice(i + 1, end), label: ` · ${heading[2]!.trim()}` };
	}
	return undefined;
}

function link(label: string, path: string, title?: string): string {
	const dest = /[\s<>()]/.test(path) ? `<${path}>` : path;
	return `[${label.replace(/([\\\[\]])/g, "\\$1")}](${dest}${title ? ` "${title}"` : ""})`;
}

/** The callout for a vault name several vault files match: a note linking each of them. */
function severalBlock(target: Target, opts: RenderOptions): string[] {
	const names = target.several!.map(path => link(relative(target.path, path), path)).sort();
	const header = link(target.alias!, target.path, EMBED_TITLE);
	const block = [...(opts.callouts ? ["[!NOTE]"] : []), header, "", `*Several files in the vault folder have this name: ${names.join(", ")}.*`];
	return block.map(line => (line === "" ? ">" : `> ${line}`));
}

/** The callout for a picture: its header link, then the picture as a Markdown image (absolute path; see `link`). */
function pictureBlock(target: Target, opts: RenderOptions): string[] {
	const name = target.alias ?? basename(target.path);
	const header = link(name, target.path, EMBED_TITLE);
	const picture = `!${link(name, target.path)}`;
	const block = [...(opts.callouts ? ["[!NOTE]"] : []), header, "", picture];
	return block.map(line => (line === "" ? ">" : `> ${line}`));
}

/** The callout lines for one embed, unprefixed; undefined when it does not resolve or embeds a file already open above it. */
function embedBlock(raw: string, opts: RenderOptions, stack: readonly string[]): string[] | undefined {
	const target = parseTarget(raw);
	if (target?.several) return severalBlock(target, opts);
	if (target && PICTURE.test(target.path)) return pictureBlock(target, opts);
	if (!target || !MARKDOWN.test(target.path) || stack.includes(target.path)) return undefined;
	const all = readLines(target.path);
	if (!all) return undefined;
	const part = slice(all, target.fragment);
	if (!part) return undefined;

	let body = part.lines;
	const cut = body.length - MAX_LINES;
	if (cut > 0) body = body.slice(0, MAX_LINES);
	while (body.length && body[body.length - 1]!.trim() === "") body = body.slice(0, -1);
	const inner = [...stack, target.path];
	const rendered =
		inner.length >= MAX_DEPTH ? linkOnly(body.join("\n")) : transform(body.join("\n"), opts, inner);
	const lines = rendered.split("\n");
	if (cut > 0) lines.push("", `*… ${cut} more lines in ${link(basename(target.path), target.path)}*`);

	const header = link(target.alias ?? `${basename(target.path)}${part.label}`, target.path, EMBED_TITLE);
	const block = opts.callouts ? ["[!NOTE]", header] : [header];
	if (lines.some(line => line.trim() !== "")) block.push("", ...lines);
	return block.map(line => (line === "" ? ">" : `> ${line}`));
}

/** Embeds MAX_DEPTH levels down, drawn as plain links. */
function linkOnly(text: string): string {
	return text.replace(EMBED, (whole, raw: string) => {
		const target = parseTarget(raw);
		return target && !target.several ? link(target.alias ?? basename(target.path), target.path) : whole;
	});
}

const CONTAINER = /^((?:[ \t]*>[ \t]?)*)([ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)?/;

/** Rewrites one line that holds embeds into its pieces, keeping the line's quote and list container. */
function expandLine(
	plain: string,
	restore: (text: string) => string,
	opts: RenderOptions,
	stack: readonly string[],
): string | undefined {
	if (!plain.includes("![[")) return undefined;
	const [, lead = "", marker = ""] = CONTAINER.exec(plain)!;
	const rest = plain.slice(lead.length + marker.length);
	const indent = " ".repeat(marker.length);
	const blank = (lead + indent).trimEnd();

	const out: string[] = [];
	let first = true;
	let changed = false;
	const prefix = () => {
		const p = first ? lead + marker : lead + indent;
		first = false;
		return p;
	};
	let last = 0;
	for (const match of rest.matchAll(EMBED)) {
		const block = embedBlock(match[1]!, opts, stack);
		if (!block) continue;
		const before = rest.slice(last, match.index).trim();
		if (before) out.push(prefix() + restore(before), blank);
		block.forEach((blockLine, i) => out.push((i === 0 ? prefix() : lead + indent) + blockLine));
		out.push(blank);
		last = match.index! + match[0].length;
		changed = true;
	}
	if (!changed) return undefined;
	const after = rest.slice(last).trim();
	if (after) out.push(prefix() + restore(after));
	else out.pop();
	return out.join("\n");
}

/** The text with every resolvable embed and wiki link outside code expanded. */
export function transform(text: string, opts: RenderOptions, stack: readonly string[] = []): string {
	if (!text.includes("[[")) return text;
	const lines = text.split("\n");
	const fenced = fencedLines(lines);
	return lines
		.map((line, i) => {
			if (fenced[i] || !line.includes("[[")) return line;
			const masked: string[] = [];
			const plain = line
				.replace(/(`+)(?:(?!\1)[\s\S])*?\1/g, span => {
					masked.push(span);
					return `\u0000${masked.length - 1}\u0000`;
				})
				.replace(WIKILINK, (whole, raw: string) => {
					const target = parseTarget(raw);
					if (!target || target.several) return whole;
					return link(target.alias ?? `${basename(target.path)}${target.fragment ? `#${target.fragment}` : ""}`, target.path);
				});
			const restore = (piece: string) => piece.replace(/\u0000(\d+)\u0000/g, (_, n: string) => masked[Number(n)]!);
			return expandLine(plain, restore, opts, stack) ?? restore(plain);
		})
		.join("\n");
}

export default async function mdEmbed(pi: ExtensionAPI) {
	// Dynamic: the module is omp-internal, and a static import of a moved file fails the whole
	// extension's load. Without it every view gets the `[!NOTE]` callout form.
	let native: () => boolean = () => true;
	try {
		const state = await import("@oh-my-pi/pi-tui/native/state");
		native = state.isNativeRendering;
	} catch {}

	pi.registerAssistantTextRenderer(({ text, streaming }) => {
		try {
			const source = streaming ? text.replace(OPEN_TAIL, "") : text;
			const out = transform(source, { callouts: native() });
			return out === text ? undefined : out;
		} catch {
			return undefined;
		}
	});
}
