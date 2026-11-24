// Revisions: a copy of what an embed shows, taken when the embed is written, kept in `.revisions/` in the slip box
// holding the embedded file (a file in no box: the session's box, else the first listed box). Readers (the desk,
// anyone) look the copy up instead of today's file. The plan and its reviews: the slip box memo
// `2026-11-22-revisions-copying-proposal`. The store describes itself in `.revisions/README.md` (README below), so it
// can be read with no code from here.
//
// - A reply: on `assistant_message`, which omp awaits before it saves the reply or runs its tool calls. The copy is
//   named by the reply's `message.timestamp`.
// - A memo: at the end of a run, embed lines that are new since this session last looked, in box files this
//   session's own tools wrote, box by box. Tagged ` @<embedding file>`. Embeds inside a copied part: one level, as
//   md-embed draws.
// - Never throws into omp: every failure goes to `.revisions/errors.log` in the session's box (else the first listed
//   box); a failed first look of a box, to that box's.
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, linkSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, normalize, relative, sep } from "node:path";
import {
	EMBED,
	type From,
	MARKDOWN,
	type Target,
	boxFiles,
	boxOf,
	boxes,
	fencedLines,
	isBoxName,
	maskCode,
	parseTarget,
	readLines,
	slice,
} from "./md-embed.ts";

export const STORE = ".revisions";
const TIME_LENGTH = 24;

// ---------------------------------------------------------------------------------------------------------------
// Names

const NEEDS_ENCODING = /[%/\\:*?"<>|#@~\u0000-\u001f\u007f]/u;

function percent(char: string): string {
	return [...Buffer.from(char, "utf8")].map(byte => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`).join("");
}

/** One path segment, part or tag, percent-encoded so it is a safe, portable file name piece. */
export function encodeChunk(text: string): string {
	let out = "";
	for (const char of text) out += NEEDS_ENCODING.test(char) ? percent(char) : char;
	if (out.startsWith(".")) out = `%2E${out.slice(1)}`;
	const last = out.at(-1);
	if (last === "." || last === " ") out = out.slice(0, -1) + percent(last);
	return out;
}

/** An encoded chunk cut to `keep` UTF-8 bytes when it is over `max`, never inside a `%XX` or a character, plus `~` and 16 hex digits of its SHA-256. */
export function cutChunk(encoded: string, max: number, keep: number): string {
	if (Buffer.byteLength(encoded, "utf8") <= max) return encoded;
	let out = "";
	let bytes = 0;
	for (const atom of encoded.match(/%[0-9A-F]{2}|[\s\S]/gu) ?? []) {
		const size = Buffer.byteLength(atom, "utf8");
		if (bytes + size > keep) break;
		out += atom;
		bytes += size;
	}
	return `${out}~${createHash("sha256").update(encoded).digest("hex").slice(0, 16)}`;
}

function inside(folder: string, path: string): boolean {
	const rel = relative(folder, path);
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * The store folder for a link, from the link as written (label and part dropped): box-relative for a path in the
 * box, `_home/…` or `_root/…` for one outside it, a box name as written. Undefined for a box name md-embed
 * would never resolve.
 */
export function revisionFolder(raw: string, box: string, home = homedir()): string | undefined {
	const ref = raw.split("|")[0]!;
	const hash = ref.indexOf("#");
	let path = (hash < 0 ? ref : ref.slice(0, hash)).trim();
	let segments: string[];
	let fromBox = true;
	if (path === "~" || path.startsWith("~/") || path.startsWith("/")) {
		if (path !== "/" && !path.startsWith("/")) path = home + path.slice(1);
		path = normalize(path);
		if (inside(box, path)) segments = relative(box, path).split(sep);
		else if (inside(home, path)) {
			segments = ["_home", ...relative(home, path).split(sep)];
			fromBox = false;
		} else {
			segments = ["_root", ...path.slice(1).split(sep)];
			fromBox = false;
		}
	} else {
		if (!isBoxName(path)) return undefined;
		segments = path.split("/");
	}
	const lastIndex = segments.length - 1;
	segments[lastIndex] = segments[lastIndex]!.replace(/\.md$/, "");
	if (segments.some(segment => segment === "" || segment === "." || segment === "..")) return undefined;
	const encoded = segments.map(segment => cutChunk(encodeChunk(segment), 200, 180));
	// `_home` and `_root` are the store's own: a path in the box can never start like them.
	if (fromBox && encoded[0]!.startsWith("_")) encoded[0] = `%5F${encoded[0]!.slice(1)}`;
	return encoded.join("/");
}

/** The part as the store spells it: `L10-42` for lines (`L7` is `L7-7`), a heading trimmed and lower-cased. */
export function partKey(fragment: string | undefined): string | undefined {
	const text = fragment?.trim();
	if (!text) return undefined;
	const range = /^L(\d+)(?:-L?(\d+))?$/i.exec(text);
	if (range) return `L${Number(range[1])}-${Number(range[2] ?? range[1])}`;
	return text.toLowerCase();
}

export function timeName(ms: number): string {
	return new Date(ms).toISOString().replace(/:/g, "-");
}

/** Everything after the time: ` #<part>`, then ` @<tag>` (a memo's own embed) or ` @@<tag>` (inside a memo's copy). */
export function nameSuffix(part: string | undefined, tag?: string, nested = false): string {
	const partText = part ? ` #${cutChunk(encodeChunk(part), 100, 80)}` : "";
	const tagText = tag ? ` ${nested ? "@@" : "@"}${cutChunk(encodeChunk(tag), 100, 80)}` : "";
	return `${partText}${tagText}.md`;
}

/** The tag of a file in the box: its box path without `.md` (encoded as one chunk by `nameSuffix`). */
export function tagOf(file: string, box: string): string {
	return relative(box, file).split(sep).join("/").replace(/\.md$/, "");
}

// ---------------------------------------------------------------------------------------------------------------
// What a copy holds

/**
 * The section under heading `heading` (any case): from below it up to the next heading of its level or higher.
 * Headings inside fenced code don't count. Null when there is no such heading. A copy of the desk's own `section`
 * (slipbox-desk/server/render.ts), which is what compares a copy with today's text.
 */
export function section(text: string, heading: string): string | null {
	const lines = text.split("\n");
	const wanted = heading.trim().toLowerCase();
	let fence = "";
	let start = -1;
	let level = 0;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
		if (marker) {
			if (!fence) fence = marker;
			else if (marker[0] === fence[0] && marker.length >= fence.length) fence = "";
			continue;
		}
		if (fence) continue;
		const found = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
		if (!found) continue;
		if (start >= 0 && found[1]!.length <= level) return lines.slice(start, i).join("\n");
		if (start < 0 && found[2]!.trim().toLowerCase() === wanted) {
			start = i + 1;
			level = found[1]!.length;
		}
	}
	return start >= 0 ? lines.slice(start).join("\n") : null;
}

/** What an embed of `lines` with `fragment` shows, as stored: undefined when the part names nothing. */
export function copyText(lines: string[], fragment: string | undefined): string | undefined {
	const part = partKey(fragment);
	let body: string[];
	if (part && !/^L\d+-\d+$/.test(part)) {
		const found = section(lines.join("\n"), fragment!);
		if (found === null) return undefined;
		body = found.split("\n");
	} else {
		const cut = slice(lines, fragment);
		if (!cut) return undefined;
		body = cut.lines;
	}
	let end = body.length;
	while (end > 0 && body[end - 1]!.trim() === "") end--;
	return `${body.slice(0, end).join("\n")}\n`;
}

/** The `![[…]]` targets in `text` outside fenced code and inline code, in order. */
export function embedsIn(text: string): string[] {
	if (!text.includes("![[")) return [];
	const lines = text.split("\n");
	const fenced = fencedLines(lines);
	const out: string[] = [];
	lines.forEach((line, i) => {
		if (fenced[i] || !line.includes("![[")) return;
		for (const match of maskCode(line).plain.matchAll(EMBED)) out.push(match[1]!);
	});
	return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Writing

/** Writes `text` under `folder/name` in the store unless that name exists; true when written. */
export function writeCopy(box: string, folder: string, name: string, text: string): boolean {
	const dir = join(box, STORE, ...folder.split("/"));
	const dest = join(dir, name);
	if (existsSync(dest)) return false;
	ensureReadme(box);
	mkdirSync(dir, { recursive: true });
	const temp = join(dir, `.tmp-${process.pid}-${randomBytes(6).toString("hex")}`);
	writeFileSync(temp, text);
	try {
		linkSync(temp, dest); // fails when the name exists: the copy already there stays
		return true;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
		throw err;
	} finally {
		try {
			unlinkSync(temp);
		} catch { }
	}
}

export function logError(box: string, session: string, what: string, err: unknown): void {
	try {
		mkdirSync(join(box, STORE), { recursive: true });
		const message = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ");
		appendFileSync(join(box, STORE, "errors.log"), `${new Date().toISOString()}\t${session}\t${what}\t${message}\n`);
	} catch { }
}

interface Copied {
	path: string;
	text: string;
}

/** The box copies go into for a file in no box: the box holding `cwd`, else the first listed box. */
export function fallbackBox(cwd: string | undefined): string | undefined {
	return boxOf(cwd) ?? boxes()[0];
}

/**
 * Where an embed's copy goes: the file it names, resolved as md-embed does from `from`; the box holding that file,
 * else `fallback`; and its store folder in that box. Undefined when it names no single file.
 */
export function placeOf(raw: string, from: From, fallback: string): { target: Target; box: string; folder: string } | undefined {
	const target = parseTarget(raw, from);
	if (!target || target.several) return undefined;
	const box = boxOf(target.path) ?? fallback;
	const folder = revisionFolder(raw, box);
	return folder ? { target, box, folder } : undefined;
}

/**
 * Copies one embed into the box holding the embedded file, else into `fallback`: undefined when md-embed would not
 * show it as text (unresolved, several matches, not Markdown, over 2 MB, a part that names nothing), when it embeds
 * a file in `stack`, or when it is a capture.
 */
export function copyOne(
	fallback: string,
	raw: string,
	time: number,
	opts: { tag?: string; nested?: boolean; stack?: readonly string[]; from?: From } = {},
): Copied | undefined {
	const place = placeOf(raw, opts.from ?? {}, fallback);
	if (!place || !MARKDOWN.test(place.target.path)) return undefined;
	const { target, box, folder } = place;
	if (opts.stack?.includes(target.path)) return undefined;
	if (inside(join(box, "captures"), target.path)) return undefined; // captures never change
	const lines = readLines(target.path);
	if (!lines) return undefined;
	const text = copyText(lines, target.fragment);
	if (text === undefined) return undefined;
	writeCopy(box, folder, `${timeName(time)}${nameSuffix(partKey(target.fragment), opts.tag, opts.nested)}`, text);
	return { path: target.path, text };
}

/**
 * Copies an embed written at `from` and the embeds inside what it shows (one level, resolved from the embedded
 * file); each failure is logged in `fallback` on its own.
 */
export function copyWithNested(fallback: string, raw: string, time: number, session: string, from: From, tag?: string): void {
	let top: Copied | undefined;
	try {
		top = copyOne(fallback, raw, time, { tag, from });
	} catch (err) {
		logError(fallback, session, raw, err);
		return;
	}
	if (!top) return;
	for (const inner of embedsIn(top.text)) {
		try {
			copyOne(fallback, inner, time, { tag, nested: true, stack: [top.path], from: { file: top.path, cwd: from.cwd } });
		} catch (err) {
			logError(fallback, session, inner, err);
		}
	}
}

/** Whether the store holds a copy tagged with this embedder and part: a name whose text after the time is exactly that. */
export function hasTagged(box: string, folder: string, part: string | undefined, tag: string): boolean {
	const suffix = nameSuffix(part, tag);
	let names: string[];
	try {
		names = readdirSync(join(box, STORE, ...folder.split("/")));
	} catch {
		return false;
	}
	return names.some(name => name.length > TIME_LENGTH && name.slice(TIME_LENGTH) === suffix);
}

// ---------------------------------------------------------------------------------------------------------------
// The box's embeds, per file

/** An embed's identity in a file: its store folder and part. */
type Embeds = Map<string, string>; // key -> the link as written

const parsed = new Map<string, { mtimeMs: number; size: number; embeds: Embeds }>();

export function embedKey(raw: string, box: string): string | undefined {
	const folder = revisionFolder(raw, box);
	if (!folder) return undefined;
	const ref = raw.split("|")[0]!;
	const hash = ref.indexOf("#");
	return `${folder}\u0000${partKey(hash < 0 ? undefined : ref.slice(hash + 1)) ?? ""}`;
}

/** Every Markdown file in the box (not in a deeper box nested in it) with its embeds; a file that can't be read counts as absent. */
export function boxEmbeds(box: string): Map<string, Embeds> {
	const out = new Map<string, Embeds>();
	const deeper = boxes().filter(other => inside(box, other));
	for (const [name, paths] of boxFiles(box)) {
		if (!MARKDOWN.test(name)) continue;
		for (const path of paths) {
			if (deeper.some(other => inside(other, path))) continue;
			try {
				const stat = statSync(path);
				const hit = parsed.get(path);
				if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
					out.set(path, hit.embeds);
					continue;
				}
				const lines = readLines(path);
				if (!lines) continue;
				const embeds: Embeds = new Map();
				for (const raw of embedsIn(lines.join("\n"))) {
					const key = embedKey(raw, box);
					if (key && !embeds.has(key)) embeds.set(key, raw);
				}
				parsed.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, embeds }); // replaced, never changed in place
				out.set(path, embeds);
			} catch { }
		}
	}
	return out;
}

/** The absolute paths a successful `write` or `edit` result names. */
export function writtenPaths(message: { toolName?: string; details?: unknown }): string[] {
	const { details } = message;
	if (!details || typeof details !== "object") return [];
	const out: string[] = [];
	const pathIn = (value: unknown, key: string) => {
		if (value && typeof value === "object" && key in value) {
			const path: unknown = Reflect.get(value, key);
			if (typeof path === "string" && isAbsolute(path)) out.push(normalize(path));
		}
	};
	if (message.toolName === "write") pathIn(details, "resolvedPath");
	if (message.toolName === "edit") {
		pathIn(details, "path");
		const items: unknown = Reflect.get(details, "perFileResults");
		if (Array.isArray(items)) for (const item of items) pathIn(item, "path");
	}
	return out;
}

function bornBefore(file: string, time: number): boolean {
	try {
		const born = statSync(file).birthtimeMs;
		return born > 0 && born < time;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------------------------------------------
// The extension

export default function revisions(pi: ExtensionAPI) {
	pi.on("assistant_message", (event, ctx) => {
		const fallback = fallbackBox(ctx.cwd);
		if (!fallback) return;
		const session = ctx.sessionManager.getSessionId();
		const text = event.message.content.flatMap(block => (block.type === "text" ? [block.text] : [])).join("\n");
		for (const raw of embedsIn(text)) copyWithNested(fallback, raw, event.message.timestamp, session, { cwd: ctx.cwd });
		// returns undefined: the message is never rewritten
	});

	// Per factory call: omp runs the factory once per session, subagents included. Nothing touches the disk here:
	// a factory that throws loses the extension for the whole session.
	const known = new Map<string, { at: number; embeds: Map<string, Embeds> }>(); // per box: its baseline and when taken
	const mine = new Set<string>(); // files this session's tools wrote since the last scan

	const look = (box: string) => {
		const at = Date.now();
		known.set(box, { at, embeds: boxEmbeds(box) });
	};

	const scan = (ctx: ExtensionContext) => {
		const session = ctx.sessionManager.getSessionId();
		const written = new Map<string, string[]>(); // box -> the files in it this session wrote
		for (const file of mine) {
			const box = boxOf(file);
			if (box) written.set(box, [...(written.get(box) ?? []), file]);
		}
		mine.clear();
		const fallback = fallbackBox(ctx.cwd);
		for (const [box, files] of written) {
			const spare = fallback ?? box; // copies of files in no box, and errors
			try {
				const before = known.get(box);
				if (!before) {
					look(box); // no baseline for this box yet: take one, copy nothing
					continue;
				}
				const at = Date.now();
				const now = boxEmbeds(box);
				for (const file of files) {
					const embeds = now.get(file);
					if (!embeds) continue;
					const old = before.embeds.get(file);
					// New to the baseline but born before it was taken: moved or restored, not written. No copies.
					if (!old && bornBefore(file, before.at)) continue;
					const tag = tagOf(file, box);
					const from = { file, cwd: ctx.cwd };
					for (const [key, raw] of embeds) {
						if (old?.has(key)) continue;
						const part = key.split("\u0000")[1];
						try {
							const place = placeOf(raw, from, spare);
							if (place && hasTagged(place.box, place.folder, part || undefined, tag)) continue;
							copyWithNested(spare, raw, at, session, from, tag);
						} catch (err) {
							logError(spare, session, raw, err);
						}
					}
				}
				// always advances: a copy that failed isn't retried by this session; the import repairs it
				known.set(box, { at, embeds: now });
			} catch (err) {
				logError(spare, session, "scan", err);
			}
		}
	};

	pi.on("agent_start", (_event, ctx) => {
		for (const box of boxes()) {
			if (known.has(box)) continue;
			try {
				look(box);
			} catch (err) {
				logError(box, ctx.sessionManager.getSessionId(), "first look", err);
			}
		}
	});

	// Tool results, read when their message ends. Not `tool_result`: a handler for it switches off omp's early
	// subagent launch.
	pi.on("message_end", event => {
		const message = event.message;
		if (message.role !== "toolResult" || message.isError) return;
		for (const path of writtenPaths(message)) mine.add(path);
	});

	pi.on("agent_end", (event, ctx) => {
		if (event.willContinue && !event.awaitingAsyncWork) return; // an automatic continuation: same run
		scan(ctx);
	});

	// Any dispose: Ctrl+C or /exit mid-run, a subagent's end. `omp models` and the like have nothing to scan.
	pi.on("session_shutdown", (_event, ctx) => {
		if (mine.size) scan(ctx);
	});
}

// ---------------------------------------------------------------------------------------------------------------
// The store's own description

function ensureReadme(box: string): void {
	const path = join(box, STORE, "README.md");
	if (existsSync(path)) return;
	mkdirSync(join(box, STORE), { recursive: true });
	const temp = `${path}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
	writeFileSync(temp, README);
	try {
		linkSync(temp, path);
	} catch {
	} finally {
		try {
			unlinkSync(temp);
		} catch { }
	}
}

export const README = `# .revisions

Copies of what an embed (\`![[…]]\`) showed when it was written, so a reader can show a memo as it was, not as it
is now. Written by the omp extension \`revisions\` (in md-embed) and its import. Agents never edit this folder, and
searches should leave it out: it holds old text.

## Layout

\`<folder>/<time>[ #<part>][ @<tag> | @@<tag>].md\` — one file per copy, its text exactly what the embed showed.

**Folder**, from the link as written, \`|label\` and \`#part\` dropped and trimmed:
- \`~\`, \`~/…\` or an absolute path: \`~\` expanded, the path normalized. Inside this box it becomes box-relative;
  inside the home folder \`_home/<rest>\`; anywhere else \`_root/<rest>\`.
- otherwise a name looked up in the slip boxes, as written (no empty, \`.\` or \`..\` part, or it has no copies).
- A final \`.md\` dropped, split on \`/\`, each segment encoded (below). A box-relative path or a name whose
  first segment starts with \`_\` has that \`_\` written \`%5F\`.

**Time:** UTC, ISO 8601 with \`:\` written \`-\` and milliseconds: \`2026-11-20T11-51-46.512Z\`, always 24 characters.
- A reply's copy: the reply's \`message.timestamp\` in the omp session file.
- A memo's copy: when the copier saw the embed line first, at the end of the writer's run.

**Part:** a line range \`L<from>-<to>\` (\`#L7\` is \`L7-7\`, \`#l10-42\` is \`L10-42\`); a heading trimmed and lower-cased
with Unicode's default, locale-independent mapping (JavaScript \`toLowerCase()\`). No part: the whole file.

**Tag** (memos only): the embedding file's box path without \`.md\`, one chunk (\`/\` encoded). \` @<tag>\` is the
memo's own embed; \` @@<tag>\` is an embed inside that memo's copy of another file.

**Encoding:** UTF-8 bytes as \`%\` and two uppercase hex digits for \`% / \\ : * ? " < > | # @ ~\` and control
characters, a leading \`.\`, a trailing \`.\` or space. A folder segment over 200 bytes (encoded) is cut to at most
180 bytes, never inside a \`%XX\` or a character, then \`~\` and the first 16 lower-case hex digits of the SHA-256
of the whole encoded segment. A part or tag over 100 bytes is cut the same way to 80. \`~\` only ever marks a cut.

Readers build a name from a link and a time and look it up; never parse a name back.

## What a copy holds

- whole file: the text without front matter and leading blank lines;
- a heading: the lines under it, up to the next heading of its level or higher, fences respected (the desk's
  \`section\` rule);
- a line range: those lines.

Trailing blank lines trimmed, \`\\n\` line ends, one final \`\\n\`. Embeds inside a copied part are copied too, one
level (the second level of what md-embed draws), with the same time.

**Comparing** a copy with today's text: cut today's file the same way, drop front matter, \`\\r\\n\` to \`\\n\`, trim
blank lines at both ends.

## Lookup

- **A reply's embed:** \`<folder>/<the reply's message.timestamp>[ #<part>].md\`, by exact name.
- **A \`/prose\` copy of a reply:** an assistant entry whose \`message.timestamp\` is earlier than the last
  \`reset_boundary\` before it, or whose \`usage\` is all zeros. Never looked up by its own time. Match each embed
  (not the entry) to the same link and part in the original replies above the boundary, in order, and use that
  reply's time. Original not in the same file: no copy. Never fall back to the nearest earlier copy.
- **A memo's embed:** the oldest file in the folder whose name after the time is exactly \` #<part> @<tag>.md\`
  (or \` @<tag>.md\` for a whole file).
- **An embed inside a copy:** the same time as the copy it sits in; inside a memo's copy, \` @@<tag>\` with that
  copy's tag, by exact name.
- **Never copied:** files under \`captures/\` (they never change), pictures, pages, models: shown as they are, unmarked.
- **No copy otherwise:** the file as it is now, marked "may have changed".

\`errors.log\` holds one line per copy that failed: time, session id, link, message.
`;
