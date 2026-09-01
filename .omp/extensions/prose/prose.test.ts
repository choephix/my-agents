import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, SessionEntry } from "@oh-my-pi/pi-coding-agent";
import type { ToolResultMessage } from "@oh-my-pi/pi-ai";
import proseExtension, { buildProseArchive, parseFlags, proseOf, verbatimCopyOf } from "./prose";

const SOURCE_ID = "01998f2c-0f5b-7c1e-9a41-1b3d5f7a9c02";

/** Two turns: enough that `proseOf` yields a message and the fork is real. */
const branchEntries = [
	{
		type: "message",
		id: "e1",
		parentId: undefined,
		timestamp: "2026-08-14T10:00:00.000Z",
		message: { role: "user", content: "why is the build slow?" },
	},
	{
		type: "message",
		id: "e2",
		parentId: "e1",
		timestamp: "2026-08-14T10:00:05.000Z",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "The bundler re-reads every file." }],
			stopReason: "stop",
			usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 },
		},
	},
] as unknown as SessionEntry[];

const branchWithTools = [
	{
		type: "message",
		id: "m1",
		parentId: undefined,
		timestamp: "2026-08-14T10:00:00.000Z",
		message: { role: "user", content: "check config and test" },
	},
	{
		type: "message",
		id: "m2",
		parentId: "m1",
		timestamp: "2026-08-14T10:00:05.000Z",
		message: {
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "call_read1",
					name: "read",
					arguments: { path: "package.json" },
				},
				{
					type: "toolCall",
					id: "call_read2",
					name: "read",
					arguments: { path: "package.json" },
				},
				{
					type: "toolCall",
					id: "call_bash1",
					name: "bash",
					arguments: { command: "npm test" },
				},
				{
					type: "text",
					text: "All 12 tests passed successfully.",
				},
			],
			stopReason: "toolUse",
			usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120 },
		},
	},
	{
		type: "message",
		id: "m3",
		parentId: "m2",
		timestamp: "2026-08-14T10:00:06.000Z",
		message: {
			role: "toolResult",
			toolCallId: "call_read1",
			toolName: "read",
			content: [{ type: "text", text: '{\n  "name": "my-project",\n  "version": "1.0.0"\n}' }],
		},
	},
	{
		type: "message",
		id: "m4",
		parentId: "m3",
		timestamp: "2026-08-14T10:00:07.000Z",
		message: {
			role: "toolResult",
			toolCallId: "call_read2",
			toolName: "read",
			content: [{ type: "text", text: '{\n  "name": "my-project",\n  "version": "1.0.0"\n}' }],
		},
	},
	{
		type: "message",
		id: "m5",
		parentId: "m4",
		timestamp: "2026-08-14T10:00:08.000Z",
		message: {
			role: "toolResult",
			toolCallId: "call_bash1",
			toolName: "bash",
			content: [{ type: "text", text: "PASS test/index.test.ts\nTests: 12 passed, 12 total" }],
		},
	},
] as unknown as SessionEntry[];

type CommandHandler = (args: string, ctx: unknown) => Promise<void>;

interface RunProseOptions {
	entries?: SessionEntry[];
	saveArtifactSupported?: boolean;
	saveArtifactReturnsId?: string;
}

/** Drive the real `/prose` handler over fake host surfaces, collecting the two
 *  places it speaks: `ui.notify` and the entries appended into the fork. */
async function runProse(args: string, options: RunProseOptions = {}): Promise<{ notices: string[]; forkEntries: string[]; liveEntries: unknown[]; branchCalls: string[]; savedArtifacts: Array<{ content: string; type: string }> }> {
	let handler: CommandHandler | undefined;
	const pi = {
		on: () => {},
		registerCommand: (_name: string, command: { handler: CommandHandler }) => {
			handler = command.handler;
		},
	} as unknown as ExtensionAPI;
	proseExtension(pi);
	if (!handler) throw new Error("/prose did not register a command");

	const notices: string[] = [];
	const forkEntries: string[] = [];
	// Entries appended to the LIVE manager (the ^N trim writes here, never to a fork).
	const liveEntries: unknown[] = [];
	// Leaf moves requested by the numbered path: ordering against appends matters.
	const branchCalls: string[] = [];
	const savedArtifacts: Array<{ content: string; type: string }> = [];
	const collect = (content: unknown) => {
		forkEntries.push(typeof content === "string" ? content : JSON.stringify(content));
		return "appended";
	};
	const forkManager = {
		appendMessage: collect,
		appendCustomMessageEntry: (_customType: unknown, content: unknown) => collect(content),
		setSessionName: async () => {},
		ensureOnDisk: async () => {},
		flush: async () => {},
		...(options.saveArtifactSupported !== false
			? {
					saveArtifact: async (content: string, type: string) => {
						savedArtifacts.push({ content, type });
						return options.saveArtifactReturnsId ?? "1";
					},
			  }
			: {}),
	};
	const currentEntries = options.entries ?? branchEntries;
	const ctx = {
		isIdle: () => true,
		hasUI: false,
		ui: { notify: (message: string) => notices.push(message) },
		sessionManager: {
			appendResetBoundary: () => {
				liveEntries.push("[reset_boundary]");
				return "rb";
			},
			appendMessage: (message: unknown) => {
				liveEntries.push(message);
				return "appended";
			},
			appendCustomMessageEntry: (customType: unknown, content: unknown) => {
				liveEntries.push({ customType, content });
				return "appended";
			},
			getBranch: () => currentEntries,
			getSessionFile: () => "/sessions/source.jsonl",
			getSessionName: () => "build triage",
			getSessionId: () => SOURCE_ID,
			branch: (entryId: string) => branchCalls.push(entryId),
			flush: async () => {},
			ensureOnDisk: async () => {},
			saveArtifact: async (content: string, type: string) => {
				savedArtifacts.push({ content, type });
				return options.saveArtifactReturnsId ?? "1";
			},
		},
		newSession: async (opts: { setup: (manager: unknown) => Promise<void> }) => {
			await opts.setup(forkManager);
			return { cancelled: false };
		},
		reload: async () => {},
	};

	await handler(args, ctx);
	return { notices, forkEntries, liveEntries, branchCalls, savedArtifacts };
}

describe("bare /prose", () => {
	test("hands back the source session id as a runnable resume command", async () => {
		const { notices, forkEntries } = await runProse("");

		const returnHint = `omp --resume ${SOURCE_ID}`;
		expect(notices.some(notice => notice.includes(returnHint))).toBe(true);
		// The note that opens the fork names the same handle, so the pointer
		// survives after the notification scrolls away.
		expect(forkEntries.some(entry => entry.includes(returnHint))).toBe(true);
		// `--session` resolves only as an undocumented alias; never emit it.
		expect([...notices, ...forkEntries].some(text => text.includes("omp --session"))).toBe(false);
	});

	test("refuses to fork when there is nothing to distill", async () => {
		let newSessionCalled = false;
		const ctx = {
			isIdle: () => true,
			hasUI: false,
			ui: { notify: (msg: string) => notices.push(msg) },
			sessionManager: {
				getBranch: () => [],
				getSessionFile: () => "/sessions/source.jsonl",
				getSessionName: () => "empty",
				getSessionId: () => SOURCE_ID,
			},
			newSession: async () => {
				newSessionCalled = true;
				return { cancelled: false };
			},
			reload: async () => {},
		};
		const notices: string[] = [];
		const pi = {
			on: () => {},
			registerCommand: (_name: string, command: { handler: CommandHandler }) => {
				void command.handler("", ctx);
			},
		} as unknown as ExtensionAPI;
		proseExtension(pi);

		expect(newSessionCalled).toBe(false);
		expect(notices.some(n => n.includes("Nothing to distill"))).toBe(true);
	});
});
describe("artifact-backed prose recovery", () => {
	test("buildProseArchive records exact line spans and formats tool details", () => {
		const keep = parseFlags("").keep;
		const results = new Map<string, ToolResultMessage>([
			[
				"call_read1",
				{
					role: "toolResult",
					toolCallId: "call_read1",
					toolName: "read",
					content: [{ type: "text", text: '{\n  "name": "my-project"\n}' }],
				} as ToolResultMessage,
			],
			[
				"call_read2",
				{
					role: "toolResult",
					toolCallId: "call_read2",
					toolName: "read",
					content: [{ type: "text", text: '{\n  "name": "my-project"\n}' }],
				} as ToolResultMessage,
			],
			[
				"call_bash1",
				{
					role: "toolResult",
					toolCallId: "call_bash1",
					toolName: "bash",
					content: [{ type: "text", text: "PASS test" }],
				} as ToolResultMessage,
			],
		]);

		const archive = buildProseArchive(branchWithTools, keep, results);
		expect(archive.itemCount).toBe(3);
		expect(archive.spansByCallId.has("call_read1")).toBe(true);
		expect(archive.spansByCallId.has("call_read2")).toBe(true);
		expect(archive.spansByCallId.has("call_bash1")).toBe(true);

		const read1Span = archive.spansByCallId.get("call_read1")!;
		const read2Span = archive.spansByCallId.get("call_read2")!;
		const bash1Span = archive.spansByCallId.get("call_bash1")!;

		expect(read1Span.startLine).toBeGreaterThan(0);
		expect(read1Span.endLine).toBeGreaterThanOrEqual(read1Span.startLine);
		expect(read2Span.startLine).toBeGreaterThan(read1Span.endLine);
		expect(bash1Span.startLine).toBeGreaterThan(read2Span.endLine);

		const archiveLines = archive.content.split("\n");
		expect(archiveLines[read1Span.startLine - 1]).toContain("### [1] read package.json");
		expect(archiveLines[read2Span.startLine - 1]).toContain("### [2] read package.json");
		expect(archiveLines[bash1Span.startLine - 1]).toContain("### [3] bash npm test");
	});
	test("proseOf emits exact line-range recovery links and collapses spans for consecutive calls", () => {
		const keep = parseFlags("").keep;
		const spans = new Map([
			["call_read1", { startLine: 3, endLine: 12 }],
			["call_read2", { startLine: 14, endLine: 23 }],
			["call_bash1", { startLine: 25, endLine: 35 }],
		]);

		const items = proseOf(branchWithTools, keep, spans, "42");
		const assistant = items.find(
			item => item.kind === "message" && item.message.role === "assistant",
		);
		expect(assistant).toBeDefined();
		if (assistant && assistant.kind === "message") {
			const content = assistant.message.content as Array<{ type: string; text?: string }>;
			const textPart = content.find(p => p.type === "text")?.text ?? "";
			// Consecutive read calls are collapsed (×2) and their line range spans from call_read1 start to call_read2 end (3-23)
			expect(textPart).toContain("[ran read package.json ×2; recover: artifact://42:3-23]");
			expect(textPart).toContain("[ran bash npm test; recover: artifact://42:25-35]");
		}
	});

	test("preserves byte-verbatim code with leading tabs and whitespace in archive", () => {
		const codeSnippet = 'export function f() {\n\tif (x) {\n\t\treturn "  spaced  ";\n\t}\n}';
		const entries = [
			{
				type: "message",
				id: "v1",
				parentId: undefined,
				message: { role: "user", content: "read f.ts" },
			},
			{
				type: "message",
				id: "v2",
				parentId: "v1",
				message: {
					role: "assistant",
					content: [{ type: "toolCall", id: "c1", name: "read", arguments: { path: "f.ts" } }],
				},
			},
		] as unknown as SessionEntry[];

		const results = new Map<string, ToolResultMessage>([
			[
				"c1",
				{
					role: "toolResult",
					toolCallId: "c1",
					toolName: "read",
					content: [{ type: "text", text: codeSnippet }],
				} as ToolResultMessage,
			],
		]);

		const keep = parseFlags("").keep;
		const archive = buildProseArchive(entries, keep, results);
		const span = archive.spansByCallId.get("c1")!;
		const lines = archive.content.split("\n");
		const recovered = lines.slice(span.startLine - 1, span.endLine).join("\n");

		expect(recovered).toContain(codeSnippet);
	});
	test("proseExtension saves archive to destination session and injects recovery links", async () => {
		const { forkEntries, savedArtifacts, notices } = await runProse("", {
			entries: branchWithTools,
			saveArtifactReturnsId: "7",
		});

		expect(savedArtifacts.length).toBe(1);
		expect(savedArtifacts[0].type).toBe("prose");
		expect(savedArtifacts[0].content).toContain("### [1] read package.json");
		expect(savedArtifacts[0].content).toContain("### [3] bash npm test");

		const assistantEntry = forkEntries.find(e => e.includes("All 12 tests passed"));
		expect(assistantEntry).toBeDefined();
		expect(assistantEntry).toContain("[ran read package.json ×2; recover: artifact://7:");
		expect(assistantEntry).toContain("[ran bash npm test; recover: artifact://7:");
		expect(notices.some(n => n.includes("with artifact recovery"))).toBe(true);
	});

	test("gracefully degrades when artifact saving is unsupported", async () => {
		const { forkEntries, savedArtifacts } = await runProse("", {
			entries: branchWithTools,
			saveArtifactSupported: false,
		});

		expect(savedArtifacts.length).toBe(0);
		const assistantEntry = forkEntries.find(e => e.includes("All 12 tests passed"));
		expect(assistantEntry).toBeDefined();
		expect(assistantEntry).toContain("[ran read package.json ×2]");
		expect(assistantEntry).not.toContain("; recover: artifact://");
	});

	test("numbered /prose N branches off in place and attaches artifact recovery links", async () => {
		let branchedParentId: string | undefined;
		let flushed = false;
		const notices: string[] = [];
		const appended: unknown[] = [];
		const multiTurnBranch = [
			{
				type: "message",
				id: "turn0_user",
				message: { role: "user", content: "initial turn" },
			},
			{
				type: "message",
				id: "turn0_assistant",
				parentId: "turn0_user",
				message: { role: "assistant", content: [{ type: "text", text: "initial reply" }] },
			},
			...branchWithTools.map(e => ({
				...e,
				parentId: e.parentId ?? "turn0_assistant",
			})),
		] as unknown as SessionEntry[];

		const sm = {
			getBranch: () => multiTurnBranch,
			getSessionFile: () => "/sessions/source.jsonl",
			getSessionName: () => "build triage",
			getSessionId: () => SOURCE_ID,
			branch: (parentId: string) => {
				branchedParentId = parentId;
			},
			ensureOnDisk: async () => {},
			saveArtifact: async () => "88",
			appendMessage: (m: unknown) => appended.push(m),
			appendCustomMessageEntry: (_type: unknown, content: unknown) => appended.push(content),
			flush: async () => {
				flushed = true;
			},
		};

		const ctx = {
			isIdle: () => true,
			hasUI: false,
			ui: { notify: (msg: string) => notices.push(msg) },
			sessionManager: sm,
			reload: async () => {},
		};

		let handler: CommandHandler | undefined;
		const pi = {
			on: () => {},
			registerCommand: (_name: string, command: { handler: CommandHandler }) => {
				handler = command.handler;
			},
		} as unknown as ExtensionAPI;
		proseExtension(pi);

		await handler!("1", ctx);

		expect(branchedParentId).toBe("turn0_assistant");
		expect(flushed).toBe(true);
		expect(notices.some(n => n.includes("Branched off in place") && n.includes("artifact://88"))).toBe(true);
		const assistantMsg = appended.find(
			a => Boolean(a && typeof a === "object" && "role" in a && (a as { role: string }).role === "assistant"),
		) as { content: Array<{ type: string; text?: string }> } | undefined;
		expect(assistantMsg).toBeDefined();
		const text = assistantMsg?.content.find(p => p.type === "text")?.text ?? "";
		expect(text).toContain("[ran read package.json ×2; recover: artifact://88:");
	});

	test("preserves dropped thinking and skill prompts in the archive", () => {
		const entries = [
			{
				type: "custom_message",
				id: "s1",
				customType: "skill-prompt",
				details: { name: "my-skill" },
				content: "# Full skill documentation and prompt instructions\nLine 2",
			},
			{
				type: "message",
				id: "s2",
				message: { role: "user", content: "run task" },
			},
			{
				type: "message",
				id: "s3",
				message: {
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "My deep internal thinking monologue." },
						{ type: "text", text: "Here is the response." },
					],
				},
			},
		] as unknown as SessionEntry[];

		const keep = parseFlags("").keep; // default: thinking=false, skills="brief"
		const archive = buildProseArchive(entries, keep, new Map());
		expect(archive.content).toContain("### [1] skill: my-skill");
		expect(archive.content).toContain("# Full skill documentation and prompt instructions");
		expect(archive.content).toContain("### [2] thinking");
		expect(archive.content).toContain("My deep internal thinking monologue.");
	});
});

describe("synthetic summary conversion", () => {
	/** Both summaries are synthesized by `proseOf`, so nothing upstream carries a
	 *  display flag for them — the fork must opt them into the TUI itself. */
	const summaryCases = [
		{
			label: "compaction",
			entry: {
				type: "compaction",
				id: "c1",
				summary: "Earlier region: the bundler cache was rebuilt per file.",
				details: { readFiles: ["src/bundler.ts"] },
			},
			customType: "compaction-summary",
			contains: [
				"[summary from an earlier compaction of this branch]",
				"Earlier region: the bundler cache was rebuilt per file.",
				"Files read in the summarized region:\nsrc/bundler.ts",
			],
		},
		{
			label: "branch_summary",
			entry: {
				type: "branch_summary",
				id: "b1",
				summary: "The abandoned tail tried a worker pool and gave up.",
			},
			customType: "branch-summary",
			contains: [
				"[summary of a branch explored after this point]",
				"The abandoned tail tried a worker pool and gave up.",
			],
		},
	];

	for (const { label, entry, customType, contains } of summaryCases) {
		test(`proseOf keeps the ${label} summary visible in the fork`, () => {
			const entries = [
				{
					type: "message",
					id: "q1",
					message: { role: "user", content: "keep going from here" },
				},
				entry,
			] as unknown as SessionEntry[];

			const items = proseOf(entries, parseFlags("").keep);
			const summary = items.find(item => item.kind === "custom" && item.customType === customType);
			expect(summary).toBeDefined();
			if (summary && summary.kind === "custom") {
				for (const fragment of contains) expect(summary.content).toContain(fragment);
				expect(summary.display).toBe(true);
			}
		});
	}
});

describe("artifact link rebasing across prose generations", () => {
	let tempDir: string;

	beforeAll(() => {
		tempDir = path.join(os.tmpdir(), `prose-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
		// Write a mock parent artifact file 0.prose.log
		writeFileSync(
			path.join(tempDir, "0.prose.log"),
			"# Prior Archive\n\n### [1] read old.ts\n- Arguments:\n{}\n- Result:\nhello from old file\n",
		);
	});

	afterAll(() => {
		try {
			rmSync(tempDir, { recursive: true, force: true });
		} catch {}
	});

	test("rebases prior artifact links into the new artifact file", () => {
		const priorEntries = [
			{
				type: "message",
				id: "p1",
				parentId: undefined,
				timestamp: "2026-08-14T10:00:00.000Z",
				message: { role: "user", content: "continue from before" },
			},
			{
				type: "message",
				id: "p2",
				parentId: "p1",
				timestamp: "2026-08-14T10:00:05.000Z",
				message: {
					role: "assistant",
					content: [
						{
							type: "text",
							text: "Earlier steps:\n[ran read old.ts; recover: artifact://0:3-7]\nNow working on next task.",
						},
					],
					stopReason: "stop",
				},
			},
		] as unknown as SessionEntry[];

		const keep = parseFlags("").keep;
		const archive = buildProseArchive(priorEntries, keep, new Map(), tempDir);
		expect(archive.rebasedSpans.has("artifact://0:3-7")).toBe(true);
		const rebasedSpan = archive.rebasedSpans.get("artifact://0:3-7")!;
		expect(rebasedSpan.startLine).toBeGreaterThan(0);

		const items = proseOf(priorEntries, keep, archive.spansByCallId, "99", archive.rebasedSpans);
		const assistant = items.find(
			item => item.kind === "message" && item.message.role === "assistant",
		);
		expect(assistant).toBeDefined();
		if (assistant && assistant.kind === "message") {
			const content = assistant.message.content as Array<{ type: string; text?: string }>;
			const textPart = content.find(p => p.type === "text")?.text ?? "";
			expect(textPart).toContain(`[ran read old.ts; recover: artifact://99:${rebasedSpan.startLine}-${rebasedSpan.endLine}]`);
			expect(textPart).not.toContain("artifact://0:3-7");
		}
	});

	test("neutralizes unresolvable artifact links without leaking broken artifact URIs", () => {
		const entriesWithMissingArtifact = [
			{
				type: "message",
				id: "u1",
				parentId: undefined,
				message: { role: "user", content: "check old artifact" },
			},
			{
				type: "message",
				id: "u2",
				parentId: "u1",
				message: {
					role: "assistant",
					content: [
						{
							type: "text",
							text: "[ran read missing.ts; recover: artifact://999:10-20]\nAlso standalone artifact://999:30-40 link.",
						},
					],
				},
			},
		] as unknown as SessionEntry[];

		const keep = parseFlags("").keep;
		const archive = buildProseArchive(entriesWithMissingArtifact, keep, new Map(), tempDir);
		expect(archive.rebasedSpans.size).toBe(0);

		const items = proseOf(entriesWithMissingArtifact, keep, archive.spansByCallId, "50", archive.rebasedSpans);
		const assistant = items.find(
			item => item.kind === "message" && item.message.role === "assistant",
		);
		expect(assistant).toBeDefined();
		if (assistant && assistant.kind === "message") {
			const content = assistant.message.content as Array<{ type: string; text?: string }>;
			const textPart = content.find(p => p.type === "text")?.text ?? "";
			expect(textPart).toContain("[ran read missing.ts; unrecoverable (was artifact://999:10-20)]");
			expect(textPart).toContain("[unrecoverable artifact://999:30-40]");
			expect(textPart).not.toContain("; recover: artifact://999");
			expect(textPart).not.toContain("artifact://50");
		}
	});

	test("rebases story mode across multiple prose generations", () => {
		const initialEntries = [
			{
				type: "message",
				id: "s1",
				message: { role: "user", content: "initial prompt" },
			},
			{
				type: "message",
				id: "s2",
				message: {
					role: "assistant",
					content: [
						{
							type: "text",
							text: "[ran read old.ts; recover: artifact://0:3-7]\nAssistant finished initial work.",
						},
					],
				},
			},
		] as unknown as SessionEntry[];

		// 1st generation: fold into story
		const keepStory = parseFlags("story").keep;
		const archive1 = buildProseArchive(initialEntries, keepStory, new Map(), tempDir);
		const items1 = proseOf(initialEntries, keepStory, archive1.spansByCallId, "10", archive1.rebasedSpans);
		const story1 = proseOf(initialEntries, keepStory, archive1.spansByCallId, "10", archive1.rebasedSpans);

		// 2nd generation: run prose over the story message
		const storyEntries = [
			{
				type: "message",
				id: "st1",
				message: {
					role: "user",
					content: `[@assistant]\n[ran read old.ts; recover: artifact://0:3-7]\nFinished work.`,
				},
			},
		] as unknown as SessionEntry[];

		const archive2 = buildProseArchive(storyEntries, keepStory, new Map(), tempDir);
		expect(archive2.rebasedSpans.has("artifact://0:3-7")).toBe(true);

		const items2 = proseOf(storyEntries, keepStory, archive2.spansByCallId, "20", archive2.rebasedSpans);
		const userMsg = items2.find(item => item.kind === "message" && item.message.role === "user");
		expect(userMsg).toBeDefined();
		if (userMsg && userMsg.kind === "message") {
			const textPart = (userMsg.message.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
			expect(textPart).toContain("artifact://20:");
			expect(textPart).not.toContain("artifact://0:3-7");
		}
	});
});

/** Two user turns with tool traffic on both sides of the second turn: the
 *  ^1 cut lands between p4 and p5, so the head has machinery to distill and
 *  the tail has native calls that must survive byte-verbatim. */
const pinBranch = [
	{
		type: "message",
		id: "p1",
		parentId: undefined,
		timestamp: "2026-08-14T10:00:00.000Z",
		message: { role: "user", content: "why is the build slow?" },
	},
	{
		type: "message",
		id: "p2",
		parentId: "p1",
		timestamp: "2026-08-14T10:00:05.000Z",
		message: {
			role: "assistant",
			content: [{ type: "toolCall", id: "call_head", name: "read", arguments: { path: "bundler.config.ts" } }],
			stopReason: "toolUse",
			usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120 },
			timestamp: 1000,
		},
	},
	{
		type: "message",
		id: "p3",
		parentId: "p2",
		timestamp: "2026-08-14T10:00:06.000Z",
		message: {
			role: "toolResult",
			toolCallId: "call_head",
			toolName: "read",
			content: [{ type: "text", text: "export default { watch: { poll: true } }" }],
		},
	},
	{
		type: "message",
		id: "p4",
		parentId: "p3",
		timestamp: "2026-08-14T10:00:07.000Z",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "Polling watch mode re-reads every file." }],
			stopReason: "stop",
			usage: { input: 120, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 130 },
			timestamp: 2000,
		},
	},
	{
		type: "message",
		id: "p5",
		parentId: "p4",
		timestamp: "2026-08-14T10:01:00.000Z",
		message: { role: "user", content: "now fix it" },
	},
	{
		type: "message",
		id: "p6",
		parentId: "p5",
		timestamp: "2026-08-14T10:01:05.000Z",
		message: {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "poll:true is the culprit", thinkingSignature: "sig1" },
				{ type: "toolCall", id: "call_tail", name: "edit", arguments: { path: "bundler.config.ts" } },
			],
			stopReason: "toolUse",
			usage: { input: 200, output: 30, cacheRead: 0, cacheWrite: 0, totalTokens: 230 },
			timestamp: 3000,
		},
	},
	{
		type: "message",
		id: "p7",
		parentId: "p6",
		timestamp: "2026-08-14T10:01:06.000Z",
		message: {
			role: "toolResult",
			toolCallId: "call_tail",
			toolName: "edit",
			content: [{ type: "text", text: "edited" }],
		},
	},
	{
		type: "message",
		id: "p8",
		parentId: "p7",
		timestamp: "2026-08-14T10:01:10.000Z",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "Done — watch mode no longer polls." }],
			stopReason: "stop",
			// contextTokens + contextSnapshot are what the host's context anchor
			// reads; a copy that keeps them reports the pre-trim size.
			usage: { input: 230, output: 8, cacheRead: 0, cacheWrite: 0, totalTokens: 238, contextTokens: 90000 },
			contextSnapshot: { promptTokens: 90000, nonMessageTokens: 500 },
			timestamp: 4000,
		},
	},
] as unknown as SessionEntry[];

describe("parseFlags pin tokens", () => {
	test("bare ^ means keep from the last question", () => {
		const parsed = parseFlags("^");
		expect(parsed.pin).toBe(1);
		expect(parsed.turns).toBeUndefined();
	});

	test("^N pins the Nth-from-last turn", () => {
		expect(parseFlags("^3").pin).toBe(3);
	});

	test("^? opens the pin picker, ? the turns picker", () => {
		expect(parseFlags("^?").picker).toBe("pin");
		expect(parseFlags("?").picker).toBe("turns");
	});

	test("last token wins between N and ^N", () => {
		const pinWins = parseFlags("2 ^3");
		expect(pinWins.pin).toBe(3);
		expect(pinWins.turns).toBeUndefined();
		const turnsWin = parseFlags("^2 3");
		expect(turnsWin.turns).toBe(3);
		expect(turnsWin.pin).toBeUndefined();
	});

	test("^N composes with the keep flags", () => {
		const parsed = parseFlags("^2 +think story");
		expect(parsed.pin).toBe(2);
		expect(parsed.keep.thinking).toBe(true);
		expect(parsed.keep.story).toBe(true);
	});

	test("^x stays an unknown option", () => {
		expect(parseFlags("^x").unknown).toBe("^x");
	});
});

/** Narrow an unknown live-entry to its content string, or throw: every shape
 *  assertion in these tests should fail the test, never silently pass. */
function contentOf(value: unknown): string {
	if (value && typeof value === "object" && "content" in value && typeof value.content === "string") return value.content;
	throw new Error(`entry has no string content: ${JSON.stringify(value)}`);
}

function roleOf(value: unknown): string {
	if (value && typeof value === "object" && "role" in value) return String(value.role);
	throw new Error(`entry is not a message: ${JSON.stringify(value)}`);
}

describe("verbatimCopyOf", () => {
	test("clones messages: mutating the copy leaves the source untouched", () => {
		const tail = pinBranch.slice(4);
		const copy = verbatimCopyOf(tail);
		const assistant = copy.find(item => item.kind === "message" && item.message.role === "assistant");
		if (!assistant || assistant.kind !== "message") throw new Error("no assistant in copy");
		const copiedParts = assistant.message.content;
		if (!Array.isArray(copiedParts)) throw new Error("shape");
		copiedParts.push({ type: "text", text: "extra" });
		// Fixture-local cast: pinBranch[5] is the assistant entry by construction.
		const source = pinBranch[5] as Extract<SessionEntry, { type: "message" }>;
		const sourceParts = source.message.content;
		if (!Array.isArray(sourceParts)) throw new Error("shape");
		expect(sourceParts.length).toBe(2);
	});

	test("preserves thinking and toolCall parts, zeroes assistant usage", () => {
		const copy = verbatimCopyOf(pinBranch.slice(4));
		const assistant = copy[1];
		if (assistant.kind !== "message" || assistant.message.role !== "assistant") throw new Error("shape");
		// Fixture-local cast: p6's content is [thinking, toolCall] by construction.
		const parts = assistant.message.content as Array<{ type: string; id?: string; thinking?: string; thinkingSignature?: string }>;
		expect(parts[0].thinking).toBe("poll:true is the culprit");
		expect(parts[0].thinkingSignature).toBe("sig1");
		expect(parts[1].id).toBe("call_tail");
		expect(assistant.message.usage.totalTokens).toBe(0);
		expect(assistant.message.usage.input).toBe(0);
	});

	test("keeps a paired call+result, drops a leading result whose call sits above the cut", () => {
		// A steering message between call and result puts the cut inside the pair.
		const strandedTail = [
			{ type: "message", id: "s1", message: { role: "user", content: "wait, check something else" } },
			pinBranch[6], // toolResult for call_tail — its call is above this cut
			pinBranch[7],
		] as unknown as SessionEntry[];
		const copy = verbatimCopyOf(strandedTail);
		const roles = copy.map(item => (item.kind === "message" ? item.message.role : item.customType));
		expect(roles).toEqual(["user", "assistant"]);

		// The intact pair survives when the call is inside the copied region.
		const paired = verbatimCopyOf(pinBranch.slice(4));
		const pairedRoles = paired.map(item => (item.kind === "message" ? item.message.role : item.customType));
		expect(pairedRoles).toEqual(["user", "assistant", "toolResult", "assistant"]);
	});

	test("re-renders compaction as a prose block and skips state entries", () => {
		const entries = [
			{ type: "compaction", id: "c1", summary: "earlier work summarized", details: { readFiles: ["a.ts"] } },
			{ type: "model_change", id: "mc1", modelId: "some/model" },
			pinBranch[4],
		] as unknown as SessionEntry[];
		const copy = verbatimCopyOf(entries);
		expect(copy.length).toBe(2);
		if (copy[0].kind !== "custom") throw new Error("shape");
		expect(copy[0].customType).toBe("compaction-summary");
		expect(copy[0].content).toContain("[summary from an earlier compaction of this branch]");
		expect(copy[0].content).toContain("a.ts");
	});

	test("keeps an earlier prose-note: its region is still what it says", () => {
		const entries = [
			{ type: "custom_message", id: "n1", customType: "prose-note", content: "[The conversation from this point on…]", display: true },
			pinBranch[4],
		] as unknown as SessionEntry[];
		const copy = verbatimCopyOf(entries);
		expect(copy.length).toBe(2);
		if (copy[0].kind !== "custom") throw new Error("shape");
		expect(copy[0].customType).toBe("prose-note");
	});
});

describe("/prose ^N trims in place", () => {
	test("appends boundary, distilled head, seam marker, then the verbatim tail", async () => {
		const { notices, liveEntries, savedArtifacts } = await runProse("^1", { entries: pinBranch });

		// Order: reset boundary first, prose-note second.
		expect(liveEntries[0]).toBe("[reset_boundary]");
		expect(contentOf(liveEntries[1])).toContain("distilled by /prose");
		expect(contentOf(liveEntries[1])).toContain("above the boundary");

		// The head is distilled: the read call became a trace line, never a toolCall.
		const flat = JSON.stringify(liveEntries);
		expect(flat).toContain("[ran read bundler.config.ts");
		expect(flat).not.toContain("call_head");

		// The seam marker announces a verbatim tail, then the tail follows natively.
		const seamIndex = liveEntries.findIndex(
			entry =>
				typeof entry === "object" &&
				entry !== null &&
				"content" in entry &&
				typeof entry.content === "string" &&
				entry.content.includes("End of distilled history"),
		);
		expect(seamIndex).toBeGreaterThan(1);
		expect(contentOf(liveEntries[seamIndex])).toContain("original conversation from the kept turn onward, verbatim");
		const tailMessages = liveEntries.slice(seamIndex + 1);
		expect(tailMessages.map(roleOf)).toEqual(["user", "assistant", "toolResult", "assistant"]);
		// Native, not traced: the tail's call survives with its id and thinking.
		const tailFlat = JSON.stringify(tailMessages);
		expect(tailFlat).toContain("call_tail");
		expect(tailFlat).toContain("poll:true is the culprit");

		// The head's tool output landed in the archive; the notice names recovery.
		expect(savedArtifacts.length).toBe(1);
		expect(savedArtifacts[0].type).toBe("prose");
		expect(savedArtifacts[0].content).toContain("watch: { poll: true }");
		expect(notices.some(notice => notice.includes("Trimmed in place") && notice.includes("/tree"))).toBe(true);
	});

	test("refuses when the pinned turn already opens the conversation", async () => {
		const { notices, liveEntries } = await runProse("^1");
		expect(liveEntries.length).toBe(0);
		expect(notices.some(notice => notice.includes("Nothing before that turn"))).toBe(true);
	});

	test("refuses an out-of-range pin without mutating", async () => {
		const { notices, liveEntries } = await runProse("^9", { entries: pinBranch });
		expect(liveEntries.length).toBe(0);
		expect(notices.some(notice => notice.includes("turn(s) on this branch"))).toBe(true);
	});

	test("^? without a UI warns instead of picking", async () => {
		const { notices, liveEntries } = await runProse("^?", { entries: pinBranch });
		expect(liveEntries.length).toBe(0);
		expect(notices.some(notice => notice.includes("No interactive UI"))).toBe(true);
	});
});

/** A steering turn lands between a tool call and its result, so the ^1 cut
 *  splits the pair: the call is in the head, the real result in the tail. */
const splitPairBranch = [
	{
		type: "message",
		id: "s1",
		parentId: undefined,
		message: { role: "user", content: "read the config" },
	},
	{
		type: "message",
		id: "s2",
		parentId: "s1",
		message: {
			role: "assistant",
			content: [{ type: "toolCall", id: "call_split", name: "read", arguments: { path: "app.config.ts" } }],
			stopReason: "toolUse",
			usage: { input: 50, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 60 },
		},
	},
	{
		type: "message",
		id: "s3",
		parentId: "s2",
		message: { role: "user", content: "actually also check the lockfile" },
	},
	{
		type: "message",
		id: "s4",
		parentId: "s3",
		message: {
			role: "toolResult",
			toolCallId: "call_split",
			toolName: "read",
			content: [{ type: "text", text: "REAL CONFIG OUTPUT" }],
		},
	},
	{
		type: "message",
		id: "s5",
		parentId: "s4",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "Both files look fine." }],
			stopReason: "stop",
			usage: { input: 70, output: 12, cacheRead: 0, cacheWrite: 0, totalTokens: 82 },
		},
	},
] as unknown as SessionEntry[];

describe("/prose ^N does not corrupt calls split across the cut", () => {
	test("+tools keeps the real result instead of synthesizing a failure", async () => {
		const { liveEntries } = await runProse("^1 +tools", { entries: splitPairBranch });

		const flat = JSON.stringify(liveEntries);
		// The head owns the call, so it must own the call's true outcome.
		expect(flat).toContain("REAL CONFIG OUTPUT");
		expect(flat).not.toContain("No result recorded");
		expect(flat).not.toContain('"isError":true');
		// Exactly once: the head emits it, the tail copy drops the orphan.
		expect(flat.split("REAL CONFIG OUTPUT").length - 1).toBe(1);

		// And the native call still pairs with a result, as providers require.
		const roles = liveEntries
			.filter(entry => entry && typeof entry === "object" && "role" in entry)
			.map(roleOf);
		expect(roles).toEqual(["user", "assistant", "toolResult", "user", "assistant"]);
	});

	test("traced (default) mode also reports the real outcome", async () => {
		const { liveEntries } = await runProse("^1", { entries: splitPairBranch });
		const flat = JSON.stringify(liveEntries);
		expect(flat).toContain("[ran read app.config.ts");
		// A successful call must not be trace-marked as failed.
		expect(flat).not.toContain("FAILED");
	});
});

describe("/prose ^N context accounting", () => {
	test("copies shed contextSnapshot and contextTokens", () => {
		const copy = verbatimCopyOf(pinBranch.slice(4));
		const last = copy.at(-1);
		if (!last || last.kind !== "message" || last.message.role !== "assistant") throw new Error("shape");
		// Both are what SessionStatsTracker reads to pick and price the anchor.
		expect(last.message.contextSnapshot).toBeUndefined();
		expect(last.message.usage.contextTokens).toBe(0);
		expect(last.message.usage.input).toBe(0);
		// The original is untouched, so the real meter still holds the tokens.
		const source = pinBranch[7] as Extract<SessionEntry, { type: "message" }>;
		if (source.message.role !== "assistant") throw new Error("shape");
		expect(source.message.usage.contextTokens).toBe(90000);
	});

	test("appended assistants never reuse an original's timestamp", async () => {
		const { liveEntries } = await runProse("^1", { entries: pinBranch });

		const originalStamps = new Set<number>();
		for (const entry of pinBranch) {
			if (entry.type !== "message" || entry.message.role !== "assistant") continue;
			if (typeof entry.message.timestamp === "number") originalStamps.add(entry.message.timestamp);
		}
		expect(originalStamps.size).toBeGreaterThan(0);

		const appendedStamps: number[] = [];
		for (const entry of liveEntries) {
			if (!entry || typeof entry !== "object" || !("role" in entry)) continue;
			if (entry.role !== "assistant" || !("timestamp" in entry)) continue;
			if (typeof entry.timestamp === "number") appendedStamps.push(entry.timestamp);
		}
		expect(appendedStamps.length).toBeGreaterThan(0);
		for (const stamp of appendedStamps) expect(originalStamps.has(stamp)).toBe(false);
	});
});

describe("/prose N leaf safety", () => {
	test("does not move the leaf when there is nothing to distill", async () => {
		// The pinned turn carries no text, so the distillation yields no items.
		const emptyTurnBranch = [
			{ type: "message", id: "t1", parentId: undefined, message: { role: "user", content: "hello" } },
			{
				type: "message",
				id: "t2",
				parentId: "t1",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "hi" }],
					stopReason: "stop",
					usage: { input: 5, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 7 },
				},
			},
			{ type: "message", id: "t3", parentId: "t2", message: { role: "user", content: "   " } },
		] as unknown as SessionEntry[];

		const { notices, branchCalls, liveEntries } = await runProse("1", { entries: emptyTurnBranch });
		expect(notices.some(notice => notice.includes("Nothing to distill"))).toBe(true);
		expect(branchCalls).toEqual([]);
		expect(liveEntries.length).toBe(0);
	});

	test("moves the leaf exactly once on a successful trim", async () => {
		const { branchCalls, liveEntries } = await runProse("1", { entries: pinBranch });
		expect(branchCalls).toEqual(["p4"]);
		expect(liveEntries.length).toBeGreaterThan(0);
	});
});

/** A `/clear` happened mid-session: the host emits only what follows the
 *  boundary, so nothing above it may be dragged back into context. */
const clearedBranch = [
	{ type: "message", id: "c1", parentId: undefined, message: { role: "user", content: "SEALED-OLD question" } },
	{
		type: "message",
		id: "c2",
		parentId: "c1",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "SEALED-OLD answer" }],
			stopReason: "stop",
			usage: { input: 900, output: 40, cacheRead: 0, cacheWrite: 0, totalTokens: 940 },
		},
	},
	{ type: "reset_boundary", id: "c3", parentId: "c2" },
	{ type: "message", id: "c4", parentId: "c3", message: { role: "user", content: "fresh question" } },
	{
		type: "message",
		id: "c5",
		parentId: "c4",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "fresh answer" }],
			stopReason: "stop",
			usage: { input: 20, output: 8, cacheRead: 0, cacheWrite: 0, totalTokens: 28 },
		},
	},
	{ type: "message", id: "c6", parentId: "c5", message: { role: "user", content: "latest question" } },
] as unknown as SessionEntry[];

/** A compaction sealed the opening turns; its summary plus the tail it kept
 *  (from firstKeptEntryId) are what the host still emits. */
const compactedBranch = [
	{ type: "message", id: "k1", parentId: undefined, message: { role: "user", content: "SEALED-OLD question" } },
	{
		type: "message",
		id: "k2",
		parentId: "k1",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "SEALED-OLD answer" }],
			stopReason: "stop",
			usage: { input: 800, output: 30, cacheRead: 0, cacheWrite: 0, totalTokens: 830 },
		},
	},
	{ type: "message", id: "k3", parentId: "k2", message: { role: "user", content: "kept question" } },
	{
		type: "message",
		id: "k4",
		parentId: "k3",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "kept answer" }],
			stopReason: "stop",
			usage: { input: 30, output: 9, cacheRead: 0, cacheWrite: 0, totalTokens: 39 },
		},
	},
	{
		type: "compaction",
		id: "k5",
		parentId: "k4",
		summary: "SUMMARY-KEPT of the collapsed opening",
		firstKeptEntryId: "k3",
		tokensBefore: 830,
	},
	{ type: "message", id: "k6", parentId: "k5", message: { role: "user", content: "latest question" } },
] as unknown as SessionEntry[];

describe("sealed history stays sealed", () => {
	test("^1 after a /clear distills only the post-boundary region", async () => {
		const { liveEntries } = await runProse("^1", { entries: clearedBranch });

		const flat = JSON.stringify(liveEntries);
		expect(flat).toContain("fresh question");
		expect(flat).toContain("latest question");
		// Resurrecting these would undo the user's /clear and grow the context
		// the command exists to shrink.
		expect(flat).not.toContain("SEALED-OLD");
	});

	test("^N numbering counts only reachable turns", async () => {
		// The 2nd-from-last reachable turn IS the first post-boundary turn, so
		// there is nothing left to distill.
		const second = await runProse("^2", { entries: clearedBranch });
		expect(second.liveEntries.length).toBe(0);
		expect(second.notices.some(notice => notice.includes("already opens the active context"))).toBe(true);

		// The two pre-boundary turns are not addressable at all.
		const third = await runProse("^3", { entries: clearedBranch });
		expect(third.liveEntries.length).toBe(0);
		expect(third.notices.some(notice => notice.includes("2 turn(s) reachable"))).toBe(true);
	});

	test("^1 after a compaction keeps the summary and the kept tail", async () => {
		const { liveEntries } = await runProse("^1", { entries: compactedBranch });

		const flat = JSON.stringify(liveEntries);
		// Everything the host still emits survives the trim...
		expect(flat).toContain("kept question");
		expect(flat).toContain("SUMMARY-KEPT");
		expect(flat).toContain("latest question");
		// ...and the raw turns the compaction replaced stay replaced.
		expect(flat).not.toContain("SEALED-OLD");
	});

	test("numbered /prose cannot cut past a collapse marker", async () => {
		// Only two reachable turns follow the boundary; cutting at the third
		// would move the leaf above the boundary and re-emit what it sealed.
		const { notices, branchCalls, liveEntries } = await runProse("3", { entries: clearedBranch });
		expect(branchCalls).toEqual([]);
		expect(liveEntries.length).toBe(0);
		expect(notices.some(notice => notice.includes("2 turn(s) reachable"))).toBe(true);

		// A reachable cut still works, and stays below the boundary.
		const ok = await runProse("1", { entries: clearedBranch });
		expect(ok.branchCalls).toEqual(["c5"]);
		expect(JSON.stringify(ok.liveEntries)).not.toContain("SEALED-OLD");
	});
});
