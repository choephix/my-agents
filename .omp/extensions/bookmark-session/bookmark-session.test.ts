import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import {
	extractTranscript,
	isNiloTree,
	parseBookmarkFilename,
	parseSummary,
	registerBookmarkSessionExtension,
	renderBookmark,
	resolveBookmarkFile,
	resolveDefaultWikiRoot,
	upsertBookmark,
	type BookmarkSummary,
} from "./bookmark-session";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function makeTemporaryDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "bookmark-session-"));
	temporaryDirectories.push(directory);
	return directory;
}

describe("bookmark filename and path", () => {
	test("uses default.md when no file or default is supplied", () => {
		expect(parseBookmarkFilename("", "")).toBe("default.md");
		expect(parseBookmarkFilename("   ", "   ")).toBe("default.md");
	});

	test("uses default filename when no argument is supplied", () => {
		expect(parseBookmarkFilename("", "my-session")).toBe("my-session.md");
		expect(parseBookmarkFilename("   ", "my-session.md")).toBe("my-session.md");
	});

	test("explicit argument overrides default filename", () => {
		expect(parseBookmarkFilename("custom-topic", "my-session")).toBe("custom-topic.md");
	});

	test("slugifies spaces in default filename from environment", () => {
		expect(parseBookmarkFilename("", "my workspace pane")).toBe("my-workspace-pane.md");
	});
	test("reads default from AGENTS_BOOKMARK_FILE env var", () => {
		const originalAgentsBookmark = process.env.AGENTS_BOOKMARK_FILE;
		try {
			delete process.env.AGENTS_BOOKMARK_FILE;
			expect(parseBookmarkFilename("")).toBe("default.md");

			process.env.AGENTS_BOOKMARK_FILE = "agents-override";
			expect(parseBookmarkFilename("")).toBe("agents-override.md");
		} finally {
			if (originalAgentsBookmark !== undefined) {
				process.env.AGENTS_BOOKMARK_FILE = originalAgentsBookmark;
			} else {
				delete process.env.AGENTS_BOOKMARK_FILE;
			}
		}
	});

	test("accepts a safe name with or without the markdown suffix", () => {
		expect(parseBookmarkFilename("strange-ideas")).toBe("strange-ideas.md");
		expect(parseBookmarkFilename("strange-ideas.md")).toBe("strange-ideas.md");
		expect(parseBookmarkFilename("strange-ideas.MD")).toBe("strange-ideas.md");
	});

	test("rejects traversal, separators, whitespace, and hidden names", () => {
		for (const name of ["../ideas", "a/b", "a\\b", "two words", ".hidden"]) {
			expect(() => parseBookmarkFilename(name)).toThrow();
		}
	});

	test("expands tilde and tolerates a trailing slash", () => {
		expect(resolveBookmarkFile("", "~/agentspace/index/wiki/", "/home/stefan", "default")).toBe(
			"/home/stefan/agentspace/index/wiki/omp-bookmarks/default.md",
		);
		expect(resolveBookmarkFile("", "~/agentspace/index/wiki/", "/home/stefan", "herdr-pane-1")).toBe(
			"/home/stefan/agentspace/index/wiki/omp-bookmarks/herdr-pane-1.md",
		);
		expect(resolveBookmarkFile("strange-ideas", "/wiki/", "/unused", "herdr-pane-1")).toBe(
			"/wiki/omp-bookmarks/strange-ideas.md",
		);
	});

	test("every Nilo checkout and worktree shares the wayfinder wiki", () => {
		const home = "/home/cx";
		const envWiki = "/home/cx/agentspace/index/wiki";
		const shared = "/home/cx/workspace/nilo-wayfinder/wiki";
		for (const cwd of [
			"/home/cx/workspace/nilo",
			"/home/cx/workspace/nilo-website",
			"/home/cx/workspace/nilo-wayfinder",
			"/home/cx/workspace/nilo-worktrees/pr-9073-fix-wb-res-review",
			"/home/cx/.herdr/worktrees/nilo/locomotion-mixer-exclusivity",
			"/home/cx/.herdr/worktrees/nilo-website/pr59-review-fixes",
			"/home/cx/.herdr/worktrees/nilo-wayfinder/worktree-brave-field-c3d0",
		]) {
			expect(isNiloTree(cwd)).toBe(true);
			expect(resolveDefaultWikiRoot(cwd, home, envWiki)).toBe(shared);
		}
		expect(isNiloTree("/tmp/other")).toBe(false);
		expect(resolveDefaultWikiRoot("/tmp/other", home, envWiki)).toBe(envWiki);
		expect(resolveDefaultWikiRoot("/tmp/other", home, "")).toBe("/home/cx/agents-wiki");
	});
});

describe("transcript extraction and summary parsing", () => {
	test("keeps user and assistant prose while omitting tool traffic", () => {
		const transcript = extractTranscript([
			{ type: "message", message: { role: "user", content: "Build it" } },
			{
				type: "message",
				message: {
					role: "assistant",
					content: [
						{ type: "text", text: "Working on it." },
						{ type: "toolCall", name: "read", arguments: {} },
					],
				},
			},
			{ type: "message", message: { role: "toolResult", content: "private file contents" } },
		]);

		expect(transcript).toBe("USER:\nBuild it\n\nASSISTANT:\nWorking on it.");
		expect(transcript).not.toContain("private file contents");
	});

	test("parses fenced JSON defensively and clamps model output", () => {
		const parked = Array.from({ length: 10 }, (_, index) => `item ${index}`);
		const parsed = parseSummary(
			`\`\`\`json\n${JSON.stringify({ overall: "  Overall   summary  ", latest: "Latest topic", parked })}\n\`\`\``,
		);

		expect(parsed.overall).toBe("Overall summary");
		expect(parsed.latest).toBe("Latest topic");
		expect(parsed.parked).toHaveLength(8);
	});

	test("rejects incomplete summary objects", () => {
		expect(() => parseSummary('{"overall":"x","latest":"y"}')).toThrow(
			"summary field parked is not an array",
		);
	});
});

describe("markdown rendering", () => {
	const first = renderBookmark({
		sessionId: "session-1",
		sessionFile: "/sessions/session-1.jsonl",
		title: "Investigate *bookmarks*",
		recordedAt: new Date("2026-08-15T06:00:00.000Z"),
		summary: {
			overall: "Designed session bookmarks.",
			latest: "Implementing the extension.",
			parked: [],
		},
	});

	test("renders copyable identity, exact transcript path, and digest", () => {
		expect(first).toContain("## 2026-08-15 06:00:00 UTC — Investigate \\*bookmarks\\*");
		expect(first).toContain("- Session: `session-1`");
		expect(first).toContain("- Transcript: `/sessions/session-1.jsonl`");
		expect(first).toContain("**Latest:** Implementing the extension.");
		expect(first).toContain("- Nothing unresolved.");
	});

	test("updates existing session and moves it to top beneath header", () => {
		const withFirst = upsertBookmark("", first, "session-1");
		const second = first.replaceAll("session-1", "session-2");
		const withTwo = upsertBookmark(withFirst, second, "session-2");

		// session-2 is above session-1
		expect(withTwo.indexOf("omp-bookmark:start:session-2")).toBeLessThan(
			withTwo.indexOf("omp-bookmark:start:session-1"),
		);

		// updating session-1 bumps session-1 back to the top
		const updated = first.replace("Designed session bookmarks.", "Updated summary.");
		const result = upsertBookmark(withTwo, updated, "session-1");

		expect(result.match(/omp-bookmark:start:session-1/g)).toHaveLength(1);
		expect(result).toContain("Updated summary.");
		expect(result.indexOf("omp-bookmark:start:session-1")).toBeLessThan(
			result.indexOf("omp-bookmark:start:session-2"),
		);
	});

	test("prepends newer bookmarks at the top beneath the header", () => {
		const withFirst = upsertBookmark("", first, "session-1");
		const second = first.replaceAll("session-1", "session-2");
		const withTwo = upsertBookmark(withFirst, second, "session-2");

		const pos1 = withTwo.indexOf("omp-bookmark:start:session-1");
		const pos2 = withTwo.indexOf("omp-bookmark:start:session-2");
		expect(pos2).toBeLessThan(pos1);
		expect(withTwo.startsWith("# OMP bookmarks\n\n")).toBe(true);
	});
});

describe("bookmark-session command", () => {
	type CommandHandler = (args: string, ctx: ExtensionContext) => Promise<void>;

	function registerCommand(
		root: string,
		summarize: (transcript: string, ctx: ExtensionContext) => Promise<BookmarkSummary>,
		defaultFilename: string = "default",
	): CommandHandler {
		let handler: CommandHandler | undefined;
		const registeredCommands: string[] = [];
		const pi = {
			setLabel: () => {},
			registerCommand: (name: string, definition: { handler: CommandHandler }) => {
				registeredCommands.push(name);
				if (name === "bookmark-session") {
					handler = definition.handler;
				}
			},
		} as unknown as ExtensionAPI;
		registerBookmarkSessionExtension(pi, { wikiRoot: root, summarize, defaultFilename });
		expect(registeredCommands).toEqual(["bookmark-session"]);
		if (!handler) throw new Error("command was not registered");
		return handler;
	}

	function makeContext(notifications: Array<{ message: string; level: string }>): ExtensionContext {
		return {
			cwd: "/workspace",
			sessionManager: {
				getSessionId: () => "session-123",
				getSessionFile: () => "/profiles/default/session-123.jsonl",
				getSessionName: () => "Bookmark command workshop",
				getBranch: () => [
					{ type: "message", message: { role: "user", content: "Build it!" } },
				],
			},
			ui: {
				notify: (message: string, level: string) => notifications.push({ message, level }),
				setStatus: () => {},
			},
		} as unknown as ExtensionContext;
	}

	test("writes and then updates one summarized bookmark", async () => {
		const root = makeTemporaryDirectory();
		const notifications: Array<{ message: string; level: string }> = [];
		let revision = 0;
		const handler = registerCommand(root, async transcript => {
			expect(transcript).toContain("Build it!");
			revision += 1;
			return {
				overall: `Summary revision ${revision}`,
				latest: "Building bookmark-session.",
				parked: ["Run a live smoke test."],
			};
		});
		const ctx = makeContext(notifications);

		await handler("strange-ideas", ctx);
		await handler("strange-ideas.md", ctx);

		const file = join(root, "omp-bookmarks", "strange-ideas.md");
		const contents = readFileSync(file, "utf8");
		expect(contents.match(/omp-bookmark:start:session-123/g)).toHaveLength(1);
		expect(contents).toContain("Summary revision 2");
		expect(contents).not.toContain("Summary revision 1");
		expect(contents).toContain("Bookmark command workshop");
		expect(notifications.at(-1)?.level).toBe("info");
	});

	test("keeps the primary bookmark when tiny summarization fails", async () => {
		const root = makeTemporaryDirectory();
		const notifications: Array<{ message: string; level: string }> = [];
		const handler = registerCommand(root, async () => {
			throw new Error("tiny unavailable");
		});

		await handler("", makeContext(notifications));

		const contents = readFileSync(join(root, "omp-bookmarks", "default.md"), "utf8");
		expect(contents).toContain("- Session: `session-123`");
		expect(contents).not.toContain("**Overall:**");
		expect(notifications.at(-1)).toEqual({
			message: expect.stringContaining("summary unavailable: tiny unavailable"),
			level: "warning",
		});
	});
});
