import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type {
	ChildProcessWithoutNullStreams,
} from "node:child_process";
import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionUIContext,
	ReadonlySessionManager,
	SessionEntry,
} from "@oh-my-pi/pi-coding-agent";
import sayLastMessageExtension, {
	COMMAND_NAMES,
	lastProse,
	parseSpeakCommand,
	SpeechPlayer,
	type SpeechSpawn,
} from "./say-last-message";

describe("lastProse", () => {
	test("returns text from the last assistant message", () => {
		const entries = [
			{
				type: "message",
				id: "e1",
				message: { role: "user", content: "hello" },
			},
			{
				type: "message",
				id: "e2",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Hello there! How can I help?" }],
				},
			},
		] as unknown as SessionEntry[];

		expect(lastProse(entries)).toBe("Hello there! How can I help?");
	});

	test("skips assistant messages containing tool calls", () => {
		const entries = [
			{
				type: "message",
				id: "e1",
				message: { role: "user", content: "read file" },
			},
			{
				type: "message",
				id: "e2",
				message: {
					role: "assistant",
					content: [
						{ type: "text", text: "I will read the file." },
						{ type: "toolCall", id: "tc1", name: "read", arguments: { path: "foo.txt" } },
					],
				},
			},
			{
				type: "message",
				id: "e3",
				message: { role: "toolResult", content: "file contents" },
			},
			{
				type: "message",
				id: "e4",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "The file contents are verified." }],
				},
			},
		] as unknown as SessionEntry[];

		expect(lastProse(entries)).toBe("The file contents are verified.");
	});

	test("returns null when no assistant message exists", () => {
		const entries = [
			{
				type: "message",
				id: "e1",
				message: { role: "user", content: "hello" },
			},
		] as unknown as SessionEntry[];

		expect(lastProse(entries)).toBeNull();
	});

	test("handles string content in assistant message", () => {
		const entries = [
			{
				type: "message",
				id: "e1",
				message: { role: "assistant", content: "Direct string message." },
			},
		] as unknown as SessionEntry[];

		expect(lastProse(entries)).toBe("Direct string message.");
	});
});

describe("parseSpeakCommand", () => {
	test("parses empty string as speak_last", () => {
		expect(parseSpeakCommand("")).toEqual({ action: "speak_last" });
		expect(parseSpeakCommand("   ")).toEqual({ action: "speak_last" });
	});

	test("parses auto commands", () => {
		expect(parseSpeakCommand("auto")).toEqual({ action: "auto_toggle" });
		expect(parseSpeakCommand("auto on")).toEqual({ action: "auto_on" });
		expect(parseSpeakCommand("on")).toEqual({ action: "auto_on" });
		expect(parseSpeakCommand("auto off")).toEqual({ action: "auto_off" });
		expect(parseSpeakCommand("off")).toEqual({ action: "auto_off" });
		expect(parseSpeakCommand("status")).toEqual({ action: "status" });
		expect(parseSpeakCommand("auto status")).toEqual({ action: "status" });
	});

	test("parses stop and help", () => {
		expect(parseSpeakCommand("stop")).toEqual({ action: "stop" });
		expect(parseSpeakCommand("help")).toEqual({ action: "help" });
		expect(parseSpeakCommand("--help")).toEqual({ action: "help" });
	});

	test("parses arbitrary text as speak_text", () => {
		expect(parseSpeakCommand("Hello from custom speak")).toEqual({
			action: "speak_text",
			text: "Hello from custom speak",
		});
	});
});

class MockChildProcess extends EventEmitter {
	stderr = new EventEmitter();
	stdout = new EventEmitter();
	stdin = null;
	stdio = [null, this.stdout, this.stderr, null, null];
	killed = false;
	pid = 1234;

	kill(signal?: NodeJS.Signals | number): boolean {
		this.killed = true;
		this.emit("close", null, typeof signal === "string" ? signal : "SIGTERM");
		return true;
	}
}

describe("SpeechPlayer", () => {
	test("plays audio and resolves on exit code 0", async () => {
		let spawnedCmd = "";
		let spawnedArgs: readonly string[] = [];

		const fakeSpawn: SpeechSpawn = (cmd, args) => {
			spawnedCmd = cmd;
			spawnedArgs = args;
			const child = new MockChildProcess();
			queueMicrotask(() => child.emit("close", 0));
			return child as unknown as ChildProcessWithoutNullStreams;
		};

		const player = new SpeechPlayer({ spawn: fakeSpawn, ompPath: "/mock/omp" });
		const result = await player.play("testing speech", { voice: "af_aoede" });

		expect(spawnedCmd).toBe("/mock/omp");
		expect(spawnedArgs).toEqual(["say", "testing speech", "--voice", "af_aoede"]);
		expect(result.success).toBe(true);
	});

	test("reports error on failure exit code", async () => {
		const fakeSpawn: SpeechSpawn = () => {
			const child = new MockChildProcess();
			queueMicrotask(() => {
				child.stderr.emit("data", Buffer.from("model loading error"));
				child.emit("close", 1);
			});
			return child as unknown as ChildProcessWithoutNullStreams;
		};

		const player = new SpeechPlayer({ spawn: fakeSpawn });
		const result = await player.play("failed speech");

		expect(result.success).toBe(false);
		expect(result.error).toContain("model loading error");
	});

	test("stop kills the active process", async () => {
		let killed = false;
		const fakeSpawn: SpeechSpawn = () => {
			const child = new MockChildProcess();
			child.on("close", () => {
				killed = true;
			});
			return child as unknown as ChildProcessWithoutNullStreams;
		};

		const player = new SpeechPlayer({ spawn: fakeSpawn });
		void player.play("long speech");
		expect(player.isPlaying()).toBe(true);

		const stopped = player.stop();
		expect(stopped).toBe(true);
		expect(killed).toBe(true);
		expect(player.isPlaying()).toBe(false);
	});
});

describe("sayLastMessageExtension integration", () => {
	type TurnEndCallback = (event: unknown, ctx: ExtensionContext) => void;
	type CommandHandler = (args: string, ctx: ExtensionContext) => Promise<void>;

	test("registers say-last-message, speak, and say and responds to turn_end", async () => {
		const commandHandlers = new Map<string, CommandHandler>();
		let turnEndHandler: TurnEndCallback | undefined;

		const pi = {
			setLabel: () => {},
			on: (event: string, handler: TurnEndCallback) => {
				if (event === "turn_end") turnEndHandler = handler;
			},
			registerCommand: (name: string, def: { handler: CommandHandler }) => {
				commandHandlers.set(name, def.handler);
			},
		} as unknown as ExtensionAPI;

		const notices: Array<{ msg: string; level: string }> = [];
		const spoken: string[] = [];
		let closeNotifier: (() => void) | null = null;

		const fakeSpawn: SpeechSpawn = (_cmd, args) => {
			spoken.push(args[1]); // args = ["say", text, "--voice", voice]
			const child = new MockChildProcess();
			queueMicrotask(() => {
				child.emit("close", 0);
				closeNotifier?.();
			});
			return child as unknown as ChildProcessWithoutNullStreams;
		};

		const player = new SpeechPlayer({ spawn: fakeSpawn });
		sayLastMessageExtension(pi, { player });

		expect(COMMAND_NAMES).toEqual(["say-last-message", "speak", "say"]);
		for (const name of COMMAND_NAMES) {
			expect(commandHandlers.has(name)).toBe(true);
		}
		expect(turnEndHandler).toBeDefined();

		const mockEntries = [
			{
				type: "message",
				id: "e1",
				message: { role: "assistant", content: [{ type: "text", text: "Ready for tasks." }] },
			},
		] as unknown as SessionEntry[];

		const ctx = {
			ui: {
				notify: (msg: string, level = "info") => notices.push({ msg, level }),
			} as unknown as ExtensionUIContext,
			sessionManager: {
				getSessionId: () => "sess-1",
				getBranch: () => mockEntries,
			} as unknown as ReadonlySessionManager,
		} as unknown as ExtensionContext;

		const sayLastMsgHandler = commandHandlers.get("say-last-message")!;

		// 1. Manual /say-last-message
		await sayLastMsgHandler("", ctx);
		expect(notices.some(n => n.msg.includes("Speaking last assistant message"))).toBe(true);
		expect(spoken).toContain("Ready for tasks.");

		// 2. turn_end while auto-speak is disabled (default)
		spoken.length = 0;
		turnEndHandler!({}, ctx);
		expect(spoken.length).toBe(0);

		// 3. Enable auto-speak via alias
		const speakHandler = commandHandlers.get("speak")!;
		await speakHandler("auto on", ctx);
		expect(notices.some(n => n.msg.includes("Auto-speak enabled"))).toBe(true);

		// 4. turn_end while auto-speak is enabled
		const { promise: completedFirst, resolve: resolveFirst } = Promise.withResolvers<void>();
		closeNotifier = resolveFirst;
		turnEndHandler!({}, ctx);
		await completedFirst;
		closeNotifier = null;
		expect(spoken).toContain("Ready for tasks.");

		// 5. Check status
		await sayLastMsgHandler("status", ctx);
		expect(notices.some(n => n.msg.includes("Auto-speak: enabled"))).toBe(true);

		// 6. Disable auto-speak
		await sayLastMsgHandler("auto off", ctx);
		expect(notices.some(n => n.msg.includes("Auto-speak disabled"))).toBe(true);

		// 7. turn_end after disabling
		spoken.length = 0;
		turnEndHandler!({}, ctx);
		expect(spoken.length).toBe(0);
	});
});
