import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_BOOKMARK_FILE = "default.md";
const NILO_WIKI_SEGMENTS = ["workspace", "nilo-wayfinder", "wiki"] as const;
const MODEL_ROLE = "@tiny";
const THINKING_LEVEL = "medium";
const EXT_DIR = new URL(".", import.meta.url).pathname;
const MAX_MESSAGE_CHARS = 20_000;
const MAX_TRANSCRIPT_CHARS = 160_000;

export interface BookmarkSummary {
	overall: string;
	latest: string;
	parked: string[];
}

export interface BookmarkRecord {
	sessionId: string;
	sessionFile: string;
	title: string;
	recordedAt: Date;
	summary?: BookmarkSummary;
}

export type BookmarkSummarizer = (
	transcript: string,
	ctx: ExtensionContext,
) => Promise<BookmarkSummary>;

interface BookmarkExtensionDependencies {
	wikiRoot?: string;
	homeDirectory?: string;
	defaultFilename?: string;
	summarize?: BookmarkSummarizer;
}

interface MessageView {
	role?: unknown;
	content?: unknown;
}

interface EntryView {
	type?: unknown;
	message?: MessageView;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function collapseWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function clamp(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, maxChars - 1).trimEnd()}…`;
}

function escapeMarkdown(value: string): string {
	return value.replace(/([\\`*_[\]<>#])/g, "\\$1");
}

function codeSpan(value: string): string {
	const longestRun = Math.max(0, ...Array.from(value.matchAll(/`+/g), match => match[0].length));
	const delimiter = "`".repeat(longestRun + 1);
	return `${delimiter}${value}${delimiter}`;
}

function markerStart(sessionId: string): string {
	return `<!-- omp-bookmark:start:${sessionId} -->`;
}

function markerEnd(sessionId: string): string {
	return `<!-- omp-bookmark:end:${sessionId} -->`;
}

export function isNiloTree(dir: string): boolean {
	return resolve(dir)
		.split(/[\\/]/)
		.some(part => part === "nilo" || part.startsWith("nilo-"));
}

export function resolveDefaultWikiRoot(
	cwd: string = process.cwd(),
	homeDirectory: string = homedir(),
	envWikiRoot: string | undefined = process.env.AGENTS_WIKI_DIR,
): string {
	if (isNiloTree(cwd)) return join(homeDirectory, ...NILO_WIKI_SEGMENTS);
	return envWikiRoot?.trim() || join(homeDirectory, "agents-wiki");
}

export function parseBookmarkFilename(
	args: string,
	defaultFilename: string | undefined = process.env.AGENTS_BOOKMARK_FILE,
): string {
	const fallback = defaultFilename?.trim().replace(/\s+/g, "-");
	const requested = args.trim() || fallback || DEFAULT_BOOKMARK_FILE;
	if (/\s/.test(requested)) {
		throw new Error("bookmark name cannot contain whitespace");
	}

	const stem = requested.toLowerCase().endsWith(".md") ? requested.slice(0, -3) : requested;
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(stem)) {
		throw new Error("bookmark name must be 1-80 letters, numbers, dots, dashes, or underscores");
	}
	return `${stem}.md`;
}

export function resolveBookmarkFile(
	args: string,
	wikiRoot: string | undefined = process.env.AGENTS_WIKI_DIR,
	homeDirectory: string = homedir(),
	defaultFilename: string | undefined = process.env.AGENTS_BOOKMARK_FILE,
): string {
	const filename = parseBookmarkFilename(args, defaultFilename);
	const configured = wikiRoot?.trim() || join(homeDirectory, "agents-wiki");
	const expanded =
		configured === "~"
			? homeDirectory
			: configured.startsWith("~/")
				? join(homeDirectory, configured.slice(2))
				: configured;
	return resolve(expanded, "omp-bookmarks", filename);
}

function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.flatMap(block => {
			if (!block || typeof block !== "object") return [];
			const candidate = block as { type?: unknown; text?: unknown };
			return candidate.type === "text" && typeof candidate.text === "string" ? [candidate.text] : [];
		})
		.join("\n");
}

export function extractTranscript(entries: readonly unknown[]): string {
	const messages: string[] = [];
	for (const rawEntry of entries) {
		if (!rawEntry || typeof rawEntry !== "object") continue;
		const entry = rawEntry as EntryView;
		if (entry.type !== "message" || !entry.message) continue;
		if (entry.message.role !== "user" && entry.message.role !== "assistant") continue;
		const text = messageText(entry.message.content).trim();
		if (!text) continue;
		const role = entry.message.role === "user" ? "USER" : "ASSISTANT";
		messages.push(`${role}:\n${clamp(text, MAX_MESSAGE_CHARS)}`);
	}

	const transcript = messages.join("\n\n");
	if (transcript.length <= MAX_TRANSCRIPT_CHARS) return transcript;
	const headChars = 40_000;
	const tailChars = MAX_TRANSCRIPT_CHARS - headChars;
	return [
		transcript.slice(0, headChars).trimEnd(),
		"\n\n[OLDER MIDDLE MESSAGES OMITTED FOR LENGTH]\n\n",
		transcript.slice(-tailChars).trimStart(),
	].join("");
}

function requiredSummaryText(value: unknown, field: string, maxChars: number): string {
	if (typeof value !== "string") throw new Error(`summary field ${field} is not a string`);
	const text = collapseWhitespace(value);
	if (!text) throw new Error(`summary field ${field} is empty`);
	return clamp(text, maxChars);
}

export function parseSummary(raw: string): BookmarkSummary {
	const firstBrace = raw.indexOf("{");
	const lastBrace = raw.lastIndexOf("}");
	if (firstBrace < 0 || lastBrace <= firstBrace) throw new Error("tiny model returned no JSON object");

	const parsed = JSON.parse(raw.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("tiny model returned invalid summary JSON");
	}
	if (!Array.isArray(parsed.parked)) throw new Error("summary field parked is not an array");

	return {
		overall: requiredSummaryText(parsed.overall, "overall", 500),
		latest: requiredSummaryText(parsed.latest, "latest", 500),
		parked: parsed.parked
			.filter((item): item is string => typeof item === "string")
			.map(item => clamp(collapseWhitespace(item), 300))
			.filter(Boolean)
			.slice(0, 8),
	};
}

export function renderBookmark(record: BookmarkRecord): string {
	const timestamp = record.recordedAt.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
	const title = escapeMarkdown(collapseWhitespace(record.title) || "Untitled session");
	const lines = [
		markerStart(record.sessionId),
		`## ${timestamp} — ${title}`,
		`- Session: ${codeSpan(record.sessionId)}`,
		`- Transcript: ${codeSpan(record.sessionFile)}`,
	];

	if (record.summary) {
		lines.push(
			"",
			`**Overall:** ${escapeMarkdown(record.summary.overall)}`,
			"",
			`**Latest:** ${escapeMarkdown(record.summary.latest)}`,
			"",
			"**Parked:**",
		);
		if (record.summary.parked.length === 0) lines.push("- Nothing unresolved.");
		else lines.push(...record.summary.parked.map(item => `- ${escapeMarkdown(item)}`));
	}

	lines.push(markerEnd(record.sessionId));
	return lines.join("\n");
}

export function upsertBookmark(existing: string, entry: string, sessionId: string): string {
	const start = markerStart(sessionId);
	const end = markerEnd(sessionId);
	const startIndex = existing.indexOf(start);
	const endIndex = existing.indexOf(end);

	if ((startIndex < 0) !== (endIndex < 0) || (startIndex >= 0 && endIndex < startIndex)) {
		throw new Error(`malformed existing bookmark block for session ${sessionId}`);
	}

	let base = existing;
	if (startIndex >= 0) {
		const before = existing.slice(0, startIndex).trimEnd();
		const after = existing.slice(endIndex + end.length).trimStart();
		base = [before, after].filter(Boolean).join("\n\n");
	}

	const trimmed = base.trim();
	if (!trimmed) {
		return `# OMP bookmarks\n\n${entry.trim()}\n`;
	}

	// If the file starts with a level 1 heading, keep it at the top and prepend beneath it.
	const headerMatch = trimmed.match(/^(#[^\r\n]*)(?:\r?\n+([\s\S]*))?$/);
	if (headerMatch) {
		const heading = headerMatch[1].trim();
		const rest = (headerMatch[2] || "").trim();
		if (rest) {
			return `${heading}\n\n${entry.trim()}\n\n${rest}\n`;
		}
		return `${heading}\n\n${entry.trim()}\n`;
	}

	return `${entry.trim()}\n\n${trimmed}\n`;
}

function writeBookmark(file: string, record: BookmarkRecord): void {
	mkdirSync(dirname(file), { recursive: true });
	const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
	const content = upsertBookmark(existing, renderBookmark(record), record.sessionId);
	const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
	const mode = existsSync(file) ? statSync(file).mode & 0o777 : 0o666;
	try {
		writeFileSync(temporary, content, { encoding: "utf8", mode });
		renameSync(temporary, file);
	} catch (error) {
		try {
			unlinkSync(temporary);
		} catch {
			// The temporary file may not have been created.
		}
		throw error;
	}
}

export async function summarizeWithTiny(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	transcript: string,
): Promise<BookmarkSummary> {
	const model = ctx.models.resolve(MODEL_ROLE);
	if (!model) throw new Error(`model unavailable: ${MODEL_ROLE}`);
	const systemPrompt = readFileSync(join(EXT_DIR, "summary-prompt.md"), "utf8");
	const { createAgentSession, SessionManager, AgentRegistry } = pi.pi;
	const { session } = await createAgentSession({
		cwd: ctx.cwd,
		model,
		thinkingLevel: THINKING_LEVEL,
		systemPrompt,
		sessionManager: SessionManager.inMemory(),
		agentRegistry: new AgentRegistry(),
		disableExtensionDiscovery: true,
		skills: [],
		rules: [],
		contextFiles: [],
		enableMCP: false,
		enableLsp: false,
		toolNames: [],
		restrictToolNames: true,
	});

	let response = "";
	const unsubscribe = session.subscribe(event => {
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			response += event.assistantMessageEvent.delta;
		}
	});
	try {
		await session.prompt(`# SESSION TRANSCRIPT\n\n${transcript || "No conversation messages were available."}`);
		return parseSummary(response);
	} finally {
		unsubscribe();
		await session.dispose();
	}
}

export function registerBookmarkSessionExtension(
	pi: ExtensionAPI,
	dependencies: BookmarkExtensionDependencies = {},
): void {
	pi.setLabel("Session Bookmarks");
	const summarize =
		dependencies.summarize ??
		((transcript: string, ctx: ExtensionContext) => summarizeWithTiny(pi, ctx, transcript));

	const commandDefinition = {
		description: "Bookmark this session: /bookmark-session [file]",
		handler: async (args: string, ctx: ExtensionContext) => {
			let file: string;
			try {
				file = resolveBookmarkFile(
					args,
					dependencies.wikiRoot ??
						resolveDefaultWikiRoot(ctx.cwd, dependencies.homeDirectory),
					dependencies.homeDirectory,
					dependencies.defaultFilename,
				);
			} catch (error) {
				ctx.ui.notify(`Bookmark failed: ${errorMessage(error)}`, "error");
				return;
			}

			const sessionId = ctx.sessionManager.getSessionId();
			const sessionFile = ctx.sessionManager.getSessionFile();
			if (!sessionId || !sessionFile) {
				ctx.ui.notify("Bookmark failed: this session has no durable id or transcript file", "error");
				return;
			}

			const record: BookmarkRecord = {
				sessionId,
				sessionFile,
				title: ctx.sessionManager.getSessionName() || "Untitled session",
				recordedAt: new Date(),
			};

			try {
				writeBookmark(file, record);
			} catch (error) {
				ctx.ui.notify(`Bookmark failed: ${errorMessage(error)}`, "error");
				return;
			}

			ctx.ui.setStatus("bookmark-session", "bookmark · summarizing with @tiny");
			try {
				const transcript = extractTranscript(ctx.sessionManager.getBranch());
				record.summary = await summarize(transcript, ctx);
				writeBookmark(file, record);
				ctx.ui.notify(`Bookmarked session → ${file}`, "info");
			} catch (error) {
				ctx.ui.notify(
					`Bookmarked session → ${file} (summary unavailable: ${errorMessage(error)})`,
					"warning",
				);
			} finally {
				ctx.ui.setStatus("bookmark-session", undefined);
			}
		},
	};

	pi.registerCommand("bookmark-session", commandDefinition);
}

export default function bookmarkSessionExtension(pi: ExtensionAPI): void {
	registerBookmarkSessionExtension(pi);
}
