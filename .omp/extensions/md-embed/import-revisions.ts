#!/usr/bin/env bun
// The revisions import, also the repair tool. It rebuilds, from omp's session transcripts, the copies the live copier
// (`revisions.ts`) takes into one box's `.revisions/`: what each embed showed when it was written. The plan and the
// rules: the slip box memo `2026-11-22-revisions-copying-proposal`, section "The import, also the repair tool".
//
//   bun import-revisions.ts [--dry-run] [--box <path>] [--copy <path>] [--sessions <dir>...] [--until <iso>]
//
// - `--dry-run` writes nothing and prints what it would write, skips by reason, joined moves and checks.
// - `--box` names the box to rebuild, by its folder; default the one box in the slip box desk's settings (with
//   several listed, `--box` is required). Bare names resolve in that box only; embeds of files in another listed box
//   are skipped. Embeds of files in no box are copied into this box.
// - `--copy` is a copy of that box: today's files are read from it and copies are written into it, while
//   transcripts' paths into the box are read as paths into the copy (for trying it on a copy).
// - `--sessions` replaces the session roots (default `~/.omp/agent/sessions` and `~/.omp/profiles/*/agent/sessions`).
// - `--until` ignores entries stamped after that time (to check against an earlier research window).
//
// Idempotent: a reply's copy is written only when its name doesn't exist; a memo embed's copy only when its folder
// holds no copy tagged with that file and part taken at or before the embed's time (the end of the run that wrote the
// line). So it can run again at any time, and that is how it repairs what the live copier missed (a killed run, a
// profile without md-embed, `--no-extensions`): run it after the merge, and again once every omp started before the
// merge has exited.
import type { Dirent } from "node:fs";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import { MARKDOWN, boxOf, boxes, boxFiles, isBoxName } from "./md-embed.ts";
import {
	STORE,
	copyText,
	embedKey,
	embedsIn,
	nameSuffix,
	partKey,
	revisionFolder,
	tagOf,
	timeName,
	writeCopy,
} from "./revisions.ts";

/** Transcripts modified, and entries stamped, before this are not used: the box began on 2026-11-18. */
const SINCE = Date.parse("2026-11-18T00:00:00+02:00");
const MAX_BYTES = 2 * 1024 * 1024;
const TIME_LENGTH = 24;
const JOURNAL_WINDOW = 3000;
const TRIGGER = { folder: "2026-11-19-space-naming-prompt", part: "your picks" };

// ---------------------------------------------------------------------------------------------------------------
// Arguments

const USAGE = "usage: bun import-revisions.ts [--dry-run] [--box <path>] [--copy <path>] [--sessions <dir>...] [--until <iso>]";

function fail(message: string): never {
	console.error(`${message}\n${USAGE}`);
	process.exit(2);
}

function parseArgs(argv: string[]) {
	let dryRun = false;
	let box: string | undefined;
	let copy: string | undefined;
	let until = Number.POSITIVE_INFINITY;
	const sessions: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		if (arg === "--dry-run") dryRun = true;
		else if (arg === "--box" && argv[i + 1]) box = resolve(argv[++i]!.replace(/^~(?=$|\/)/, homedir()));
		else if (arg === "--copy" && argv[i + 1]) copy = resolve(argv[++i]!.replace(/^~(?=$|\/)/, homedir()));
		else if (arg === "--until" && argv[i + 1]) {
			until = Date.parse(argv[++i]!);
			if (Number.isNaN(until)) fail(`--until: not a time: ${argv[i]}`);
		} else if (arg === "--sessions") {
			while (argv[i + 1] && !argv[i + 1]!.startsWith("--")) sessions.push(resolve(argv[++i]!));
		} else fail(`unknown argument: ${arg}`);
	}
	if (!sessions.length) {
		sessions.push(join(homedir(), ".omp", "agent", "sessions"));
		try {
			for (const profile of readdirSync(join(homedir(), ".omp", "profiles"))) {
				sessions.push(join(homedir(), ".omp", "profiles", profile, "agent", "sessions"));
			}
		} catch { }
	}
	return { dryRun, box, copy, until, sessions };
}

const args = parseArgs(process.argv.slice(2));
const listed = boxes();
if (!args.box && listed.length > 1) fail(`several boxes in the desk's settings, pass --box: ${listed.join(", ")}`);
/** The box as transcripts and links name it. */
const BOX = args.box ?? listed[0];
/** The box on disk: read for today's files, written for the store. */
const DISK_BOX = args.copy ?? BOX;
if (!BOX || !DISK_BOX) fail("no box: list one in ~/.config/slipbox-desk/settings.json or pass --box");

function inside(folder: string, path: string): boolean {
	const rel = relative(folder, path);
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** Where a path named in a transcript lives on disk: under `--copy` when it names a file in the box. */
function disk(path: string): string {
	return BOX !== DISK_BOX && inside(BOX!, path) ? join(DISK_BOX!, relative(BOX!, path)) : path;
}

/** A box path md-embed's box lookup can see: no dot-folder or `node_modules` on the way. */
function boxVisible(path: string): boolean {
	if (!inside(BOX!, path)) return false;
	const folders = relative(BOX!, path).split(sep).slice(0, -1);
	return folders.every(name => !name.startsWith(".") && name !== "node_modules");
}

function statFile(path: string) {
	try {
		const stat = statSync(disk(path));
		return stat.isFile() ? stat : undefined;
	} catch {
		return undefined;
	}
}

// ---------------------------------------------------------------------------------------------------------------
// Reading transcripts

async function* linesOf(path: string): AsyncGenerator<string> {
	const decoder = new TextDecoder();
	let rest = "";
	for await (const chunk of Bun.file(path).stream()) {
		rest += decoder.decode(chunk, { stream: true });
		let start = 0;
		for (let end = rest.indexOf("\n"); end >= 0; end = rest.indexOf("\n", start)) {
			yield rest.slice(start, end);
			start = end + 1;
		}
		rest = rest.slice(start);
	}
	rest += decoder.decode();
	if (rest) yield rest;
}

/** `.jsonl` files under `roots` modified since SINCE, with `name` as their file name when given. */
function filesUnder(roots: string[], name?: string): string[] {
	const out: string[] = [];
	const pending = [...roots];
	for (let folder = pending.pop(); folder !== undefined; folder = pending.pop()) {
		let entries: Dirent[];
		try {
			entries = readdirSync(folder, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const full = join(folder, entry.name);
			if (entry.isDirectory()) pending.push(full);
			else if (entry.isFile() && (name ? entry.name === name : entry.name.endsWith(".jsonl"))) {
				try {
					if (statSync(full).mtimeMs >= SINCE) out.push(full);
				} catch { }
			}
		}
	}
	return out.sort();
}

type Kind = "write" | "edit" | "gone" | "unknown";

/** One file's change by one tool result. */
interface Change {
	path: string;
	time: number;
	seq: number;
	id: string;
	tool: string;
	kind: Kind;
	/** A write's content, an edit's `newText`. */
	text?: string;
	oldText?: string;
	diff?: string;
	/** An edit that moved the file: the path it came from. */
	from?: string;
	/** The version's text once histories are built: null when gone, undefined when unknown. */
	resolved?: string | null;
}

interface ToolRecord {
	owner: string; // the transcript with the earliest `session` header that holds it
	headerMs: number;
	runEnd?: number;
	changes: Change[];
}

interface Reply {
	file: string;
	headerMs: number;
	entryId: string;
	entryMs: number;
	messageTs: number;
	raws: string[];
	boundaryCopy: boolean;
	zeroUsage: boolean;
}

// biome-ignore lint/suspicious/noExplicitAny: transcript entries are untyped JSON
type Json = any;

const interesting = (path: string) => MARKDOWN.test(path) || inside(BOX!, path);

let seq = 0;
const notes = { writeWithoutContent: 0, transcripts: 0, astEditMd: 0 };

/** The file changes one successful `write`, `edit` or `ast_edit` result names. */
function changesOf(message: Json, call: Json, cwd: string, time: number): Change[] {
	const details = message.details;
	// Internal URLs (`xd://…`, `local://…`) are no files.
	const abs = (path: unknown) =>
		typeof path === "string" && path && !/^[a-z][\w+.-]*:/i.test(path) ? normalize(resolve(cwd, path)) : undefined;
	const out: Change[] = [];
	const add = (change: Omit<Change, "seq" | "time" | "id" | "tool">) => {
		if (interesting(change.path)) out.push({ ...change, seq: seq++, time, id: message.toolCallId, tool: message.toolName });
	};
	if (message.toolName === "write") {
		if (!details || details.touchesNoFiles) return out;
		const path = abs(details.resolvedPath) ?? abs(call?.arguments?.path);
		if (!path) return out;
		const content = call?.arguments?.content;
		if (typeof content === "string") add({ path, kind: "write", text: content });
		else {
			if (interesting(path)) notes.writeWithoutContent++;
			add({ path, kind: "unknown" });
		}
	} else if (message.toolName === "edit") {
		const items: Json[] = Array.isArray(details?.perFileResults) ? details.perFileResults : details ? [details] : [];
		const named = new Set<string>();
		for (const item of items) {
			const path = abs(item.path);
			if (!path) continue;
			named.add(path);
			const from = abs(item.sourcePath);
			if (from && from !== path) add({ path: from, kind: "gone" });
			const oldText = typeof item.oldText === "string" ? item.oldText : undefined;
			const diff = typeof item.diff === "string" ? item.diff : undefined;
			if (item.op === "delete") add({ path, kind: "gone", oldText });
			else if (typeof item.newText === "string") add({ path, kind: "edit", text: item.newText, oldText, diff, from });
			else if (diff !== undefined) add({ path, kind: "edit", diff, from });
			else add({ path, kind: "unknown" });
		}
		const text = Array.isArray(message.content) ? message.content.map((block: Json) => block.text ?? "").join("\n") : "";
		for (const match of text.matchAll(/^Deleted (.+)$/gm)) {
			const path = abs(match[1]!.trim());
			if (path && !named.has(path)) add({ path, kind: "gone" });
		}
	} else if (message.toolName === "ast_edit") {
		const items: Json[] = Array.isArray(details?.fileReplacements) ? details.fileReplacements : [];
		for (const item of items) {
			const path = abs(item.path);
			if (!path || !(item.count > 0)) continue;
			if (MARKDOWN.test(path)) notes.astEditMd++;
			add({ path, kind: "unknown" });
		}
	}
	return out;
}

async function readTranscripts(files: string[], until: number) {
	const results = new Map<string, ToolRecord>();
	const replies = new Map<number, Reply>();
	const disagreements = new Map<string, Reply>();
	for (const file of files) {
		let headerMs: number | undefined;
		let cwd = homedir();
		let lineNo = 0;
		const calls = new Map<string, Json>(); // this file's write calls, by id
		let pending: string[] = []; // tool results of the current run
		let lastActivity = 0;
		let lastBoundary = Number.NEGATIVE_INFINITY;
		const closeRun = () => {
			for (const id of pending) {
				const record = results.get(id)!;
				if (record.owner === file && record.runEnd === undefined) record.runEnd = lastActivity;
			}
			pending = [];
		};
		for await (const line of linesOf(file)) {
			lineNo++;
			if (headerMs === undefined) {
				if (lineNo > 3) break; // not a transcript: no `session` entry among the first three lines
				try {
					const entry = JSON.parse(line);
					if (entry.type === "session") {
						headerMs = Date.parse(entry.timestamp);
						if (typeof entry.cwd === "string") cwd = entry.cwd;
						notes.transcripts++;
					}
				} catch { }
				continue;
			}
			if (!line) continue;
			let entry: Json;
			try {
				entry = JSON.parse(line);
			} catch {
				continue;
			}
			const ms = Date.parse(entry.timestamp);
			if (ms > until) break;
			if (entry.type === "reset_boundary") {
				closeRun();
				lastBoundary = ms;
				continue;
			}
			if (entry.type !== "message") continue;
			const message = entry.message;
			if (message?.role === "user") {
				if (!message.synthetic) closeRun();
				continue;
			}
			if (message?.role === "assistant") {
				lastActivity = ms;
				const content: Json[] = Array.isArray(message.content) ? message.content : [];
				for (const block of content) if (block.type === "toolCall" && block.name === "write") calls.set(block.id, block);
				if (ms < SINCE || typeof message.timestamp !== "number") continue;
				const raws = embedsIn(content.flatMap(block => (block.type === "text" ? [block.text] : [])).join("\n"));
				if (!raws.length) continue;
				const usage = message.usage ?? {};
				const reply: Reply = {
					file,
					headerMs,
					entryId: entry.id,
					entryMs: ms,
					messageTs: message.timestamp,
					raws,
					boundaryCopy: message.timestamp < lastBoundary,
					zeroUsage: !(usage.input || usage.output || usage.cacheRead || usage.cacheWrite),
				};
				const known = replies.get(reply.messageTs);
				if (!known || headerMs < known.headerMs) replies.set(reply.messageTs, reply);
				const key = `${reply.entryId}@${reply.messageTs}`;
				if (reply.boundaryCopy !== reply.zeroUsage && !disagreements.has(key)) disagreements.set(key, reply);
				continue;
			}
			if (message?.role !== "toolResult") continue;
			lastActivity = ms;
			if (ms < SINCE || message.isError || !["write", "edit", "ast_edit"].includes(message.toolName)) continue;
			const id: string = message.toolCallId;
			const record = results.get(id);
			if (record) {
				if (headerMs < record.headerMs) Object.assign(record, { owner: file, headerMs, runEnd: undefined });
			} else {
				const changes = changesOf(message, calls.get(id), cwd, ms);
				if (!changes.length) continue;
				results.set(id, { owner: file, headerMs, changes });
			}
			pending.push(id);
		}
		closeRun();
	}
	return { results, replies, disagreements };
}

// ---------------------------------------------------------------------------------------------------------------
// Text helpers

/** The lines md-embed reads from a file's text. */
function linesFrom(text: string): string[] {
	return text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
}

/** Where the body starts: after the front matter. */
function bodyStart(lines: string[]): number {
	if (lines[0] !== "---") return 0;
	const end = lines.indexOf("---", 1);
	return end > 0 ? end + 1 : 0;
}

/** Where a trailing `## Answers` section starts (the desk's), or the line count. */
function answersStart(lines: string[]): number {
	let fence = "";
	let answers = lines.length;
	for (let i = 0; i < lines.length; i++) {
		const marker = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]!)?.[1];
		if (marker) {
			if (!fence) fence = marker;
			else if (marker[0] === fence[0] && marker.length >= fence.length) fence = "";
			continue;
		}
		if (fence) continue;
		if (/^##[ \t]+Answers[ \t]*$/.test(lines[i]!)) answers = i;
		else if (answers < lines.length && /^#{1,2}[ \t]/.test(lines[i]!)) answers = lines.length;
	}
	return answers;
}

/** A file's text as versions are compared: no front matter, no trailing `## Answers`, blank lines trimmed at both ends. */
function comparable(text: string): string {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	const body = lines.slice(bodyStart(lines), answersStart(lines));
	let start = 0;
	let end = body.length;
	while (start < end && body[start]!.trim() === "") start++;
	while (end > start && body[end - 1]!.trim() === "") end--;
	return body.slice(start, end).join("\n");
}

interface Row {
	sign: "+" | "-" | " ";
	line: number;
	text: string;
}

/** omp's numbered diff: `-N|`, ` N|` in old line numbers, `+N|` in new ones; empty rows mark gaps. */
function diffRows(diff: string): Row[] | undefined {
	const rows: Row[] = [];
	for (const row of diff.split("\n")) {
		if (row === "") continue;
		const found = /^([ +-])(\d+)\|([\s\S]*)$/.exec(row);
		if (!found) return undefined;
		rows.push({ sign: found[1] as Row["sign"], line: Number(found[2]), text: found[3]! });
	}
	return rows;
}

/** A pruned edit's new text: its diff applied to the version before. Undefined when they don't fit. */
function applyDiff(base: string, diff: string): string | undefined {
	const rows = diffRows(diff);
	if (!rows) return undefined;
	const old = base.split("\n");
	const out: string[] = [];
	let at = 0;
	for (const row of rows) {
		if (row.sign === "+") {
			while (out.length < row.line - 1 && at < old.length) out.push(old[at++]!);
			out.push(row.text);
			continue;
		}
		const index = row.line - 1;
		if (index < at) {
			if (row.sign === "-" || old[index] !== row.text) return undefined;
			continue;
		}
		while (at < index && at < old.length) out.push(old[at++]!);
		if (at !== index || old[at] !== row.text) return undefined;
		if (row.sign === " ") out.push(old[at]!);
		at++;
	}
	while (at < old.length) out.push(old[at++]!);
	return out.join("\n");
}

/**
 * Whether every context and `-` row of a pruned edit's diff matches `text`, leaving out the front matter and a
 * trailing `## Answers`: the diff numbers lines of the file as it was then, which may carry the desk's fields.
 */
function diffFits(text: string, diff: string): boolean {
	const rows = diffRows(diff)?.filter(row => row.sign !== "+");
	if (!rows) return false;
	const lines = text.split("\n");
	const start = bodyStart(lines);
	const answers = answersStart(lines);
	const answersRow = rows.findIndex(row => /^##[ \t]+Answers[ \t]*$/.test(row.text));
	const fits = (shift: number) =>
		rows.every((row, i) => {
			const index = row.line - 1 - shift;
			if (index < start || (index >= answers && index < lines.length)) return true;
			if (index >= lines.length) return answersRow >= 0 && i >= answersRow;
			return lines[index] === row.text;
		});
	return SHIFTS.some(fits);
}

/** Line shifts tried between a version and the file a diff numbers, nearest first. */
const SHIFTS = [0, ...Array.from({ length: 60 }, (_, i) => [i + 1, -(i + 1)]).flat()];

/**
 * A pruned edit's diff applied to a version the desk changed since, by front matter fields or a trailing
 * `## Answers` (a Send's answers, the agent then works out of the memo). The diff numbers the file with those lines.
 * The version's body must match the diff's rows at one shift; the file the diff numbers is rebuilt from the body,
 * the diff's own rows for the front matter and the tail, and the version's other front matter lines, and the diff is
 * applied to that. Undefined when no shift fits.
 */
function applyAcrossDesk(base: string, diff: string): string | undefined {
	const rows = diffRows(diff);
	if (!rows) return undefined;
	const lines = base.split("\n");
	const start = bodyStart(lines);
	const body = lines.slice(start, answersStart(lines));
	const old = rows.filter(row => row.sign !== "+");
	const known = new Map(old.map(row => [row.line - 1, row.text]));
	for (const shift of SHIFTS) {
		const bodyFrom = start + shift;
		const bodyEnd = bodyFrom + body.length;
		if (bodyFrom < 0) continue;
		const inBody = old.filter(row => row.line - 1 >= bodyFrom && row.line - 1 < bodyEnd);
		if (!inBody.length || inBody.some(row => body[row.line - 1 - bodyFrom] !== row.text)) continue;
		// Front matter: the diff's rows where it has them, the version's other lines in order, its `---` last.
		const pool = lines.slice(0, start);
		for (const [index, text] of known) {
			if (index >= bodyFrom) continue;
			const at = pool.indexOf(text);
			if (at >= 0) pool.splice(at, 1);
		}
		const closing = pool.at(-1) === "---" && !known.has(bodyFrom - 1) ? pool.pop() : undefined;
		const front = Array.from({ length: bodyFrom }, (_, i) =>
			known.get(i) ?? (i === bodyFrom - 1 && closing !== undefined ? closing : (pool.shift() ?? "")),
		);
		// Tail: the rows past the body, ending as the version ends.
		const last = Math.max(bodyEnd, ...old.map(row => row.line));
		const tail = Array.from({ length: last - bodyEnd }, (_, i) => known.get(bodyEnd + i) ?? "");
		if (tail.length && lines.at(-1) === "") tail.push("");
		const result = applyDiff([...front, ...body, ...tail].join("\n"), diff);
		if (result !== undefined) return result;
	}
	return undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Histories

interface Version {
	time: number;
	id: string;
	kind: Kind;
	text: string | null | undefined; // null: gone; undefined: unknown
	/** The text before this version, for finding new embed lines: undefined when unknown. */
	before: string | undefined;
	oldText?: string;
	diff?: string;
}

interface Histories {
	/** Every change, in time order. */
	all: Change[];
	/** Changes by the path the tool named. */
	own: Map<string, Change[]>;
	/** Box paths md-embed could see, by file name. */
	byName: Map<string, string[]>;
	/** The path a moved slip's history is kept under. */
	canon: (path: string) => string;
	moves: string[];
	/** Versions by canonical path, in time order. */
	versions: Map<string, Version[]>;
	diffCheck: { fits: number; misfits: string[]; pruned: number; acrossDesk: number; unbuilt: string[] };
}

function buildHistories(results: Map<string, ToolRecord>): Histories {
	const all = [...results.values()].flatMap(record => record.changes).sort((a, b) => a.time - b.time || a.seq - b.seq);
	const own = new Map<string, Change[]>();
	for (const change of all) {
		const list = own.get(change.path);
		if (list) list.push(change);
		else own.set(change.path, [change]);
	}

	// Box paths md-embed could see, by file name: written by an agent, or present today.
	const byName = new Map<string, string[]>();
	const addName = (path: string) => {
		const list = byName.get(basename(path));
		if (!list) byName.set(basename(path), [path]);
		else if (!list.includes(path)) list.push(path);
	};
	for (const path of own.keys()) if (boxVisible(path)) addName(path);
	for (const paths of boxFiles(DISK_BOX!).values()) for (const path of paths) addName(join(BOX!, relative(DISK_BOX!, path)));

	// Moves: a slip gone today joins the one other slip path with its file name.
	const joined = new Map<string, string>();
	const moves: string[] = [];
	for (const [name, paths] of byName) {
		// Only slips join: their names carry a date and are never reused.
		if (!MARKDOWN.test(name) || !/^\d{4}-\d{2}-\d{2}-/.test(name) || paths.length !== 2) continue;
		for (const [gone, other] of [paths, [...paths].reverse()] as [string, string][]) {
			if (statFile(gone) || joined.has(other) || joined.has(gone)) continue;
			const goneChanges = own.get(gone);
			if (!goneChanges) continue;
			const firstOther = own.get(other)?.[0]?.time;
			if (firstOther !== undefined && goneChanges.at(-1)!.time > firstOther) continue;
			joined.set(gone, other);
			moves.push(`${relative(BOX!, gone)} -> ${relative(BOX!, other)}`);
		}
	}
	const canon = (path: string) => joined.get(path) ?? path;

	// Versions, in time order, per canonical path.
	const versions = new Map<string, Version[]>();
	const current = new Map<string, string | null | undefined>();
	const diffCheck: Histories["diffCheck"] = { fits: 0, misfits: [], pruned: 0, acrossDesk: 0, unbuilt: [] };
	for (const change of all) {
		const path = canon(change.path);
		const seen = current.has(path);
		const prev = current.get(path);
		const base = change.from && change.from !== change.path ? current.get(canon(change.from)) : prev;
		let text: string | null | undefined;
		let before: string | undefined;
		if (change.kind === "write") {
			text = change.text!;
			before = !seen || prev === null ? "" : (prev ?? undefined);
		} else if (change.kind === "edit") {
			if (change.text !== undefined) {
				text = change.text;
				before = change.oldText ?? (typeof base === "string" ? base : undefined);
				if (change.oldText !== undefined && change.diff) {
					if (applyDiff(change.oldText, change.diff) === text) diffCheck.fits++;
					else diffCheck.misfits.push(`${change.path} ${new Date(change.time).toISOString()}`);
				}
			} else {
				const inBox = inside(BOX!, change.path);
				if (inBox) diffCheck.pruned++;
				before = typeof base === "string" ? base : undefined;
				text = before === undefined ? undefined : applyDiff(before, change.diff!);
				if (before !== undefined && text === undefined) {
					text = applyAcrossDesk(before, change.diff!);
					if (text !== undefined && inBox) diffCheck.acrossDesk++;
				}
				if (text === undefined && inBox) {
					diffCheck.unbuilt.push(`${relative(BOX!, change.path)} ${new Date(change.time).toISOString()}${before === undefined ? " (no version before)" : ""}`);
				}
			}
		} else if (change.kind === "gone") text = null;
		else text = undefined;
		change.resolved = text;
		current.set(path, text);
		const list = versions.get(path) ?? [];
		list.push({ time: change.time, id: change.id, kind: change.kind, text, before, oldText: change.oldText, diff: change.diff });
		versions.set(path, list);
	}
	return { all, own, byName, canon, moves, versions, diffCheck };
}

// ---------------------------------------------------------------------------------------------------------------
// What a link showed at a time

type Outcome = "confirmed" | "unverified" | "contradicted";

interface Resolver {
	/** The canonical file a link names at a time, or why it names none. */
	resolveAt(raw: string, time: number): { path: string; fragment?: string } | { skip: string };
	/** The text a file had at a time, and how sure that is. */
	textAt(path: string, time: number): { text: string; outcome: Outcome; reason?: string } | { skip: string };
}

const counts = new Map<string, number>();
const count = (key: string, by = 1) => counts.set(key, (counts.get(key) ?? 0) + by);

function makeResolver(h: Histories): Resolver {
	const confirmed = new Map<Version, { outcome: Outcome; reason?: string }>();

	/** A version checked against the next thing known about its file. */
	function check(path: string, index: number): { outcome: Outcome; reason?: string } {
		const list = h.versions.get(path)!;
		const version = list[index]!;
		const hit = confirmed.get(version);
		if (hit) return hit;
		const text = version.text!;
		const next = list[index + 1];
		let result: { outcome: Outcome; reason?: string };
		if (!next) {
			if (!statFile(path)) result = { outcome: "unverified", reason: "nothing after it, file gone today" };
			else {
				const today = readFileSync(disk(path), "utf8");
				result = { outcome: comparable(today) === comparable(text) ? "confirmed" : "contradicted" };
			}
		} else if (next.oldText !== undefined) {
			result = { outcome: comparable(next.oldText) === comparable(text) ? "confirmed" : "contradicted" };
		} else if (next.kind === "edit" && next.diff !== undefined) {
			result = { outcome: diffFits(text, next.diff) ? "confirmed" : "contradicted" };
		} else if (next.kind === "write") result = { outcome: "unverified", reason: "a write after it" };
		else if (next.kind === "gone") result = { outcome: "unverified", reason: "deleted after it" };
		else result = { outcome: "unverified", reason: "an unknown change after it" };
		confirmed.set(version, result);
		return result;
	}

	function versionIndexAt(path: string, time: number): number {
		const list = h.versions.get(path) ?? [];
		let found = -1;
		for (let i = 0; i < list.length && list[i]!.time <= time; i++) found = i;
		return found;
	}

	/** Whether md-embed would have found `path` in the box at `time`. */
	function existedAt(path: string, time: number): boolean {
		const target = h.canon(path);
		const own = h.own.get(path);
		const list = h.versions.get(target);
		if (own?.length) {
			if (own[0]!.time > time) return false;
		} else if (!list?.length) return true; // present today, never written by an agent
		const index = versionIndexAt(target, time);
		return index >= 0 && list![index]!.text !== null;
	}

	/** The canonical file a link names at `time`, or why it names none. */
	function resolveAt(raw: string, time: number): { path: string; fragment?: string } | { skip: string } {
		const ref = raw.split("|")[0]!;
		const hash = ref.indexOf("#");
		let path = (hash < 0 ? ref : ref.slice(0, hash)).trim();
		const fragment = hash < 0 ? undefined : ref.slice(hash + 1).trim() || undefined;
		if (isBoxName(path)) {
			const want = /\.[a-z\d]+$/i.test(path) ? path : `${path}.md`;
			const matches = new Set(
				(h.byName.get(basename(want)) ?? [])
					.filter(full => {
						const rel = relative(BOX!, full);
						return (rel === want || rel.endsWith(`/${want}`)) && existedAt(full, time);
					})
					.map(h.canon),
			);
			if (matches.size > 1) return { skip: "ambiguous" };
			if (matches.size === 1) return { path: [...matches][0]!, fragment };
			return { skip: "unresolved" };
		}
		if (path === "~" || path.startsWith("~/")) path = homedir() + path.slice(1);
		if (!isAbsolute(path)) return { skip: "unresolved" };
		path = h.canon(normalize(path));
		if (!h.versions.has(path) && !statFile(path)) return { skip: "unresolved" };
		return { path, fragment };
	}

	/** The text a file had at `time`, and how sure that is. */
	function textAt(path: string, time: number): { text: string; outcome: Outcome; reason?: string } | { skip: string } {
		const list = h.versions.get(path);
		if (!list?.length) {
			const stat = statFile(path);
			if (!stat) return { skip: "unresolved" };
			if (stat.size > MAX_BYTES) return { skip: "not text" };
			if (stat.mtimeMs > time) return { skip: "no version yet (never agent-written, modified after T)" };
			return { text: readFileSync(disk(path), "utf8"), outcome: "confirmed" };
		}
		const index = versionIndexAt(path, time);
		if (index < 0) return { skip: "no version yet" };
		const version = list[index]!;
		if (version.text === null) return { skip: "unresolved" };
		if (version.text === undefined) return { skip: "unknown version" };
		const checked = check(path, index);
		if (checked.outcome === "contradicted") return { skip: "contradicted" };
		if (Buffer.byteLength(version.text, "utf8") > MAX_BYTES) return { skip: "not text" };
		return { text: version.text, ...checked };
	}

	return { resolveAt, textAt };
}

// ---------------------------------------------------------------------------------------------------------------
// Writing copies

const planned = new Map<string, Set<string>>(); // dry run: store folder -> names it would write

function storeDir(folder: string): string {
	return join(DISK_BOX!, STORE, ...folder.split("/"));
}

function namesIn(folder: string): string[] {
	let names: string[] = [];
	try {
		names = readdirSync(storeDir(folder));
	} catch { }
	return [...names, ...(planned.get(folder) ?? [])];
}

/** Writes a copy unless its name exists: "new" or "exists". */
function put(folder: string, name: string, text: string): "new" | "exists" {
	if (args.dryRun) {
		if (planned.get(folder)?.has(name) || existsSync(join(storeDir(folder), name))) return "exists";
		const set = planned.get(folder) ?? new Set();
		set.add(name);
		planned.set(folder, set);
		return "new";
	}
	return writeCopy(DISK_BOX!, folder, name, text) ? "new" : "exists";
}

/** Whether the folder holds a copy tagged with this file and part, taken at or before `time`. */
function taggedBy(folder: string, part: string | undefined, tag: string, time: number): boolean {
	const suffix = nameSuffix(part, tag);
	const limit = timeName(time);
	return namesIn(folder).some(
		name => name.length > TIME_LENGTH && name.slice(TIME_LENGTH) === suffix && name.slice(0, TIME_LENGTH) <= limit,
	);
}

interface Copied {
	path: string;
	text: string;
	outcome: "new" | "exists";
	folder: string;
	name: string;
}

/** Embeds that got a copy in a memo's name, or got none for a reason worth reading one by one. */
const details: string[] = [];

function makeCopier(resolver: Resolver) {
	/** One embed's copy at `time`, named with `nameTime`, or why it gets none (counted by kind and reason). */
	return function copyEmbed(
		kind: string,
		raw: string,
		time: number,
		nameTime: number,
		opts: { tag?: string; nested?: boolean; stack?: string[] } = {},
	): Copied | { skip: string } {
		const skip = (reason: string) => {
			count(`skip\t${kind}\t${reason}`);
			// `embedsIn` hands over links with inline code masked (NUL, index, NUL), as md-embed resolves them.
			const shown = raw.replace(/\u0000\d+\u0000/g, "`…`");
			if (reason !== "not text" && reason !== "capture") details.push(`${reason}: ${kind} ${new Date(time).toISOString()} ![[${shown}]]`);
			return { skip: reason };
		};
		const folder = revisionFolder(raw, BOX!);
		if (!folder) return skip("unresolved");
		const target = resolver.resolveAt(raw, time);
		if ("skip" in target) return skip(target.skip);
		if (!MARKDOWN.test(target.path)) return skip("not text");
		const own = boxOf(target.path);
		if (own && own !== BOX) return skip("in another box");
		if (opts.stack?.includes(target.path)) return skip("embeds itself");
		if (inside(join(BOX!, "captures"), target.path)) return skip("capture");
		const found = resolver.textAt(target.path, time);
		if ("skip" in found) return skip(found.skip);
		const text = copyText(linesFrom(found.text), target.fragment);
		if (text === undefined) return skip("part names nothing");
		const name = `${timeName(nameTime)}${nameSuffix(partKey(target.fragment), opts.tag, opts.nested)}`;
		const outcome = put(folder, name, text);
		count(`copy\t${kind}\t${outcome}`);
		if (kind.startsWith("memo")) details.push(`${outcome === "new" ? "memo copy" : "memo copy exists"}: ${folder}/${name}`);
		if (found.outcome === "unverified" && outcome === "new") count(`unverified\t${found.reason}`);
		return { path: target.path, text, outcome, folder, name };
	};
}

// ---------------------------------------------------------------------------------------------------------------
// The change-journal check

/**
 * Box changes against omp's change journals (`changes.jsonl` beside each root session, gzip blobs in `blobs/`):
 * how many have a record of the same path within 3 s, and how many equal its stored text. Records in the newer
 * shape (omp 19.1, `base` + `edit`) hold line operations instead of whole texts and are only counted.
 */
async function journalCheck(h: Histories, roots: string[], until: number) {
	const records = new Map<string, { at: number; after?: string; dir: string }[]>();
	for (const file of filesUnder(roots, "changes.jsonl")) {
		const dir = file.slice(0, -"changes.jsonl".length);
		for await (const line of linesOf(file)) {
			if (!line.includes('"type":"change"')) continue;
			let record: Json;
			try {
				record = JSON.parse(line);
			} catch {
				continue;
			}
			if (typeof record.path !== "string" || !inside(BOX!, record.path) || record.at > until || record.at < SINCE) continue;
			const list = records.get(record.path) ?? [];
			list.push({ at: record.at, after: typeof record.after === "string" ? record.after : undefined, dir });
			records.set(record.path, list);
		}
	}
	const boxChanges = h.all.filter(change => change.tool !== "ast_edit" && inside(BOX!, change.path));
	let withRecord = 0;
	let equal = 0;
	let newShapeOnly = 0;
	const differences: string[] = [];
	for (const change of boxChanges) {
		const near = (records.get(change.path) ?? []).filter(record => Math.abs(record.at - change.time) <= JOURNAL_WINDOW);
		const old = near.filter(record => record.after !== undefined);
		if (near.length) withRecord++;
		if (near.length && !old.length) {
			newShapeOnly++;
			continue;
		}
		const text = typeof change.resolved === "string" ? Buffer.from(change.resolved, "utf8") : undefined;
		const same =
			text &&
			old.some(record => {
				try {
					return gunzipSync(readFileSync(join(record.dir, "blobs", record.after!))).equals(text);
				} catch {
					return false;
				}
			});
		if (same) equal++;
		else {
			const why = !near.length ? "no journal record" : text ? "blob differs" : change.resolved === null ? "gone" : "text unknown";
			differences.push(`${new Date(change.time).toISOString()} ${change.kind} ${relative(BOX!, change.path)}: ${why}`);
		}
	}
	return { boxChanges: boxChanges.length, withRecord, equal, newShapeOnly, differences };
}

// ---------------------------------------------------------------------------------------------------------------
// The run

const started = Date.now();
const transcripts = filesUnder(args.sessions);
const { results, replies, disagreements } = await readTranscripts(transcripts, args.until);
const h = buildHistories(results);
const resolver = makeResolver(h);
const copyEmbed = makeCopier(resolver);
const trigger: string[] = [];

// Replies: originals only, by `message.timestamp`, resolved at the entry's own time.
for (const reply of [...replies.values()].sort((a, b) => a.messageTs - b.messageTs)) {
	if (reply.boundaryCopy) {
		count(`skip\treply\t/prose copy`, reply.raws.length);
		continue;
	}
	for (const raw of reply.raws) {
		const top = copyEmbed("reply", raw, reply.entryMs, reply.messageTs);
		const folder = revisionFolder(raw, BOX!);
		const fragment = raw.split("|")[0]!.split("#").slice(1).join("#");
		if (folder === TRIGGER.folder && partKey(fragment) === TRIGGER.part) {
			const head = "skip" in top ? `no copy: ${top.skip}` : `${top.outcome === "new" ? "copy" : "exists"}: ${top.name}`;
			trigger.push(`  reply ${new Date(reply.messageTs).toISOString()} (saved ${new Date(reply.entryMs).toISOString()}) ${head}`);
			if (!("skip" in top)) {
				for (const line of top.text.split("\n").filter(line => line.trim()).slice(0, 4)) trigger.push(`      | ${line}`);
			}
		}
		if ("skip" in top) continue;
		for (const inner of embedsIn(top.text)) copyEmbed("reply nested", inner, reply.entryMs, reply.messageTs, { stack: [top.path] });
	}
}

// Memos: embed lines a version holds and the text before it doesn't, copied at the end of the writer's run.
for (const [path, list] of h.versions) {
	if (!boxVisible(path) || !MARKDOWN.test(path)) continue;
	const tag = tagOf(path, BOX!);
	const seen = new Set<string>();
	const keysOf = (text: string) => {
		const keys = new Map<string, string>();
		for (const raw of embedsIn(text)) {
			const key = embedKey(raw, BOX!);
			if (key && !keys.has(key)) keys.set(key, raw);
		}
		return keys;
	};
	for (const version of list) {
		if (typeof version.text !== "string") continue;
		const keys = keysOf(version.text);
		const before = version.before === undefined ? undefined : keysOf(version.before);
		for (const [key, raw] of keys) {
			if (before?.has(key)) continue;
			if (!before) {
				if (!seen.has(key)) count("skip\tmemo\tunknown version (text before unknown)");
				continue;
			}
			const time = results.get(version.id)?.runEnd ?? version.time;
			const [folder, part] = key.split("\u0000") as [string, string];
			if (taggedBy(folder, part || undefined, tag, time)) {
				count("skip\tmemo\ttagged copy at or before T");
				continue;
			}
			const top = copyEmbed("memo", raw, time, time, { tag });
			if ("skip" in top) continue;
			for (const inner of embedsIn(top.text)) copyEmbed("memo nested", inner, time, time, { tag, nested: true, stack: [top.path] });
		}
		for (const key of keys.keys()) seen.add(key);
	}
}

const journal = await journalCheck(h, args.sessions, args.until);

// ---------------------------------------------------------------------------------------------------------------
// Output

const section = (title: string, prefix: string) => {
	const rows = [...counts].filter(([key]) => key.startsWith(`${prefix}\t`)).sort(([a], [b]) => a.localeCompare(b));
	console.log(`\n${title}`);
	if (!rows.length) console.log("  none");
	for (const [key, n] of rows) console.log(`  ${String(n).padStart(5)}  ${key.slice(prefix.length + 1).replace(/\t/g, ": ")}`);
};

const iso = (ms: number) => new Date(ms).toISOString();
console.log(`revisions import${args.dryRun ? " (dry run: nothing written)" : ""}`);
console.log(`  box ${BOX}${DISK_BOX !== BOX ? `, written into ${DISK_BOX}` : ""}`);
console.log(`  ${notes.transcripts} transcripts of ${transcripts.length} .jsonl files, entries ${iso(SINCE)} to ${Number.isFinite(args.until) ? iso(args.until) : "now"}`);
console.log(`  ${results.size} tool results, ${h.all.length} file changes on ${h.versions.size} paths; ${replies.size} reply stamps with embeds`);
section(args.dryRun ? "Copies it would write (new) or finds (exists), by kind" : "Copies written (new) or found (exists), by kind", "copy");
section("Skips, by kind and reason", "skip");
section("Copies from unverified versions, by reason", "unverified");
console.log(`\nMoves joined (${h.moves.length})`);
for (const move of h.moves) console.log(`  ${move}`);
console.log(`\n/prose tests disagree (${disagreements.size}): message.timestamp before the last reset_boundary vs usage all zeros`);
for (const reply of disagreements.values()) {
	console.log(
		`  ${iso(reply.messageTs)} entry ${reply.entryId} ${iso(reply.entryMs)} boundary:${reply.boundaryCopy ? "copy" : "original"} usage:${reply.zeroUsage ? "zero" : "spent"}  ${relative(homedir(), reply.file)}`,
	);
}
console.log(`\nTrigger case ${TRIGGER.folder}#Your picks`);
console.log(trigger.length ? trigger.join("\n") : "  not found");
console.log("\nChecks");
console.log(`  edit diffs that rebuild newText from oldText: ${h.diffCheck.fits} of ${h.diffCheck.fits + h.diffCheck.misfits.length}`);
for (const misfit of h.diffCheck.misfits) console.log(`    misfit: ${misfit}`);
console.log(
	`  box edits with pruned snapshots: ${h.diffCheck.pruned}; rebuilt across the desk's front matter or answers: ${h.diffCheck.acrossDesk}; not rebuilt: ${h.diffCheck.unbuilt.length}`,
);
for (const unbuilt of h.diffCheck.unbuilt) console.log(`    not rebuilt: ${unbuilt}`);
console.log(`  writes without their call's content: ${notes.writeWithoutContent}; ast_edit changes on Markdown: ${notes.astEditMd}`);
console.log(
	`  box changes (write and edit): ${journal.boxChanges}; with a change-journal record within 3 s: ${journal.withRecord}; equal to its blob: ${journal.equal}; only new-shape records (not compared): ${journal.newShapeOnly}`,
);
for (const difference of journal.differences) console.log(`    ${difference}`);
console.log(`\nIn detail (${details.length})`);
for (const line of details.sort()) console.log(`  ${line}`);
console.log(`\n${((Date.now() - started) / 1000).toFixed(1)} s`);
