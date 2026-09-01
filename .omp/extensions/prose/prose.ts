/**
 * /prose — distill a conversation without asking a model to summarize it. A
 * bare command forks the whole branch into a new session; choosing a number
 * keeps only that many recent user turns and writes them as a sibling branch
 * in this session.
 *
 * Use it when a long session has become mostly machinery — the provider
 * bookkeeping and the reasoning are dead weight, but the conversation, skill
 * injections, peer messages, and earlier compaction summaries are still the
 * thing you want to keep working from.
 *
 * One axis governs tool calls, at three levels:
 *   none   the call leaves nothing behind
 *   trace  one bracketed line naming the tool and its target — the default,
 *          applied to every tool without exception
 *   full   native replay: the toolCall stays a toolCall and its toolResult
 *          stays a toolResult — arguments and output verbatim, uncapped
 *
 * Usage:
 *   /prose                    fork the entire conversation to a new session
 *   /prose N                 distill the last N user turns in place
 *   /prose ^N (or bare ^)    keep the Nth-from-last user turn ONWARD verbatim —
 *                            tool calls, results, reasoning untouched — and
 *                            distill everything before it, in place (^ = ^1:
 *                            your last question). Same ^ vocabulary as /pivot.
 *   /prose ?  /prose ^?      pick the turn interactively (distill-from / keep-from)
 *   /prose story             same filters, but the whole exchange lands as ONE
 *                            user message with [@user]/[@assistant]/[@system]
 *                            speaker markers (the prose-note stays above it)
 *   /prose +tools            every tool call and result kept as native turns
 *   /prose -tools            no tool traces at all
 *   /prose +tools=read,edit  those tools native, every other tool traced
 *   /prose -tools=bash,todo  those tools erased, every other tool traced
 *                            (the slots are independent, so `-tools +tools=task`
 *                            keeps delegations native and erases the rest)
 *   /prose -skills           skill injections shrink to [invoked skill: name] + prompt
 *   /prose +skills           keep injected skill bodies verbatim
 *                            (default: name — description + recovery pointer)
 *   /prose +think            also keep readable reasoning, delimited as
 *                            [thinking]…[/thinking] blocks
 *
 * The distilled region opens with a `prose-note` entry that tells the future
 * reader what was removed, and closes with an end-marker restating the one
 * rule that matters at the point where generation resumes: act through real
 * tool calls. Head framing decays with distance (measured: a frontier model
 * imitated trace lines with the note 40k tokens upstream); the tail marker
 * sits inside the danger window — the first turns after a fork, when
 * distilled turns are the only local pattern.
 * Square brackets are /prose's editorial voice throughout: the note, skill
 * stubs, compaction blocks, traces, and thinking delimiters are bracketed;
 * verbatim prose never is.
 *
 * Mechanism: the bare form uses `ctx.newSession({ parentSession, setup })`; the
 * numbered form moves the live manager's leaf to the chosen turn's parent and
 * appends the filtered tail there. The ^ form never moves the leaf: it appends
 * a reset_boundary (the /clear mechanism — context emission restarts after it,
 * and session-context honors it on every rebuild) followed by the distilled
 * head and a verbatim copy of the kept turns. State entries (model, thinking
 * level, tier, mode, TTSR) stay above the boundary and remain effective; the
 * unfiltered journey stays reachable through /tree and /resume in every form.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import type {
	AssistantMessage,
	ImageContent,
	Message,
	MessageAttribution,
	TextContent,
	ToolCall,
	ToolResultMessage,
} from "@oh-my-pi/pi-ai";
import type { ExtensionAPI, ExtensionUIContext, ReadonlySessionManager, SessionEntry } from "@oh-my-pi/pi-coding-agent";
import type { AutocompleteItem } from "@oh-my-pi/pi-tui";

/** Ghost text after `/prose `, mirroring how builtins advertise their arguments. */
const PROSE_HINT = "[N|^N|?|^?] [story] [±tools[=a,b]] [±skills] [+think]";
const PICKER_LIMIT = 30;

/**
 * How much of a tool call survives. `none` erases it, `trace` keeps one
 * bracketed line, `full` keeps the native toolCall and its toolResult.
 */
export type ToolLevel = "none" | "trace" | "full";
/**
 * `default` covers every tool the user did not name; `byName` overrides it per
 * tool. Two independent slots, so order never matters and the granular form
 * composes with the blanket one instead of fighting it.
 */
export type ToolKeep = { default: ToolLevel; byName: Map<string, ToolLevel> };
export type Keep = {
	thinking: boolean;
	tools: ToolKeep;
	skills: "full" | "brief" | "bare";
	story: boolean;
};

export interface ArchiveSpan {
	startLine: number;
	endLine: number;
}

export interface ProseArchive {
	content: string;
	spansByCallId: Map<string, ArchiveSpan>;
	itemCount: number;
	rebasedSpans: Map<string, ArchiveSpan>;
}

const levelFor = (keep: ToolKeep, name: string): ToolLevel => keep.byName.get(name) ?? keep.default;
const levelsUsed = (keep: ToolKeep): Set<ToolLevel> => new Set([keep.default, ...keep.byName.values()]);
type CustomContent = Extract<SessionEntry, { type: "custom_message" }>["content"];
export type ProseItem =
	| { kind: "message"; message: Message }
	| {
			kind: "custom";
			customType: string;
			content: CustomContent;
			display?: boolean;
			details?: unknown;
			attribution?: MessageAttribution;
	  };
/** Content shapes that survive a user / custom copy. */
type Part = TextContent | ImageContent;
/** Assistant copies may also keep native tool calls when `full` is set. */
type AssistantPart = Part | ToolCall;

const asText = (text: string): TextContent => ({ type: "text", text });

const pushText = (parts: AssistantPart[], text: string) => {
	if (text.trim().length > 0) parts.push(asText(text));
};

const targetText = (value: unknown): string => (value === undefined || value === null ? "" : String(value));

/**
 * Speech gets a longer target cap than a pointer does. The axis is
 * recoverability: a `read` path or a `bash` command points at something still
 * on disk or still re-runnable, so 120 characters of it is orientation enough
 * — but a peer message, a search query, and a delegation exist ONLY in these
 * arguments, and the other half of each exchange is already preserved whole
 * (`irc:incoming` and `async-result` entries). Cut those to a pointer's length
 * and the fork reads as one side of a phone call: peers and subagents
 * answering questions that were never asked.
 */
function isSpeech(call: ToolCall): boolean {
	if (call.name === "web_search" || call.name === "task") return true;
	if (call.name !== "hub" && call.name !== "irc") return false;
	// `message` is the peer-send field. A process `send` carries `text`/`keys`
	// instead — stdin to something we started, machinery rather than speech.
	const args = call.arguments;
	if (typeof args !== "object" || args === null || !("message" in args)) return false;
	return typeof args.message === "string" && args.message.length > 0;
}

/** Speech carries meaning in its words; a pointer does not. */
const TARGET_CAP = 120;
const SPEECH_CAP = 240;

/**
 * Label inside each trace bracket: `[ran read foo.ts]`. Past tense is the
 * point: one token that marks the line as a record of something that already
 * happened, never an instruction — the same shape as `[invoked skill: …]`.
 * The prose-note templates on this const, so framing and format cannot drift.
 * Rejected: "→ " (decorative glyph, tense-neutral), "@tool " (actor label,
 * still tense-neutral), "trimmed tool call: " (5 tokens × hundreds of lines),
 * "" (the only bracket without a kind label).
 */
const TRACE_PREFIX = "ran ";

function toolTarget(call: ToolCall): string {
	const args = call.arguments ?? {};
	let target = "";
	switch (call.name) {
		case "read":
		case "write":
		case "glob":
			target = targetText(args.path);
			break;
		case "edit":
			target = /\[([^\]\n#]+)#/.exec(String(args.input))?.[1] ?? "";
			break;
		case "bash":
			target = targetText(args.command).split(/\r?\n/, 1)[0].slice(0, 80);
			break;
		case "grep": {
			const pattern = targetText(args.pattern);
			const path = targetText(args.path);
			target = pattern + (path ? ` in ${path}` : "");
			break;
		}
		case "task": {
			// Names and agents, never the assignment bodies (4243 chars avg): the
			// point is that delegation happened and to whom — the answers come back
			// as `async-result` entries, which /prose already keeps whole.
			const tasks = Array.isArray(args.tasks) ? args.tasks : [];
			target = tasks
				.map(task => {
					if (!task || typeof task !== "object") return "";
					const name = "name" in task ? targetText(task.name) : "";
					const agent = "agent" in task ? targetText(task.agent) : "";
					return name && agent ? `${name}(${agent})` : name || agent;
				})
				.filter(Boolean)
				.join(", ");
			if (!target && tasks.length > 0) target = `${tasks.length} agent${tasks.length === 1 ? "" : "s"}`;
			break;
		}
		case "eval":
			target = targetText(args.title ?? args.language);
			break;
		case "browser":
			target = [args.action, args.url].filter(value => value !== undefined && value !== null && value !== "").join(" ");
			break;
		case "hub":
		case "irc": {
			const message = targetText(args.message);
			if (message) {
				target = `send ${targetText(args.to)}: ${message}`;
			} else {
				target = [args.op, args.name ?? args.to]
					.filter(value => value !== undefined && value !== null && value !== "")
					.join(" ");
			}
			break;
		}
		case "web_search":
			target = targetText(args.query);
			break;
		case "todo":
			target = targetText(args.op);
			break;
		case "yield":
			target = String(args.result ?? args.output ?? args.summary ?? "").slice(0, 200);
			break;
		default:
			target = typeof args.i === "string" ? args.i : "";
	}
	// Collapse whitespace before capping: a message with newlines would break the
	// one-artifact-per-line bracket invariant.
	return target.replace(/\s+/g, " ").trim().slice(0, isSpeech(call) ? SPEECH_CAP : TARGET_CAP);
}

function toolLine(call: ToolCall, result: ToolResultMessage | undefined): string {
	const target = toolTarget(call);
	return `${call.name}${target ? ` ${target}` : ""}${result?.isError ? " — FAILED" : ""}`;
}

type TracedItem = {
	baseLine: string;
	span?: ArchiveSpan;
};

function formatTracedItems(items: TracedItem[], artifactId?: string): string[] {
	const lines: string[] = [];
	for (let i = 0; i < items.length; ) {
		let end = i + 1;
		while (
			end < items.length &&
			items[end].baseLine === items[i].baseLine &&
			(!items[end].span || !items[end - 1].span || items[end].span!.startLine > items[end - 1].span!.endLine)
		) {
			end++;
		}
		const count = end - i;
		const base = count === 1 ? items[i].baseLine : `${items[i].baseLine} ×${count}`;
		let recover = "";
		if (artifactId) {
			const firstSpan = items[i].span;
			const lastSpan = items[end - 1].span;
			if (firstSpan && lastSpan) {
				recover = `; recover: artifact://${artifactId}:${firstSpan.startLine}-${lastSpan.endLine}`;
			}
		}
		lines.push(`[${TRACE_PREFIX}${base}${recover}]`);
		i = end;
	}
	return lines;
}

function toolResultText(message: ToolResultMessage): string {
	if (!Array.isArray(message.content)) {
		return typeof message.content === "string" ? message.content : "";
	}
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map(block => block.text)
		.join("\n");
}

/** Every tool result on the branch, keyed by the call it answers. */
function resultsOf(entries: SessionEntry[]): Map<string, ToolResultMessage> {
	const results = new Map<string, ToolResultMessage>();
	for (const entry of entries) {
		if (entry.type === "message" && entry.message.role === "toolResult") {
			results.set(entry.message.toolCallId, entry.message);
		}
	}
	return results;
}

/** Create a memoized reader for artifact files to avoid repeat I/O on the TUI thread. */
function createArtifactReader(artifactsDir?: string | null): (artifactId: string, startLine: number, endLine: number) => string[] | null {
	if (!artifactsDir || !existsSync(artifactsDir)) return () => null;
	const fileCache = new Map<string, string[]>();
	return (artifactId: string, startLine: number, endLine: number): string[] | null => {
		try {
			let allLines = fileCache.get(artifactId);
			if (!allLines) {
				const files = readdirSync(artifactsDir);
				const filename = files.find(f => f === `${artifactId}.log` || f.startsWith(`${artifactId}.`));
				if (!filename) return null;
				const fullText = readFileSync(path.join(artifactsDir, filename), "utf8");
				allLines = fullText.split(/\r?\n/);
				fileCache.set(artifactId, allLines);
			}
			const start = Math.max(1, startLine);
			const end = Math.min(allLines.length, endLine);
			if (start > end) return null;
			return allLines.slice(start - 1, end);
		} catch {
			return null;
		}
	};
}

/** Extract all artifact://<id>:<start>-<end> references in arbitrary text. */
function extractArtifactRefs(text: string): Array<{ rawKey: string; id: string; start: number; end: number }> {
	const regex = /artifact:\/\/(\d+):(\d+)-(\d+)/g;
	const refs: Array<{ rawKey: string; id: string; start: number; end: number }> = [];
	let match: RegExpExecArray | null;
	while ((match = regex.exec(text)) !== null) {
		refs.push({
			rawKey: match[0],
			id: match[1],
			start: Number.parseInt(match[2], 10),
			end: Number.parseInt(match[3], 10),
		});
	}
	return refs;
}

/**
 * Build the single session archive preserving discarded tool inputs, results,
 * dropped reasoning, and rebased historical artifact slices. Content lines are
 * written verbatim with exact line tracking.
 */
export function buildProseArchive(
	entries: SessionEntry[],
	keep: Keep,
	results: Map<string, ToolResultMessage>,
	sourceArtifactsDir?: string | null,
): ProseArchive {
	const lines: string[] = ["# Prose Archive", ""];
	const spansByCallId = new Map<string, ArchiveSpan>();
	const rebasedSpans = new Map<string, ArchiveSpan>();
	const readArtifact = createArtifactReader(sourceArtifactsDir);
	let itemCount = 0;

	const processTextForRebase = (text: string) => {
		for (const ref of extractArtifactRefs(text)) {
			if (rebasedSpans.has(ref.rawKey)) continue;
			const slice = readArtifact(ref.id, ref.start, ref.end);
			if (slice && slice.length > 0) {
				itemCount++;
				const startLine = lines.length + 1;
				lines.push(`### [${itemCount}] prior ${ref.rawKey}`);
				lines.push("- Content:");
				for (const l of slice) lines.push(l);
				const endLine = lines.length;
				lines.push("");
				rebasedSpans.set(ref.rawKey, { startLine, endLine });
			}
		}
	};

	for (const entry of entries) {
		if (entry.type === "message") {
			const message = entry.message;
			if (message.role === "assistant") {
				for (const part of message.content) {
					if (part.type === "toolCall" && levelFor(keep.tools, part.name) === "trace") {
						itemCount++;
						const startLine = lines.length + 1;
						const target = toolTarget(part);
						lines.push(`### [${itemCount}] ${part.name}${target ? ` ${target}` : ""}`);
						lines.push("- Arguments:");
						const argsJson = JSON.stringify(part.arguments ?? {}, null, 2);
						for (const l of argsJson.split("\n")) lines.push(l);

						const result = results.get(part.id);
						if (result) {
							lines.push(`- Result${result.isError ? " (FAILED)" : ""}:`);
							const text = toolResultText(result);
							if (text.length > 0) {
								for (const l of text.split("\n")) lines.push(l);
							} else {
								const images = Array.isArray(result.content)
									? result.content.filter((c): c is ImageContent => typeof c === "object" && c !== null && "type" in c && c.type === "image").length
									: 0;
								if (images > 0) lines.push(`[${images} image(s)]`);
								else lines.push("(empty output)");
							}
						} else {
							lines.push("- Result: (no result recorded)");
						}
						const endLine = lines.length;
						lines.push("");
						spansByCallId.set(part.id, { startLine, endLine });
					} else if (part.type === "thinking" && !keep.thinking && part.thinking.trim().length > 0) {
						itemCount++;
						const startLine = lines.length + 1;
						lines.push(`### [${itemCount}] thinking`);
						for (const l of part.thinking.split("\n")) lines.push(l);
						const endLine = lines.length;
						lines.push("");
					} else if (part.type === "text") {
						processTextForRebase(part.text);
					}
				}
			} else if (message.role === "user") {
				if (typeof message.content === "string") {
					processTextForRebase(message.content);
				} else if (Array.isArray(message.content)) {
					for (const part of message.content) {
						if (part.type === "text") processTextForRebase(part.text);
					}
				}
			}
		} else if (entry.type === "custom_message") {
			if (typeof entry.content === "string") {
				processTextForRebase(entry.content);
			} else if (Array.isArray(entry.content)) {
				for (const part of entry.content) {
					if (part && typeof part === "object" && "type" in part && part.type === "text" && typeof (part as { text?: unknown }).text === "string") {
						processTextForRebase((part as { text: string }).text);
					}
				}
			}
			if (entry.customType === "skill-prompt" && keep.skills !== "full") {
				itemCount++;
				const startLine = lines.length + 1;
				const skillDetails = entry.details as { name?: string } | undefined;
				lines.push(`### [${itemCount}] skill: ${skillDetails?.name ?? "unknown"}`);
				const skillText = typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content, null, 2);
				for (const l of skillText.split("\n")) lines.push(l);
				const endLine = lines.length;
				lines.push("");
			}
		}
	}

	return {
		content: lines.join("\n"),
		spansByCallId,
		itemCount,
		rebasedSpans,
	};
}

function rebaseTextArtifactLinks(
	text: string,
	artifactId?: string,
	rebasedSpans?: Map<string, ArchiveSpan>,
): string {
	return text.replace(/(;\s*recover:\s*)?artifact:\/\/(\d+:\d+-\d+)/g, (_match, prefix, rawKey) => {
		const key = `artifact://${rawKey}`;
		const isRecoverClause = Boolean(prefix);
		if (artifactId && rebasedSpans?.has(key)) {
			const span = rebasedSpans.get(key)!;
			const newUri = `artifact://${artifactId}:${span.startLine}-${span.endLine}`;
			return isRecoverClause ? `${prefix}${newUri}` : newUri;
		}
		return isRecoverClause ? `; unrecoverable (was ${key})` : `[unrecoverable ${key}]`;
	});
}

/**
 * Nothing provider-shaped survives the copy unless `full` asks for native
 * tool replay. A ThinkingContent carries a signature that is only valid for
 * the model that produced it, so thinking is always rendered down to delimited
 * text. A ToolCall at `full` stays a ToolCall — paired with its toolResult —
 * because `transformMessages` already normalizes ids and synthesizes missing
 * answers on the next request; at every other level it collapses to a trace
 * line or vanishes. Text is re-wrapped rather than passed through, dropping
 * the `textSignature` that points into a provider history this fork no longer
 * has.
 *
 * Empty parts are skipped throughout: a zero-length text block is rejected
 * outright by Anthropic, and encrypted reasoning persists as exactly that —
 * `thinking: ""` beside a signature.
 */
function assistantParts(
	message: AssistantMessage,
	keep: Keep,
	results: Map<string, ToolResultMessage>,
	spans?: Map<string, ArchiveSpan>,
	artifactId?: string,
	rebasedSpans?: Map<string, ArchiveSpan>,
): { parts: AssistantPart[]; pendingResults: ToolResultMessage[] } {
	const parts: AssistantPart[] = [];
	const pendingResults: ToolResultMessage[] = [];
	let tracedItems: TracedItem[] = [];
	const flushTools = () => {
		if (tracedItems.length > 0) {
			pushText(parts, formatTracedItems(tracedItems, artifactId).join("\n"));
			tracedItems = [];
		}
	};
	for (const part of message.content) {
		if (part.type === "toolCall") {
			const level = levelFor(keep.tools, part.name);
			if (level === "trace") {
				tracedItems.push({
					baseLine: toolLine(part, results.get(part.id)),
					span: spans?.get(part.id),
				});
			} else if (level === "full") {
				// A native call is not a trace line, so it cannot join the run that
				// `×N` collapsing folds. Flush first and the ordering survives.
				flushTools();
				parts.push(sanitizeToolCall(part));
				pendingResults.push(resultFor(part, results.get(part.id)));
			}
			continue;
		}
		flushTools();
		if (part.type === "text") {
			const text = artifactId && rebasedSpans ? rebaseTextArtifactLinks(part.text, artifactId, rebasedSpans) : part.text;
			pushText(parts, text);
		} else if (part.type === "image") parts.push(part);
		else if (part.type === "thinking" && keep.thinking && part.thinking.trim().length > 0) {
			// Delimited, not flattened: the reply must stay distinguishable from the
			// monologue that produced it. Brackets = editorial voice; the text
			// between them is byte-verbatim.
			pushText(parts, `[thinking]\n${part.thinking}\n[/thinking]`);
		}
	}
	flushTools();
	return { parts, pendingResults };
}

/**
 * Strip fields that only the producing model / provider can honor. Ids and
 * arguments stay — `transformMessages` rewrites ids for the target wire format
 * and fills a missing result if one ever slips through. `thoughtSignature` and
 * `providerMetadata` are the cross-provider footguns; `rawBlock` is an in-band
 * syntax fossil that only the original dialect understands.
 */
function sanitizeToolCall(call: ToolCall): ToolCall {
	return {
		type: "toolCall",
		id: call.id,
		name: call.name,
		arguments: call.arguments ?? {},
		...(call.intent !== undefined ? { intent: call.intent } : {}),
		...(call.customWireName !== undefined ? { customWireName: call.customWireName } : {}),
	};
}

/**
 * Pair a `full` call with its result. An abort leaves no answer in the session;
 * synthesize an error result rather than emitting an orphan toolCall the next
 * provider request would reject. Content is otherwise verbatim — including a
 * runtime prune stub, which is what the session still holds.
 */
function resultFor(call: ToolCall, result: ToolResultMessage | undefined): ToolResultMessage {
	if (!result) {
		return {
			role: "toolResult",
			toolCallId: call.id,
			toolName: call.name,
			content: [{ type: "text", text: "No result recorded: the call was aborted or never answered" }],
			isError: true,
			timestamp: Date.now(),
		};
	}
	const content: (TextContent | ImageContent)[] = [];
	for (const part of result.content) {
		if (part.type === "image") content.push(part);
		else if (part.text.length > 0) content.push({ type: "text", text: part.text });
	}
	if (content.length === 0) content.push({ type: "text", text: result.isError ? "error" : "(empty)" });
	return {
		role: "toolResult",
		toolCallId: call.id,
		toolName: result.toolName || call.name,
		content,
		isError: result.isError,
		timestamp: result.timestamp,
		...(result.prunedAt !== undefined ? { prunedAt: result.prunedAt } : {}),
		...(result.details !== undefined ? { details: result.details } : {}),
		...(result.useless !== undefined ? { useless: result.useless } : {}),
	};
}

/**
 * Text-archive rendering of a native full call, used only when `story` folds
 * the exchange into one user message — a user turn cannot carry toolCall /
 * toolResult roles, so the content has to become prose.
 */
function fullCallText(call: ToolCall, result: ToolResultMessage | undefined): string {
	const lines = [
		`[${TRACE_PREFIX}${call.name}]`,
		"[args]",
		JSON.stringify(call.arguments ?? {}, null, 2),
		"[/args]",
	];
	if (!result) {
		lines.push("[no result recorded: the call was aborted or never answered]");
		return lines.join("\n");
	}
	let text = "";
	for (const part of result.content) {
		if (part.type === "text" && part.text.length > 0) text += text === "" ? part.text : `\n${part.text}`;
	}
	const empty = text === "" && !result.content.some(part => part.type === "image");
	const marks = [result.isError && "FAILED", result.prunedAt && "pruned before /prose ran", empty && "empty"]
		.filter(Boolean)
		.join(" · ");
	lines.push(`[result${marks ? ` — ${marks}` : ""}]`);
	if (!empty && text) {
		lines.push(text);
		lines.push("[/result]");
	}
	return lines.join("\n");
}

/** True once any turn on this branch kept readable reasoning text. */
function hasReadableThinking(entries: SessionEntry[]): boolean {
	for (const entry of entries) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		for (const part of entry.message.content) {
			if (part.type === "thinking" && part.thinking.trim().length > 0) return true;
		}
	}
	return false;
}

/**
 * The distilled copy spent none of these tokens; the original meter keeps them.
 * `contextTokens` is zeroed too, and deliberately: `hasContextTokenUsage`
 * (pi-agent-core/compaction) treats a surviving `contextTokens` as real usage,
 * which would let a zero-cost copy pose as the context anchor and report the
 * pre-copy prompt size as the current one.
 */
const zeroUsage = (usage: AssistantMessage["usage"]): AssistantMessage["usage"] => ({
	...usage,
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	contextTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

/**
 * Skill injection reduced to one bracketed line. `brief` (the default) keeps
 * the frontmatter description plus a recovery pointer — the body is the one
 * artifact /prose drops that stays losslessly recoverable, by name, from disk.
 * `bare` keeps only the invocation fact. The user's prompt (`args`) always
 * survives: it is conversation, not machinery.
 */
function skillLine(details: { name?: string; path?: string; args?: string }, level: "brief" | "bare"): string {
	const name = details.name ?? "unknown";
	let head = `[invoked skill: ${name}`;
	if (level === "brief") {
		let description: string | undefined;
		try {
			const fileHead = readFileSync(details.path ?? "", "utf8").slice(0, 4096);
			const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fileHead)?.[1] ?? "";
			description = /^description:\s*(.+)$/m.exec(fm)?.[1]?.trim();
		} catch {
			/* skill moved or deleted: the name still points via skill:// */
		}
		if (description) head += ` — ${description}`;
		head += ` · body trimmed, re-read skill://${name} if needed`;
	} else {
		// Even at `bare`, say the body is gone: the reader must not assume a
		// directive it cannot see is still in force.
		head += " · body trimmed";
	}
	head += "]";
	return details.args ? `${head}\n${details.args}` : head;
}

/** Compaction re-rendered as a /prose block; shared with verbatimCopyOf so the two paths cannot drift. */
function compactionBlock(entry: Extract<SessionEntry, { type: "compaction" }>): ProseItem {
	const readFiles = (entry.details as { readFiles?: string[] } | undefined)?.readFiles;
	const files = readFiles?.length ? `\n\nFiles read in the summarized region:\n${readFiles.join("\n")}` : "";
	return {
		kind: "custom",
		customType: "compaction-summary",
		content: `[summary from an earlier compaction of this branch]\n${entry.summary}${files}`,
		// Synthesized here, so nothing carries a display flag forward: without
		// an explicit opt-in the entry reaches the model but never the TUI, and
		// the fork looks as though the summarized region simply vanished.
		display: true,
	};
}

/** Branch summary re-rendered as a /prose block; shared with verbatimCopyOf. */
function branchSummaryBlock(entry: Extract<SessionEntry, { type: "branch_summary" }>): ProseItem {
	return {
		kind: "custom",
		customType: "branch-summary",
		content: `[summary of a branch explored after this point]\n${entry.summary}`,
		display: true,
	};
}

/**
 * Reduce a branch to replayable conversation. Provider bookkeeping and tool
 * results disappear; custom messages and compaction summaries retain the
 * context that a real session would otherwise inject before its first turn.
 */
export function proseOf(
	entries: SessionEntry[],
	keep: Keep,
	spans?: Map<string, ArchiveSpan>,
	artifactId?: string,
	rebasedSpans?: Map<string, ArchiveSpan>,
	/**
	 * Results to pair calls against. Defaults to the ones inside `entries`, which
	 * is right whenever `entries` is the whole region. The ^N trim passes a
	 * whole-branch map instead: a steering turn can split a call (head) from its
	 * result (tail), and without the wider map `resultFor` would synthesize a
	 * "No result recorded" failure for a call that actually succeeded.
	 */
	providedResults?: Map<string, ToolResultMessage>,
): ProseItem[] {
	const results = providedResults ?? resultsOf(entries);
	const out: ProseItem[] = [];
	const push = (message: Message, parts: AssistantPart[]) => {
		if (parts.length === 0) return; // a turn that was purely dropped machinery vanishes
		const previous = out.at(-1);
		// Dropping the tool results between them leaves assistant messages back
		// to back, which providers that require alternating roles reject. Fold
		// each same-role run into one message — except toolResult, where each
		// entry pairs with a distinct toolCallId and must stay its own turn. A
		// custom injection naturally interrupts the run and keeps its place.
		if (
			previous?.kind === "message" &&
			previous.message.role === message.role &&
			message.role !== "toolResult"
		) {
			(previous.message.content as AssistantPart[]).push(...parts);
		} else {
			out.push({ kind: "message", message });
		}
	};

	for (const entry of entries) {
		if (entry.type === "message") {
			const message = entry.message;
			if (message.role === "user") {
				if (message.synthetic) continue; // auto-continue filler, never typed by anyone
				const parts: Part[] = [];
				if (typeof message.content === "string") {
					pushText(parts, rebaseTextArtifactLinks(message.content, artifactId, rebasedSpans));
				} else {
					for (const part of message.content) {
						if (part.type === "text") pushText(parts, rebaseTextArtifactLinks(part.text, artifactId, rebasedSpans));
						else if (part.type === "image") parts.push(part);
					}
				}
				// `steering` makes the agent wrap the text for mid-turn emphasis and
				// `providerPayload` replays transport-native history that no longer
				// belongs to this distilled path.
				push({ ...message, content: parts, steering: undefined, providerPayload: undefined }, parts);
			} else if (message.role === "assistant") {
				if (message.retryRecovery?.status === "recovered") continue; // context rebuilds drop these too
				const { parts, pendingResults } = assistantParts(message, keep, results, spans, artifactId, rebasedSpans);
				const hasToolCalls = parts.some(part => part.type === "toolCall");
				push(
					{
						...message,
						content: parts,
						// A turn that still holds tool calls must advertise toolUse;
						// one whose calls were all traced/erased must not keep a stale
						// toolUse stop that expects results this fork no longer emits.
						stopReason: hasToolCalls ? "toolUse" : message.stopReason === "toolUse" ? "stop" : message.stopReason,
						usage: zeroUsage(message.usage),
						contextSnapshot: undefined,
						providerPayload: undefined,
						toolCallAbortMessages: undefined,
						duration: undefined,
						ttft: undefined,
					},
					parts,
				);
				// Native results follow their assistant immediately — never folded
				// into a neighbouring toolResult, and never deferred past the next
				// assistant (that would orphan the call).
				for (const result of pendingResults) out.push({ kind: "message", message: result });
			}
		} else if (entry.type === "custom_message") {
			// Notes from an earlier /prose are machinery this run supersedes, not
			// conversation. Kept, they stack one pair per generation, describe
			// flags and a trace format that may no longer apply (a `→`-era note
			// beside `ran` lines teaches a convention that does not exist), and
			// leave stale "the conversation is live from here" markers stranded
			// mid-transcript. Drop them; the handler appends a fresh pair.
			if (entry.customType === "prose-note") continue;
			const skillDetails =
				entry.customType === "skill-prompt" && keep.skills !== "full"
					? (entry.details as { name?: string; path?: string; args?: string } | undefined)
					: undefined;
			// A copy distilled by an earlier /prose carries no details to rebuild
			// the line from — pass it through rather than degrade it blind.
			if (skillDetails?.name) {
				out.push({
					kind: "custom",
					// NOT `skill-prompt`: that customType routes the TUI to
					// SkillMessageComponent, which frames the entry exactly like a live
					// invocation — full chrome around a body that is no longer there.
					// A trimmed skill is a /prose artifact, so it renders like the
					// others (`prose-note`, `compaction-summary`): neutral frame, its own
					// name as the badge. customType is display routing only — the model
					// sees `content` either way (agent-core types.ts:186) — so this costs
					// nothing in context and stops the entry impersonating the original.
					customType: "skill-trimmed",
					content: skillLine(skillDetails, keep.skills === "bare" ? "bare" : "brief"),
					display: entry.display,
					// Display-only metadata (never sent to the LLM, session-entries.ts:247):
					// free provenance for anything that later wants the name or path.
					// lineCount is deliberately omitted — the body is trimmed, so the
					// original count would describe text this entry no longer contains.
					details: { name: skillDetails.name, path: skillDetails.path, args: skillDetails.args },
					attribution: entry.attribution,
				});
			} else {
				out.push({
					kind: "custom",
					customType: entry.customType,
					content: typeof entry.content === "string" ? rebaseTextArtifactLinks(entry.content, artifactId, rebasedSpans) : entry.content,
					display: entry.display,
					details: entry.details,
					attribution: entry.attribution,
				});
			}
		} else if (entry.type === "compaction") {
			out.push(compactionBlock(entry));
		} else if (entry.type === "branch_summary") {
			// `/tree` Summary makes this entry the visible replacement for the
			// abandoned tail. Dropping it makes a prose fork look as though the
			// tree navigation never happened.
			out.push(branchSummaryBlock(entry));
		}
	}

	// An assistant message cannot open replayable history, but a custom opener
	// can: real sessions commonly begin with a skill-prompt injection.
	while (out[0]?.kind === "message" && out[0].message.role !== "user") out.shift();
	return out;
}

/**
 * `story` folds the distilled items into ONE user message. Speaker markers are
 * bracketed lines of their own — [@user], [@assistant], [@system <type>] —
 * extending the existing invariant (brackets are /prose's editorial voice)
 * rather than inventing a second convention; a lone marker at line start is
 * also a far rarer collision pattern in real bodies than `@user:` would be.
 * Images survive: the folded message's content is a parts array, so a picture
 * simply splits the text around itself. Native toolCall / toolResult turns
 * cannot live inside a user message, so `full` calls fall back to the text
 * archive form here only.
 */
export function storyFold(items: ProseItem[]): ProseItem[] {
	const parts: Part[] = [];
	let buffer: string[] = [];
	const flush = () => {
		if (buffer.length > 0) {
			pushText(parts, buffer.join("\n\n"));
			buffer = [];
		}
	};
	const resultsById = new Map<string, ToolResultMessage>();
	for (const item of items) {
		if (item.kind === "message" && item.message.role === "toolResult") {
			resultsById.set(item.message.toolCallId, item.message);
		}
	}
	const fold = (marker: string, content: CustomContent | AssistantPart[]) => {
		buffer.push(marker);
		if (typeof content === "string") {
			if (content.trim().length > 0) buffer.push(content);
			return;
		}
		if (!Array.isArray(content)) return;
		for (const part of content) {
			if (part.type === "text") {
				if (part.text.trim().length > 0) buffer.push(part.text);
			} else if (part.type === "image") {
				flush();
				parts.push(part);
			} else if (part.type === "toolCall") {
				const result = resultsById.get(part.id);
				buffer.push(fullCallText(part, result));
				if (result) {
					for (const rp of result.content) {
						if (rp.type === "image") {
							flush();
							parts.push(rp);
						}
					}
				}
			}
		}
	};

	for (const item of items) {
		if (item.kind === "custom") fold(`[@system ${item.customType}]`, item.content);
		else if (item.message.role === "toolResult") continue; // already inlined next to its call
		else if (item.message.role === "user") fold("[@user]", item.message.content as Part[]);
		else fold("[@assistant]", item.message.content as AssistantPart[]);
	}
	flush();
	if (parts.length === 0) return [];
	return [{ kind: "message", message: { role: "user", content: parts, timestamp: Date.now() } }];
}

type ParsedFlags = { keep: Keep; turns?: number; pin?: number; picker?: "turns" | "pin"; unknown?: string };

/**
 * `±tools` sets the level for every tool; `±tools=a,b` overrides those names
 * only. Separate slots, so `-tools +tools=task` parses the same in either
 * order and means "erase the machinery, keep the delegations whole".
 */
const TOOLS_FLAG = /^([+-])tools?(?:=(.+))?$/;

export function parseFlags(args: string): ParsedFlags {
	const keep: Keep = { thinking: false, tools: { default: "trace", byName: new Map() }, skills: "brief", story: false };
	const parsed: ParsedFlags = { keep };
	for (const token of args.trim().split(/\s+/).filter(Boolean)) {
		const tools = TOOLS_FLAG.exec(token);
		if (tools) {
			const level: ToolLevel = tools[1] === "+" ? "full" : "none";
			if (tools[2] === undefined) keep.tools.default = level;
			else for (const name of tools[2].split(",").filter(Boolean)) keep.tools.byName.set(name, level);
		} else if (token === "+think" || token === "+thinking") keep.thinking = true;
		else if (token === "+skills") keep.skills = "full";
		else if (token === "-skills") keep.skills = "bare";
		else if (token === "story") keep.story = true;
		else if (token === "?") parsed.picker = "turns";
		else if (token === "^?") parsed.picker = "pin";
		else if (/^\d+$/.test(token)) {
			parsed.turns = Number(token);
			parsed.pin = undefined;
		} else if (/^\^\d*$/.test(token)) {
			// /pivot's vocabulary: ^N pins the Nth-from-last user turn and keeps it
			// onward; bare ^ means ^1 (keep from your last question). Last token
			// wins between N and ^N, like every other repeated flag here.
			parsed.pin = token.length > 1 ? Number(token.slice(1)) : 1;
			parsed.turns = undefined;
		}
		else return { ...parsed, unknown: token };
	}
	return parsed;
}

function turnStarts(entries: SessionEntry[]): number[] {
	const starts: number[] = [];
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type === "message" && entry.message.role === "user" && !entry.message.synthetic) starts.push(i);
	}
	return starts;
}

/** Indices of the latest `/clear` boundary and the latest compaction, or -1. */
function collapseMarkers(entries: SessionEntry[]): { reset: number; compaction: number } {
	let reset = -1;
	let compaction = -1;
	for (let i = 0; i < entries.length; i++) {
		if (entries[i].type === "reset_boundary") reset = i;
		else if (entries[i].type === "compaction") compaction = i;
	}
	return { reset, compaction };
}

/**
 * Where the host currently starts emitting context, mirroring
 * buildSessionContext (session-context.ts: the reset-boundary branch wins when
 * it is later than the compaction, otherwise the compaction emits its summary
 * plus the tail it kept). Everything before this index is sealed — the model no
 * longer sees it — so an in-place trim must neither distill it (that resurrects
 * collapsed history and grows the context the command exists to shrink) nor
 * silently drop what is still emitted.
 */
function emissionStart(entries: SessionEntry[]): number {
	const { reset, compaction } = collapseMarkers(entries);
	if (reset > compaction) return reset + 1;
	if (compaction < 0) return 0;
	// The kept tail sits before the compaction entry on the path; the entry
	// itself re-renders as a summary block, so starting at the kept tail keeps
	// the whole emitted region.
	const keptId = (entries[compaction] as { firstKeptEntryId?: string }).firstKeptEntryId;
	const kept = keptId === undefined ? -1 : entries.findIndex(entry => entry.id === keptId);
	return kept >= 0 ? Math.min(kept, compaction) : compaction;
}

/**
 * First index a numbered trim may cut at. That form moves the leaf to the cut
 * turn's parent, so cutting at or before a collapse marker takes the marker off
 * the path and re-emits everything it sealed.
 */
function trimFloor(entries: SessionEntry[]): number {
	const { reset, compaction } = collapseMarkers(entries);
	if (reset > compaction) return reset + 1;
	return compaction < 0 ? 0 : compaction + 1;
}

/**
 * Verbatim replay of a kept tail, for the ^N trim. Message and custom_message
 * entries copy unchanged — structuredClone'd, because the manager stores
 * messages by reference and the host mutates entries in place on rewrite
 * paths (session-manager snapshotForReplication).
 *
 * Assistant copies shed their accounting: usage is zeroed (the originals above
 * the reset boundary keep the meter) and `contextSnapshot` is dropped, because
 * it measures a context this copy no longer sits in — serving it would report
 * the pre-trim size. Timestamps are re-stamped separately, by the caller.
 *
 * A leading toolResult whose call sits above the cut is dropped (the distilled
 * head renders that call's real outcome); compaction / branch_summary entries
 * re-render as the same blocks proseOf emits. Every other entry type is
 * session state that stays effective above the reset boundary and copies as
 * nothing. Unlike proseOf, prior prose-notes are kept: their regions are
 * still exactly what they say they are.
 */
export function verbatimCopyOf(entries: SessionEntry[]): ProseItem[] {
	const out: ProseItem[] = [];
	const seenCalls = new Set<string>();
	for (const entry of entries) {
		if (entry.type === "message") {
			const message = structuredClone(entry.message);
			if (message.role === "assistant") {
				for (const part of message.content) if (part.type === "toolCall") seenCalls.add(part.id);
				message.usage = zeroUsage(message.usage);
				message.contextSnapshot = undefined;
			} else if (message.role === "toolResult" && !seenCalls.has(message.toolCallId)) {
				continue;
			}
			out.push({ kind: "message", message });
		} else if (entry.type === "custom_message") {
			out.push({
				kind: "custom",
				customType: entry.customType,
				content: structuredClone(entry.content),
				display: entry.display,
				details: structuredClone(entry.details),
				attribution: entry.attribution,
			});
		} else if (entry.type === "compaction") {
			out.push(compactionBlock(entry));
		} else if (entry.type === "branch_summary") {
			out.push(branchSummaryBlock(entry));
		}
	}
	return out;
}

/**
 * Re-stamp appended assistant copies so they cannot be mistaken for the
 * originals still sitting above the reset boundary.
 *
 * SessionStatsTracker picks the context anchor by scanning the whole branch
 * backwards for an assistant with real usage — a scan that stops at the latest
 * compaction but NOT at a reset boundary. Post-boundary copies are zero-usage
 * and get skipped, so the anchor lands on a pre-boundary original. It then
 * locates that anchor in the active window by identity and, failing that, by
 * matching `timestamp` — which a verbatim copy still carries. The match
 * succeeds, and the trimmed session reports the untrimmed context size:
 * measured 90k tokens reported against ~7 tokens of real context, which also
 * misleads the auto-compaction threshold.
 *
 * Shifting each copy past every timestamp already on the branch breaks that
 * false match (milliseconds, so displayed times are unchanged). The breakdown
 * then falls back to estimation until the next real turn re-anchors it.
 */
function retimeAssistants(items: ProseItem[], taken: Set<number>): void {
	for (const item of items) {
		if (item.kind !== "message" || item.message.role !== "assistant") continue;
		const original = item.message.timestamp;
		if (typeof original !== "number") continue;
		let stamp = original;
		while (taken.has(stamp)) stamp++;
		taken.add(stamp);
		item.message.timestamp = stamp;
	}
}

/** First ~70 characters of a user's text, for a one-line picker entry. */
function previewOf(content: unknown): string {
	const parts: string[] = [];
	if (typeof content === "string") parts.push(content);
	else if (Array.isArray(content)) {
		for (const part of content) {
			if (part && typeof part === "object" && "text" in part && typeof part.text === "string") parts.push(part.text);
		}
	}
	const flat = parts.join(" ").replace(/\s+/g, " ").trim();
	if (!flat) return "(no text)";
	return flat.length > 70 ? `${flat.slice(0, 69)}…` : flat;
}

interface WritableSession {
	branch(entryId: string): void;
	/** The /clear marker: context emission restarts after it; history above stays on the branch. */
	appendResetBoundary(): string;
	appendMessage(message: Message): string;
	appendCustomMessageEntry<T = unknown>(
		customType: string | undefined,
		content: string | (TextContent | ImageContent)[] | undefined,
		display: boolean | undefined,
		details?: T,
		attribution?: MessageAttribution,
	): string;
	/** A fresh session refuses to touch disk until its history contains an
	 *  ASSISTANT message (#shouldHaveSessionFile — anti-litter for empty /new).
	 *  A story fork appends only a note + one USER message, so every write
	 *  no-ops, and the reload()'s setSessionFile() then finds no file and
	 *  re-mints an empty session over the path (observed live: fork files whose
	 *  header id no longer matched their own filename). ensureOnDisk() is the
	 *  documented escape hatch — "ACP session/new, handoff" — crossing the lazy
	 *  gate so every entry persists; flush() then drains what is pending. */
	ensureOnDisk(): Promise<void>;
	flush(): Promise<void>;
}

/**
 * The four casts below resolve against this. `ReadonlySessionManager` is a
 * compile-time Pick; the runtime object is the full SessionManager, on which
 * every one of these members is public API (same stance as pivot.ts). The
 * artifact members stay optional: hosts without artifact storage degrade to
 * no archive rather than a crash.
 */
type SessionManagerWithArtifacts = WritableSession & {
	saveArtifact?(content: string, type?: string): Promise<string>;
	getArtifactsDir?(): string | null;
};

function appendItems(sessionManager: WritableSession, items: ProseItem[]): void {
	for (const item of items) {
		if (item.kind === "message") sessionManager.appendMessage(item.message);
		else
			sessionManager.appendCustomMessageEntry(
				item.customType,
				item.content,
				item.display,
				item.details,
				item.attribution,
			);
	}
}

/** Keep persisted and transient recovery hints on omp's documented flag. */
const resumeCommand = (sessionId: string): string => `omp --resume ${sessionId}`;

/**
 * The framing entry that opens every distilled region. Traces of tool calls
 * sit inside assistant messages, which is exactly where a model could learn
 * to imitate them as text instead of calling tools — so, like compaction's
 * summary banner, the region defines its own artifacts before the model
 * meets them, and names where the unabridged record lives.
 */
function proseNote(keep: Keep, original: string, artifactId?: string): ProseItem {
	const levels = levelsUsed(keep.tools);
	const recoverSyntax = artifactId ? "; recover: artifact://…" : "";
	const traces = levels.has("trace")
		? ` Lines formatted as [${TRACE_PREFIX}tool target${recoverSyntax}] are records of tool calls that already ran. To act, ALWAYS invoke a real tool through the tool interface — writing a [${TRACE_PREFIX}…] line as text does nothing and fabricates history.`
		: "";
	const full = levels.has("full")
		? keep.story
			? ` A call kept whole appears as [${TRACE_PREFIX}tool] followed by verbatim [args]…[/args] and [result]…[/result] blocks inside the story — a record of what already ran, never a template to write out.`
			: ` Tool calls kept whole remain native toolCall / toolResult turns (arguments and output verbatim). They are history that already ran — continue by invoking real tools through the tool interface, not by writing tool JSON into the message.`
		: "";
	// WORDING IS LOAD-BEARING — do not restore the earlier phrasing ("Reasoning
	// survives verbatim … the internal monologue that produced the reply").
	// That sentence alone triggers Anthropic's `reasoning_extraction` refusal:
	// measured on a 2K-token fork, 2/2 refusals with it, 2/2 passes with only
	// that sentence removed, and 2/2 passes with this phrasing. The markers are
	// innocent (renaming them still refused; keeping them with this wording
	// passes), and preserved reasoning content is innocent too (a real
	// [thinking] block with no such sentence passed 2/2). Describe the markers;
	// never advertise that the model's reasoning is reproduced.
	const think = keep.thinking
		? " Text between [thinking]…[/thinking] markers is working context for the reply, not part of it."
		: "";
	const story = keep.story
		? " The entire exchange is folded into the single message that follows; bracketed markers [@user], [@assistant], and [@system …] label who actually spoke."
		: "";
	const archiveNote = artifactId ? `, with discarded tool outputs archived in artifact://${artifactId}` : "";
	return {
		kind: "custom",
		customType: "prose-note",
		content: `[The conversation from this point on was distilled by /prose: provider bookkeeping and everything not kept below were removed — the prose itself is verbatim.${traces}${full}${think}${story} The unabridged original is ${original}${archiveNote}.]`,
		display: true,
	};
}

/**
 * Closes the distilled region. Recency is the mechanism: the head note's
 * imperative failed at 40k tokens' distance, so the positive rule is restated
 * at the exact seam where the live conversation resumes.
 */
function proseTail(keep: Keep, nativeTailFollows = false): ProseItem {
	const levels = levelsUsed(keep.tools);
	const traces = levels.has("trace") || (levels.has("full") && keep.story)
		? ` — never by writing [${TRACE_PREFIX.trim()} …] lines as text`
		: levels.has("full")
			? ` — never by pasting toolCall / toolResult JSON into the message`
			: "";
	const seam = nativeTailFollows
		? "the turns below are the original conversation from the kept turn onward, verbatim"
		: "the conversation is live from here";
	return {
		kind: "custom",
		customType: "prose-note",
		content: `[End of distilled history; ${seam}. To act, ALWAYS make real tool calls${traces}.]`,
		display: true,
	};
}

export default function proseExtension(pi: ExtensionAPI) {
	let autocompleteWrapped = false;
	let branchSource: ReadonlySessionManager | undefined;

	const adopt = (ctx: { sessionManager: ReadonlySessionManager; ui: ExtensionUIContext }) => {
		branchSource = ctx.sessionManager;
		if (autocompleteWrapped) return;
		autocompleteWrapped = true;
		// Extension commands cannot declare `inlineHint` the way builtins do —
		// interactive-mode maps only name/description/getArgumentCompletions onto
		// the TUI's SlashCommand — so the ghost text has to come from wrapping the
		// editor's provider. Delegate through bound methods: the real provider is
		// a class instance whose methods touch private fields, so neither a spread
		// nor Object.create() would survive being called.
		ctx.ui.addAutocompleteProvider(current => ({
			getSuggestions: current.getSuggestions.bind(current),
			applyCompletion: current.applyCompletion.bind(current),
			trySyncSlashCompletion: current.trySyncSlashCompletion?.bind(current),
			trySyncInlineReplace: current.trySyncInlineReplace?.bind(current),
			getForceFileSuggestions: current.getForceFileSuggestions?.bind(current),
			shouldTriggerFileCompletion: current.shouldTriggerFileCompletion?.bind(current),
			getInlineHint: (lines, cursorLine, cursorCol) => {
				const typed = /^\s*\/prose\s+(.*)$/.exec((lines[cursorLine] ?? "").slice(0, cursorCol));
				if (!typed) return current.getInlineHint?.(lines, cursorLine, cursorCol) ?? null;
				return typed[1].length === 0 ? PROSE_HINT : null;
			},
		}));
	};

	pi.on("session_start", (_event, ctx) => adopt(ctx));
	pi.on("session_switch", (_event, ctx) => adopt(ctx));

	pi.registerCommand("prose", {
		description: "[N|^N|?] [story ±tools[=a,b] ±skills +think] — fork; N distills recent turns in place; ^N keeps them and distills the rest",
		// Offered only once a flag is being typed. An empty argument deliberately
		// yields nothing: an open dropdown suppresses the editor's inline hint
		// (it prefers the selected item's own `hint`), and the hint is what
		// advertises this syntax in the first place.
		getArgumentCompletions: (argumentPrefix: string): AutocompleteItem[] | null => {
			if (argumentPrefix.startsWith("^") && !/\s/.test(argumentPrefix)) {
				// Mirror /pivot: each ^N entry previews the turn it would keep from.
				const branchEntries = branchSource?.getBranch() ?? [];
				// Same window the handler addresses: never offer a turn sealed behind
				// a /clear boundary or a compaction.
				const pinFloor = emissionStart(branchEntries);
				const pinItems = turnStarts(branchEntries)
					.filter(index => index >= pinFloor)
					.slice(0, PICKER_LIMIT)
					.map((start, i) => {
						const entry = branchEntries[start];
						return {
							value: `^${i + 1}`,
							label: `^${i + 1}`,
							description:
								entry.type === "message" && "content" in entry.message ? previewOf(entry.message.content) : "(no text)",
						};
					});
				const pinMatches = [
					{ value: "^?", label: "^?", description: "pick the kept turn from a list" },
					...pinItems,
				].filter(item => item.value.startsWith(argumentPrefix));
				return pinMatches.length > 0 ? pinMatches : null;
			}
			const isFlag = argumentPrefix.startsWith("+") || argumentPrefix.startsWith("-");
			const isStory = argumentPrefix.length > 0 && "story".startsWith(argumentPrefix);
			if (!isFlag && !isStory) return null;
			const items: AutocompleteItem[] = [
				{
					value: "+tools",
					label: "+tools",
					description: "keep tool calls and results verbatim (+tools=read,edit for some)",
				},
				{ value: "-tools", label: "-tools", description: "erase tool calls (-tools=bash for some); default traces all" },
				{ value: "+skills", label: "+skills", description: "keep skill bodies verbatim" },
				{ value: "-skills", label: "-skills", description: "skill invocations shrink to name + prompt" },
				{ value: "+think", label: "+think", description: "keep readable reasoning in [thinking]…[/thinking]" },
				{
					value: "story",
					label: "story",
					description: "fold everything into one user message with [@user]/[@assistant] markers",
				},
			];
			const matches = items.filter(item => item.value.startsWith(argumentPrefix));
			return matches.length > 0 ? matches : null;
		},
		handler: async (args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Prose needs an idle agent.", "warning");
				return;
			}

			const parsed = parseFlags(args);
			if (parsed.unknown !== undefined) {
				ctx.ui.notify(`Unknown option \`${parsed.unknown}\`. /prose takes N, ^N, ?, ^?, story, ±tools[=a,b], ±skills, and +think.`, "warning");
				return;
			}

			const entries = ctx.sessionManager.getBranch();
			const allStarts = turnStarts(entries);
			let turns = parsed.turns;
			let pin = parsed.pin;
			// Only turns the host still emits are addressable: history sealed by a
			// `/clear` boundary or a compaction must stay sealed, in either form.
			const windowStart = emissionStart(entries);
			const pinMode = pin !== undefined || parsed.picker === "pin";
			const floor = pinMode ? windowStart : trimFloor(entries);
			const starts = allStarts.filter(index => index >= floor);
			const sealed = starts.length < allStarts.length ? " reachable (history before the last /clear or compaction is sealed)" : " on this branch";
			if (parsed.picker) {
				// Current hosts expose this on the command context; accepting it on
				// ui as well keeps the guard honest for UI adapters that own it.
				const hasUI = "hasUI" in ctx.ui ? Boolean(ctx.ui.hasUI) : ctx.hasUI;
				if (!hasUI) {
					ctx.ui.notify("No interactive UI — pass a number", "warning");
					return;
				}
				const options = starts.slice(0, PICKER_LIMIT).map((start, i) => {
					const entry = entries[start];
					return {
						label: String(i + 1),
						description:
							entry.type === "message" && "content" in entry.message ? previewOf(entry.message.content) : "(no text)",
					};
				});
				const picked = await ctx.ui.select(
					parsed.picker === "pin"
						? "Keep from which turn onward? (everything before it gets distilled)"
						: "Distill from which turn onward?",
					options,
				);
				if (picked === undefined) return;
				if (parsed.picker === "pin") pin = Number.parseInt(picked, 10);
				else turns = Number.parseInt(picked, 10);
			}

			if (pin !== undefined) {
				if (!Number.isInteger(pin) || pin < 1 || pin > starts.length) {
					ctx.ui.notify(`only ${starts.length} turn(s)${sealed}`, "warning");
					return;
				}
				const cut = starts[pin - 1];
				if (cut === windowStart) {
					ctx.ui.notify("Nothing before that turn — it already opens the active context.", "warning");
					return;
				}
				const head = entries.slice(windowStart, cut);
				const tail = entries.slice(cut);
				if (parsed.keep.thinking && !hasReadableThinking(head)) {
					ctx.ui.notify("+think: the distilled region stored no readable reasoning (encrypted by the provider).", "warning");
				}

				// Same cast stance as the numbered branch below: the runtime object is
				// the full SessionManager and every member used here is public API.
				const sm = ctx.sessionManager as unknown as SessionManagerWithArtifacts;
				if (typeof sm.ensureOnDisk === "function") {
					await sm.ensureOnDisk();
				}
				const sourceArtifactsDir = typeof sm.getArtifactsDir === "function" ? sm.getArtifactsDir() : null;
				// One whole-branch result map for both consumers: a head call whose
				// result landed below the cut must render its real outcome, not a
				// synthesized failure. verbatimCopyOf then drops that now-duplicated
				// result from the tail copy.
				const branchResults = resultsOf(entries);
				const archive = buildProseArchive(head, parsed.keep, branchResults, sourceArtifactsDir);
				let artifactId: string | undefined;
				if (archive.itemCount > 0 && typeof sm.saveArtifact === "function") {
					try {
						artifactId = await sm.saveArtifact(archive.content, "prose");
					} catch {
						artifactId = undefined;
					}
				}

				const headItems = proseOf(
					head,
					parsed.keep,
					archive.spansByCallId,
					artifactId,
					archive.rebasedSpans,
					branchResults,
				);
				if (headItems.length === 0) {
					ctx.ui.notify("Nothing to distill before that turn.", "warning");
					return;
				}

				// First mutation only after every input above validated and built. The
				// boundary is the /clear marker: context emission restarts after it
				// while state entries (model, thinking level, tier, mode, TTSR) above
				// it stay effective, and the original turns stay on this branch.
				sm.appendResetBoundary();
				const appended = [
					proseNote(parsed.keep, "this session's history above the boundary (/tree reaches it)", artifactId),
					...(parsed.keep.story ? storyFold(headItems) : headItems),
					proseTail(parsed.keep, true),
					...verbatimCopyOf(tail),
				];
				// The originals stay on this branch above the boundary, so every
				// appended assistant needs a timestamp none of them already owns.
				const takenStamps = new Set<number>();
				for (const entry of entries) {
					if (entry.type === "message" && entry.message.role === "assistant" && typeof entry.message.timestamp === "number") {
						takenStamps.add(entry.message.timestamp);
					}
				}
				retimeAssistants(appended, takenStamps);
				appendItems(sm, appended);
				await sm.flush();
				await ctx.reload();
				ctx.ui.notify(
					`Trimmed in place: everything before your last ${pin === 1 ? "turn" : `${pin} turns`} distilled${artifactId ? ` (archived in artifact://${artifactId})` : ""} — the kept turns stay verbatim; full history above the boundary (/tree).`,
					"info",
				);
				return;
			}

			if (turns !== undefined) {
				if (!Number.isInteger(turns) || turns < 1 || turns > starts.length) {
					ctx.ui.notify(`only ${starts.length} turn(s)${sealed}`, "warning");
					return;
				}
				const cut = starts[turns - 1];
				const turnEntry = entries[cut];
				if (!turnEntry.parentId) {
					ctx.ui.notify("That covers the whole conversation — use bare /prose to fork it.", "warning");
					return;
				}
				const slice = entries.slice(cut);
				// Most providers hand back encrypted reasoning, which persists as an
				// empty `thinking` beside its signature. `+think` can only keep what
				// was actually stored, so say so rather than silently dropping it.
				if (parsed.keep.thinking && !hasReadableThinking(slice)) {
					ctx.ui.notify("+think: this branch stored no readable reasoning (encrypted by the provider).", "warning");
				}

				// ReadonlySessionManager is a compile-time Pick<SessionManager,...>;
				// the runtime object IS the full manager, and these methods are public
				// API on it. Observed contract (same stance as pivot.ts); if a future
				// omp hands out a true read-only wrapper this fails loudly — the
				// desired failure mode.
				const sm = ctx.sessionManager as unknown as SessionManagerWithArtifacts;
				if (typeof sm.ensureOnDisk === "function") {
					await sm.ensureOnDisk();
				}

				const sourceSm = ctx.sessionManager as unknown as SessionManagerWithArtifacts;
				const sourceArtifactsDir = typeof sourceSm.getArtifactsDir === "function" ? sourceSm.getArtifactsDir() : null;
				const archive = buildProseArchive(slice, parsed.keep, resultsOf(slice), sourceArtifactsDir);
				let artifactId: string | undefined;
				if (archive.itemCount > 0 && typeof sm.saveArtifact === "function") {
					try {
						artifactId = await sm.saveArtifact(archive.content, "prose");
					} catch {
						artifactId = undefined;
					}
				}

				const items = proseOf(slice, parsed.keep, archive.spansByCallId, artifactId, archive.rebasedSpans);
				if (items.length === 0) {
					ctx.ui.notify("Nothing to distill: no conversation on this branch.", "warning");
					return;
				}

				// Move the leaf only once every fallible step above has succeeded. It
				// used to move first, so an archive throw or an empty distillation
				// returned with the session silently re-pointed at the parent, nothing
				// appended, and no reload.
				sm.branch(turnEntry.parentId);
				appendItems(sm, [
					proseNote(parsed.keep, "the sibling branch (/tree)", artifactId),
					...(parsed.keep.story ? storyFold(items) : items),
					proseTail(parsed.keep),
				]);
				await sm.flush();
				await ctx.reload();
				ctx.ui.notify(
					`Branched off in place: last ${turns} turn(s) distilled${parsed.keep.story ? " into one story message" : ""}${artifactId ? ` (archived in artifact://${artifactId})` : ""} — the full journey stays on the sibling branch (/tree to compare).`,
					"info",
				);
				return;
			}
			if (parsed.keep.thinking && !hasReadableThinking(entries)) {
				ctx.ui.notify("+think: this branch stored no readable reasoning (encrypted by the provider).", "warning");
			}

			const preliminaryItems = proseOf(entries, parsed.keep);
			if (preliminaryItems.length === 0) {
				ctx.ui.notify("Nothing to distill: no conversation on this branch.", "warning");
				return;
			}

			// The header link is what keeps the original reachable, so it has to be
			// the source session's own file — read before newSession() rebinds the
			// (mutable, reused) SessionManager to the fork. Same for the id: it is
			// the only handle that survives as a runnable command, so both the
			// user-facing notice and the in-fork note quote it verbatim.
			const sourceFile = ctx.sessionManager.getSessionFile();
			const sourceTitle = ctx.sessionManager.getSessionName();
			const sourceId = ctx.sessionManager.getSessionId();
			const sourceSm = ctx.sessionManager as unknown as SessionManagerWithArtifacts;
			const sourceArtifactsDir = typeof sourceSm.getArtifactsDir === "function" ? sourceSm.getArtifactsDir() : null;

			const archive = buildProseArchive(entries, parsed.keep, resultsOf(entries), sourceArtifactsDir);
			let messageCount = 0;

			const { cancelled } = await ctx.newSession({
				parentSession: sourceFile,
				setup: async sessionManager => {
					const destSm = sessionManager as unknown as SessionManagerWithArtifacts;
					// The reload below re-reads the file this setup just wrote into.
					// Ensure on disk first so the artifacts directory is initialized.
					if (typeof destSm.ensureOnDisk === "function") {
						await destSm.ensureOnDisk();
					}

					let artifactId: string | undefined;
					if (archive.itemCount > 0 && typeof destSm.saveArtifact === "function") {
						try {
							artifactId = await destSm.saveArtifact(archive.content, "prose");
						} catch {
							artifactId = undefined;
						}
					}

					const items = proseOf(entries, parsed.keep, archive.spansByCallId, artifactId, archive.rebasedSpans);
					messageCount = items.filter(item => item.kind === "message").length;
					appendItems(sessionManager, [
						proseNote(parsed.keep, `the parent session (${resumeCommand(sourceId)})`, artifactId),
						...(parsed.keep.story ? storyFold(items) : items),
						proseTail(parsed.keep),
					]);
					if (sourceTitle) await sessionManager.setSessionName(`${sourceTitle} · ${parsed.keep.story ? "story" : "prose"}`);
					await sessionManager.flush();
				},
			});
			if (cancelled) return;

			// newSession() resets the transcript and paints its own banner without
			// rendering the entries setup() just wrote; reload repaints from the
			// session file so the conversation is actually visible in the fork.
			await ctx.reload();
			// Echo back exactly what was parsed, blanket level and named overrides
			// alike: the two forms compose, so reporting only one would misdescribe
			// a `-tools +tools=task` fork.
			const toolFlags = (level: ToolLevel, sign: string) => {
				const named = [...parsed.keep.tools.byName].filter(([, set]) => set === level).map(([name]) => name);
				return [parsed.keep.tools.default === level && `${sign}tools`, named.length > 0 && `${sign}tools=${named.join(",")}`];
			};
			const flags = [
				parsed.keep.thinking && "+think",
				...toolFlags("full", "+"),
				...toolFlags("none", "-"),
				parsed.keep.skills === "full" && "+skills",
				parsed.keep.skills === "bare" && "-skills",
			]
				.filter(Boolean)
				.join(" ");
			const flagsSuffix = flags ? ` (${flags})` : "";
			const archiveSuffix = archive.itemCount > 0 ? " with artifact recovery" : "";
			ctx.ui.notify(
				`Forked ${messageCount} messages into a ${parsed.keep.story ? "single-message story" : "prose-only"} session${flagsSuffix}${archiveSuffix} — \`${resumeCommand(sourceId)}\` to get back.`,
				"info",
			);
		}
	});
}
