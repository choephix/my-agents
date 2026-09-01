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
import speakExtension, {
	COMMAND_NAMES,
	getConfiguredSpeed,
	lastProse,
	parseSpeakCommand,
	SpeechPlayer,
	type SpeechSpawn,
} from "./speak";

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

	test("parses speed commands", () => {
		expect(parseSpeakCommand("speed")).toEqual({ action: "speed" });
		expect(parseSpeakCommand("speed 1.5")).toEqual({ action: "speed", speed: 1.5 });
		expect(parseSpeakCommand("speed 2.0")).toEqual({ action: "speed", speed: 2.0 });
		expect(parseSpeakCommand("1.5x")).toEqual({ action: "speed", speed: 1.5 });
		expect(parseSpeakCommand("1.25x")).toEqual({ action: "speed", speed: 1.25 });
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

describe("getConfiguredSpeed", () => {
	test("returns default speed 1.5 when not set", () => {
		expect(getConfiguredSpeed("/nonexistent/path.yml")).toBe(1.5);
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
	test("synthesizes to wav and plays via ffmpeg with speed filter", async () => {
		const spawnLog: Array<{ cmd: string; args: readonly string[] }> = [];

		const fakeSpawn: SpeechSpawn = (cmd, args) => {
			spawnLog.push({ cmd, args });
			const child = new MockChildProcess();
			queueMicrotask(() => child.emit("close", 0));
			return child as unknown as ChildProcessWithoutNullStreams;
		};

		const player = new SpeechPlayer({ spawn: fakeSpawn, ompPath: "/mock/omp" });
		const result = await player.play("testing speech", { voice: "af_aoede", speed: 1.5 });

		expect(result.success).toBe(true);
		expect(spawnLog.length).toBe(2);

		// 1. Synth
		expect(spawnLog[0].cmd).toBe("/mock/omp");
		expect(spawnLog[0].args[0]).toBe("say");
		expect(spawnLog[0].args[1]).toBe("testing speech");
		expect(spawnLog[0].args[2]).toBe("--out");
		expect(spawnLog[0].args[4]).toBe("--voice");
		expect(spawnLog[0].args[5]).toBe("af_aoede");

		// 2. Play with atempo filter
		expect(spawnLog[1].cmd).toBe("ffmpeg");
		expect(spawnLog[1].args).toContain("-filter:a");
		expect(spawnLog[1].args).toContain("atempo=1.5");
	});

	test("reports error if synthesis fails", async () => {
		const fakeSpawn: SpeechSpawn = () => {
			const child = new MockChildProcess();
			queueMicrotask(() => {
				child.stderr.emit("data", Buffer.from("synthesis error"));
				child.emit("close", 1);
			});
			return child as unknown as ChildProcessWithoutNullStreams;
		};

		const player = new SpeechPlayer({ spawn: fakeSpawn });
		const result = await player.play("failed speech");

		expect(result.success).toBe(false);
		expect(result.error).toContain("synthesis error");
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

describe("speakExtension integration", () => {
	type TurnEndCallback = (event: unknown, ctx: ExtensionContext) => void;
	type CommandHandler = (args: string, ctx: ExtensionContext) => Promise<void>;

	test("registers commands, handles speed adjustments, and auto-speak", async () => {
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
		const spawnLog: Array<{ cmd: string; args: readonly string[] }> = [];
		let closeNotifier: (() => void) | null = null;

		const fakeSpawn: SpeechSpawn = (cmd, args) => {
			spawnLog.push({ cmd, args });
			const child = new MockChildProcess();
			queueMicrotask(() => {
				child.emit("close", 0);
				closeNotifier?.();
			});
			return child as unknown as ChildProcessWithoutNullStreams;
		};

		const player = new SpeechPlayer({ spawn: fakeSpawn });
		speakExtension(pi, { player, customConfigPath: "/nonexistent/path.yml" });

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

		// 1. Check speed status
		await sayLastMsgHandler("speed", ctx);
		expect(notices.some(n => n.msg.includes("Current speech speed: 1.5x"))).toBe(true);

		// 2. Change speed to 1.75x
		await sayLastMsgHandler("speed 1.75", ctx);
		expect(notices.some(n => n.msg.includes("Speech speed set to 1.75x"))).toBe(true);

		// 3. Manual /say-last-message at 1.75x
		await sayLastMsgHandler("", ctx);
		expect(notices.some(n => n.msg.includes("1.75x"))).toBe(true);

		// 4. Enable auto-speak
		await sayLastMsgHandler("auto on", ctx);
		expect(notices.some(n => n.msg.includes("Auto-speak enabled"))).toBe(true);

		// 5. turn_end triggers speech
		spawnLog.length = 0;
		const { promise: completedFirst, resolve: resolveFirst } = Promise.withResolvers<void>();
		closeNotifier = resolveFirst;
		turnEndHandler!({}, ctx);
		await completedFirst;
		closeNotifier = null;

		expect(spawnLog.some(s => s.cmd === "ffmpeg" && s.args.includes("atempo=1.75"))).toBe(true);
	});
});
