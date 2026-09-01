import { loadEntriesFromFile, type SessionEntry } from "@oh-my-pi/pi-coding-agent";
import type { LedgerPointer } from "./ledger";

type Keep = {
	thinking: boolean;
	tools: { default: "none" | "trace" | "full"; byName: Map<string, "none" | "trace" | "full"> };
	skills: "full" | "brief" | "bare";
	story: boolean;
};
type ProseItem =
	| { kind: "message"; message: { role: string; content: unknown } }
	| { kind: "custom"; customType: string; content: unknown };

type ProseModule = {
	proseOf: (entries: SessionEntry[], keep: Keep) => ProseItem[];
	storyFold: (items: ProseItem[]) => ProseItem[];
};

const STRIP: Keep = {
	thinking: false,
	tools: { default: "none", byName: new Map() },
	skills: "bare",
	story: true,
};

// prose.ts lives in the project extension tree, outside this package's typecheck.
const PROSE_HREF = new URL("../../../.omp/extensions/prose/prose.ts", import.meta.url).href;
export type SessionSlice = {
	cwd?: string;
	prose: string;
	full: string;
};

/** Load the leaf branch and split it into stripped backstory + full pending turns. */
export async function sliceSession(sessionFile: string, pointers: LedgerPointer[]): Promise<SessionSlice> {
	const raw = await loadEntriesFromFile(sessionFile);
	const header = raw.find(entry => entry.type === "session");
	const entries = leafBranch(raw.filter((entry): entry is SessionEntry => entry.type !== "session"));
	const start = firstPendingStart(entries, pointers);
	const backstory = start === undefined ? [] : entries.slice(0, start);
	const pending = start === undefined ? entries : entries.slice(start);
	return {
		cwd: header && "cwd" in header && typeof header.cwd === "string" ? header.cwd : undefined,
		prose: await renderProse(backstory),
		full: renderTranscript(pending),
	};
}

function leafBranch(entries: SessionEntry[]): SessionEntry[] {
	if (entries.length === 0) return [];
	const byId = new Map(entries.map(entry => [entry.id, entry]));
	const chain: SessionEntry[] = [];
	const seen = new Set<string>();
	let current: SessionEntry | undefined = entries[entries.length - 1];
	while (current && !seen.has(current.id)) {
		seen.add(current.id);
		chain.push(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	chain.reverse();
	return chain;
}

function firstPendingStart(entries: SessionEntry[], pointers: LedgerPointer[]): number | undefined {
	const starts = userTurnStarts(entries);
	if (starts.length === 0) return undefined;
	let earliest: number | undefined;
	for (const pointer of pointers) {
		const index = locateTurnStart(entries, starts, pointer);
		if (index === undefined) continue;
		if (earliest === undefined || index < earliest) earliest = index;
	}
	return earliest ?? starts[starts.length - 1];
}

function userTurnStarts(entries: SessionEntry[]): number[] {
	const starts: number[] = [];
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (entry?.type === "message" && entry.message.role === "user" && !entry.message.synthetic) {
			starts.push(i);
		}
	}
	return starts;
}

function locateTurnStart(entries: SessionEntry[], starts: number[], pointer: LedgerPointer): number | undefined {
	if (pointer.leaf) {
		const leafAt = entries.findIndex(entry => entry.id === pointer.leaf);
		if (leafAt >= 0) return lastStartAtOrBefore(starts, leafAt);
	}
	const ts = pointer.ts;
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry && entry.timestamp <= ts) return lastStartAtOrBefore(starts, i);
	}
	return undefined;
}

function lastStartAtOrBefore(starts: number[], index: number): number | undefined {
	for (let i = starts.length - 1; i >= 0; i--) {
		const start = starts[i];
		if (start !== undefined && start <= index) return start;
	}
	return undefined;
}

async function renderProse(entries: SessionEntry[]): Promise<string> {
	if (entries.length === 0) return "";
	const { proseOf, storyFold } = (await import(PROSE_HREF)) as ProseModule;
	const folded = storyFold(proseOf(entries, STRIP));
	const item = folded[0];
	if (!item || item.kind !== "message") return "";
	const content = item.message.content;
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	const texts: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object" || !("type" in part) || part.type !== "text") continue;
		if ("text" in part && typeof part.text === "string") texts.push(part.text);
	}
	return texts.join("\n\n").trim();
}
function renderTranscript(entries: SessionEntry[]): string {
	const blocks: string[] = [];
	for (const entry of entries) {
		if (entry.type === "custom_message") {
			const body = typeof entry.content === "string" ? entry.content : textParts(entry.content);
			if (body.trim()) blocks.push(`[@system ${entry.customType}]\n${body.trim()}`);
			continue;
		}
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role === "user") {
			const body = textOf(message.content);
			if (body.trim()) blocks.push(`[@user]\n${body.trim()}`);
			continue;
		}
		if (message.role === "assistant") {
			const body = assistantBody(message.content);
			if (body.trim()) blocks.push(`[@assistant]\n${body.trim()}`);
			continue;
		}
		if (message.role === "toolResult") {
			const body = textOf(message.content);
			if (body.trim()) blocks.push(`[toolResult ${message.toolCallId}]\n${body.trim()}`);
		}
	}
	return blocks.join("\n\n");
}

function assistantBody(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		if (!("type" in part)) continue;
		if (part.type === "text" && "text" in part && typeof part.text === "string") {
			if (part.text.trim()) parts.push(part.text);
			continue;
		}
		if (part.type === "toolCall") {
			const name = "name" in part && typeof part.name === "string" ? part.name : "tool";
			const rawArgs = "arguments" in part && part.arguments && typeof part.arguments === "object" ? part.arguments : undefined;
			const args = rawArgs && !Array.isArray(rawArgs) ? summarizeArgs(rawArgs) : "";
			const id = "id" in part && typeof part.id === "string" ? part.id : "";
			parts.push(`[tool ${name}${args ? ` ${args}` : ""}]${id ? ` id=${id}` : ""}`);
		}
	}
	return parts.join("\n");
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) return textParts(content);
	return "";
}

function textParts(content: unknown[]): string {
	const parts: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object" || !("type" in part) || part.type !== "text") continue;
		if ("text" in part && typeof part.text === "string") parts.push(part.text);
	}
	return parts.join("\n");
}

function summarizeArgs(args: object): string {
	for (const key of ["path", "command", "pattern", "file", "url", "query", "name"]) {
		const value = Reflect.get(args, key);
		if (typeof value === "string" && value.length > 0) {
			const flat = value.replace(/\s+/g, " ");
			return flat.length > 160 ? `${flat.slice(0, 159)}…` : flat;
		}
	}
	return "";
}
