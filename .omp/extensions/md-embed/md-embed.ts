// Obsidian-style embeds in assistant replies, display only.
//
//   ![[/abs/file.md]]            the whole file (front matter dropped)
//   ![[~/file.md#L10-L40]]       lines 10–40 (`#L10` is one line)
//   ![[~/file.md#Some heading]]  that heading's section
//   ![[~/file.md|Label]]         any of the above under another label
//   [[~/any/file]]               a plain link to the file
//
// An embed draws as a `> [!NOTE]` callout whose first line links the file with
// the title EMBED_TITLE; the md-embed Tern plugin (tern-plugins/md-embed) keys its styling on that
// title. Tern's native view draws the callout as a card; a plain terminal gets
// a quote without the `[!NOTE]` line, since omp's terminal Markdown has no
// callouts. Only `.md` files on absolute or `~` paths embed; anything that does
// not resolve stays as written. Needs `extensionRenderers.assistantText` on.
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, normalize } from "node:path";

export const EMBED_TITLE = "Embedded file";
const MAX_LINES = 300;
const MAX_DEPTH = 2;
const MAX_BYTES = 2 * 1024 * 1024;
const MARKDOWN = /\.(md|markdown)$/i;

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
}

interface Cached {
	mtimeMs: number;
	size: number;
	lines: string[];
}

const cache = new Map<string, Cached>();

/** `path[#fragment][|alias]` with the path made absolute; undefined unless it names an existing file. */
function parseTarget(raw: string): Target | undefined {
	const [ref, ...aliasParts] = raw.split("|");
	const alias = aliasParts.join("|").trim() || undefined;
	const hash = ref!.indexOf("#");
	let path = (hash < 0 ? ref! : ref!.slice(0, hash)).trim();
	const fragment = hash < 0 ? undefined : ref!.slice(hash + 1).trim() || undefined;
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

/** The callout lines for one embed, unprefixed; undefined when it does not resolve or embeds a file already open above it. */
function embedBlock(raw: string, opts: RenderOptions, stack: readonly string[]): string[] | undefined {
	const target = parseTarget(raw);
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
		return target ? link(target.alias ?? basename(target.path), target.path) : whole;
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
					if (!target) return whole;
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
