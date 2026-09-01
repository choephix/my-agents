/**
 * /say-last-message (aliases: /speak, /say) — speak the last assistant prose
 * message aloud or toggle auto-speak, with speed control.
 *
 * Uses `omp say` for Kokoro TTS synthesis and `ffmpeg atempo` for pitch-preserving
 * playback speed adjustment (e.g. 1.5x) to axalon's default PulseAudio sink.
 *
 * Commands:
 *   /say-last-message          speak the last assistant prose message
 *   /say-last-message <text>   speak custom text
 *   /say-last-message speed    check or set playback speed (e.g. speed 1.5 or 1.5x)
 *   /say-last-message auto     toggle auto-speak for this session (default: off)
 *   /say-last-message auto on  enable auto-speak for this session
 *   /say-last-message auto off disable auto-speak for this session
 *   /say-last-message on | off shorthand for auto on / off
 *   /say-last-message status   check auto-speak status, voice, and speed
 *   /say-last-message stop     stop any active speech playback
 */
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
	type ChildProcessWithoutNullStreams,
	spawn as nodeSpawn,
	type SpawnOptionsWithoutStdio,
} from "node:child_process";
import type {
	ExtensionAPI,
	ExtensionContext,
	ReadonlySessionManager,
	SessionEntry,
} from "@oh-my-pi/pi-coding-agent";
import type { AutocompleteItem } from "@oh-my-pi/pi-tui";

const DEFAULT_VOICE = "af_aoede";
const DEFAULT_SPEED = 1.5;

/** Read the configured voice from ~/.omp/agent/config.yml or ~/.omp/speech.yml if present. */
export function getConfiguredVoice(customConfigPath?: string): string {
	const pathsToTry = customConfigPath
		? [customConfigPath]
		: [
				join(homedir(), ".omp", "agent", "config.yml"),
				join(homedir(), ".omp", "speech.yml"),
			];
	for (const configPath of pathsToTry) {
		try {
			if (existsSync(configPath)) {
				const content = readFileSync(configPath, "utf8");
				const match = content.match(/^[ \t]*voice:[ \t]*([a-zA-Z0-9_-]+)/m);
				if (match && match[1]) {
					return match[1].trim();
				}
			}
		} catch {
			// ignore read errors, try next or fallback
		}
	}
	return DEFAULT_VOICE;
}

/** Read the configured speed from ~/.omp/agent/config.yml or ~/.omp/speech.yml if present. */
export function getConfiguredSpeed(customConfigPath?: string): number {
	const pathsToTry = customConfigPath
		? [customConfigPath]
		: [
				join(homedir(), ".omp", "agent", "config.yml"),
				join(homedir(), ".omp", "speech.yml"),
			];
	for (const configPath of pathsToTry) {
		try {
			if (existsSync(configPath)) {
				const content = readFileSync(configPath, "utf8");
				const match = content.match(/^[ \t]*speed:[ \t]*([0-9.]+)/m);
				if (match && match[1]) {
					const parsed = Number.parseFloat(match[1]);
					if (!Number.isNaN(parsed) && parsed >= 0.5 && parsed <= 3.0) {
						return parsed;
					}
				}
			}
		} catch {
			// ignore read errors, try next or fallback
		}
	}
	return DEFAULT_SPEED;
}

/**
 * Extract the last assistant prose text, skipping tool execution blocks and
 * intermediate reasoning.
 */
export function lastProse(entries: readonly SessionEntry[]): string | null {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;

		const content = entry.message.content;
		if (Array.isArray(content)) {
			// If the message contains tool calls, it was mid-run execution, not the final prose answer.
			const hasToolCall = content.some(
				block =>
					block &&
					typeof block === "object" &&
					"type" in block &&
					(block.type === "toolCall" || block.type === "tool_use" || block.type === "tool_call"),
			);
			if (hasToolCall) continue;

			const text = content
				.filter(
					(block): block is { type: "text"; text: string } =>
						Boolean(
							block &&
								typeof block === "object" &&
								"type" in block &&
								block.type === "text" &&
								"text" in block &&
								typeof block.text === "string",
						),
				)
				.map(block => block.text)
				.join("")
				.trim();

			if (text) return text;
		} else if (typeof content === "string") {
			const text = content.trim();
			if (text) return text;
		}
	}
	return null;
}

export function resolveOmpPath(): string {
	if (process.env.OMP_BIN) return process.env.OMP_BIN;
	if (
		process.execPath &&
		(process.execPath.endsWith("/omp") || process.execPath.endsWith("\\omp") || process.execPath === "omp")
	) {
		return process.execPath;
	}
	return "omp";
}

export type SpeechSpawn = (
	command: string,
	args: readonly string[],
	options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

export class SpeechPlayer {
	private activeChild: ChildProcessWithoutNullStreams | null = null;
	private activeTmpFile: string | null = null;
	private spawnFn: SpeechSpawn;
	private ompPath: string;

	constructor(options: { spawn?: SpeechSpawn; ompPath?: string } = {}) {
		this.spawnFn =
			options.spawn ??
			((command, args, opts) => nodeSpawn(command, args, { ...opts, stdio: "pipe" }));
		this.ompPath = options.ompPath ?? resolveOmpPath();
	}

	private cleanupTmpFile(): void {
		if (this.activeTmpFile) {
			try {
				if (existsSync(this.activeTmpFile)) {
					unlinkSync(this.activeTmpFile);
				}
			} catch {
				// ignore cleanup error
			}
			this.activeTmpFile = null;
		}
	}

	stop(): boolean {
		let stopped = false;
		if (this.activeChild) {
			try {
				this.activeChild.kill("SIGTERM");
				stopped = true;
			} catch {
				// Process might already have exited
			}
			this.activeChild = null;
		}
		this.cleanupTmpFile();
		return stopped;
	}

	isPlaying(): boolean {
		return this.activeChild !== null;
	}

	async play(
		text: string,
		options: {
			voice?: string;
			speed?: number;
			onComplete?: (result: { success: boolean; error?: string }) => void;
		} = {},
	): Promise<{ success: boolean; error?: string }> {
		this.stop(); // Preempt previous speech

		const voice = options.voice ?? getConfiguredVoice();
		const speed = options.speed ?? getConfiguredSpeed();
		const { promise, resolve } = Promise.withResolvers<{ success: boolean; error?: string }>();

		const tmpWav = join(
			tmpdir(),
			`omp-speech-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`,
		);
		this.activeTmpFile = tmpWav;

		// Step 1: Synthesize text to temporary WAV
		let synthChild: ChildProcessWithoutNullStreams;
		try {
			synthChild = this.spawnFn(
				this.ompPath,
				["say", text, "--out", tmpWav, "--voice", voice],
				{},
			);
		} catch (error) {
			this.cleanupTmpFile();
			const errorMsg = error instanceof Error ? error.message : String(error);
			const res = { success: false, error: errorMsg };
			options.onComplete?.(res);
			resolve(res);
			return promise;
		}

		this.activeChild = synthChild;
		let synthStderr = "";

		synthChild.stderr?.on("data", (chunk: Buffer) => {
			synthStderr += chunk.toString();
		});

		synthChild.on("error", error => {
			if (this.activeChild === synthChild) this.activeChild = null;
			this.cleanupTmpFile();
			const res = { success: false, error: error.message };
			options.onComplete?.(res);
			resolve(res);
		});

		synthChild.on("close", code => {
			if (this.activeChild === synthChild) this.activeChild = null;
			if (code !== 0 && code !== null) {
				this.cleanupTmpFile();
				const res = {
					success: false,
					error: synthStderr.trim() || `Synthesis failed with code ${code}`,
				};
				options.onComplete?.(res);
				resolve(res);
				return;
			}

			// Step 2: Playback WAV through ffmpeg to pulse default sink with atempo filter
			const atempoFilter = speed === 1.0 ? [] : ["-filter:a", `atempo=${speed}`];
			const playArgs = [
				"-hide_banner",
				"-loglevel",
				"error",
				"-nostdin",
				"-i",
				tmpWav,
				...atempoFilter,
				"-f",
				"pulse",
				"default",
			];

			let playChild: ChildProcessWithoutNullStreams;
			try {
				playChild = this.spawnFn("ffmpeg", playArgs, {});
			} catch (error) {
				this.cleanupTmpFile();
				const errorMsg = error instanceof Error ? error.message : String(error);
				const res = { success: false, error: errorMsg };
				options.onComplete?.(res);
				resolve(res);
				return;
			}

			this.activeChild = playChild;
			let playStderr = "";

			playChild.stderr?.on("data", (chunk: Buffer) => {
				playStderr += chunk.toString();
			});

			playChild.on("error", error => {
				if (this.activeChild === playChild) this.activeChild = null;
				this.cleanupTmpFile();
				const res = { success: false, error: error.message };
				options.onComplete?.(res);
				resolve(res);
			});

			playChild.on("close", playCode => {
				if (this.activeChild === playChild) this.activeChild = null;
				this.cleanupTmpFile();
				const success = playCode === 0 || playCode === null;
				const res = success
					? { success: true }
					: {
							success: false,
							error: playStderr.trim() || `Playback failed with code ${playCode}`,
						};
				options.onComplete?.(res);
				resolve(res);
			});
		});

		return promise;
	}
}

export function parseSpeakCommand(args: string): {
	action:
		| "speak_last"
		| "speak_text"
		| "auto_toggle"
		| "auto_on"
		| "auto_off"
		| "status"
		| "speed"
		| "stop"
		| "help";
	text?: string;
	speed?: number;
} {
	const trimmed = args.trim();
	if (!trimmed) {
		return { action: "speak_last" };
	}

	const lower = trimmed.toLowerCase();

	if (lower === "help" || lower === "--help" || lower === "-h") {
		return { action: "help" };
	}
	if (lower === "stop") {
		return { action: "stop" };
	}
	if (lower === "status" || lower === "auto status") {
		return { action: "status" };
	}
	if (lower === "auto") {
		return { action: "auto_toggle" };
	}
	if (lower === "auto on" || lower === "on") {
		return { action: "auto_on" };
	}
	if (lower === "auto off" || lower === "off") {
		return { action: "auto_off" };
	}

	// Speed commands: "speed", "speed 1.5", "1.5x"
	const speedMatch = lower.match(/^speed(?:\s+([0-9.]+))?$/);
	if (speedMatch) {
		const rawVal = speedMatch[1];
		if (!rawVal) return { action: "speed" };
		const num = Number.parseFloat(rawVal);
		if (!Number.isNaN(num) && num >= 0.5 && num <= 3.0) {
			return { action: "speed", speed: num };
		}
	}

	const xMatch = lower.match(/^([0-9.]+)x$/);
	if (xMatch && xMatch[1]) {
		const num = Number.parseFloat(xMatch[1]);
		if (!Number.isNaN(num) && num >= 0.5 && num <= 3.0) {
			return { action: "speed", speed: num };
		}
	}

	return { action: "speak_text", text: trimmed };
}

export const COMMAND_NAMES = ["say-last-message", "speak", "say"] as const;

export default function speakExtension(
	pi: ExtensionAPI,
	options: { player?: SpeechPlayer; customConfigPath?: string } = {},
): void {
	pi.setLabel("Speak Assistant Messages");

	const player = options.player ?? new SpeechPlayer();
	const autoSpeakSessions = new Set<string>();
	const sessionSpeedMap = new Map<string, number>();

	const sessionKeyOf = (sessionManager?: ReadonlySessionManager): string =>
		sessionManager?.getSessionId?.() ?? "default";

	const getSpeedFor = (sessionKey: string): number =>
		sessionSpeedMap.get(sessionKey) ?? getConfiguredSpeed(options.customConfigPath);
	pi.on("turn_end", (_event, ctx) => {
		const sessionKey = sessionKeyOf(ctx.sessionManager);
		if (!autoSpeakSessions.has(sessionKey)) return;

		const entries = ctx.sessionManager?.getBranch?.() ?? [];
		const text = lastProse(entries);
		if (!text) return;

		const speed = getSpeedFor(sessionKey);
		void player.play(text, {
			speed,
			onComplete: result => {
				if (!result.success && result.error) {
					ctx.ui.notify(`Auto-speak failed: ${result.error}`, "error");
				}
			},
		});
	});

	const commandDef = {
		description: "Speak assistant message aloud or toggle auto-speak (on|off|status|speed|stop)",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const verbs = [
				"auto",
				"auto on",
				"auto off",
				"on",
				"off",
				"status",
				"speed",
				"speed 1.25",
				"speed 1.5",
				"speed 1.75",
				"speed 2.0",
				"1.5x",
				"stop",
				"help",
			];
			const matches = verbs.filter(v => v.startsWith(prefix.toLowerCase()));
			return matches.length > 0 ? matches.map(v => ({ value: v, label: v })) : null;
		},
		handler: async (args: string, ctx: ExtensionContext) => {
			const parsed = parseSpeakCommand(args);
			const sessionKey = sessionKeyOf(ctx.sessionManager);

			switch (parsed.action) {
				case "help": {
					ctx.ui.notify(
						"Usage: /say-last-message [text] | speed [N|Nx] | auto [on|off] | on | off | status | stop",
						"info",
					);
					return;
				}

				case "stop": {
					const stopped = player.stop();
					ctx.ui.notify(
						stopped ? "Speech playback stopped." : "No active speech playback.",
						"info",
					);
					return;
				}

				case "speed": {
					if (parsed.speed !== undefined) {
						sessionSpeedMap.set(sessionKey, parsed.speed);
						ctx.ui.notify(
							`Speech speed set to ${parsed.speed}x for this session.`,
							"info",
						);
					} else {
						const current = getSpeedFor(sessionKey);
						ctx.ui.notify(`Current speech speed: ${current}x`, "info");
					}
					return;
				}

				case "status": {
					const enabled = autoSpeakSessions.has(sessionKey);
					const voice = getConfiguredVoice(options.customConfigPath);
					ctx.ui.notify(
						`Auto-speak: ${enabled ? "enabled" : "disabled"} for this session (voice: ${voice}, speed: ${speed}x)`,
						"info",
					);
					return;
				}

				case "auto_on": {
					autoSpeakSessions.add(sessionKey);
					ctx.ui.notify("Auto-speak enabled for this session (speaks at turn end).", "info");
					return;
				}

				case "auto_off": {
					autoSpeakSessions.delete(sessionKey);
					ctx.ui.notify("Auto-speak disabled for this session.", "info");
					return;
				}

				case "auto_toggle": {
					if (autoSpeakSessions.has(sessionKey)) {
						autoSpeakSessions.delete(sessionKey);
						ctx.ui.notify("Auto-speak disabled for this session.", "info");
					} else {
						autoSpeakSessions.add(sessionKey);
						ctx.ui.notify("Auto-speak enabled for this session (speaks at turn end).", "info");
					}
					return;
				}

				case "speak_last": {
					const entries = ctx.sessionManager?.getBranch?.() ?? [];
					const text = lastProse(entries);
					if (!text) {
						ctx.ui.notify("No assistant prose message found to speak.", "warning");
						return;
					}
					const speed = getSpeedFor(sessionKey);
					ctx.ui.notify(`Speaking last assistant message (${speed}x)...`, "info");
					void player.play(text, {
						speed,
						onComplete: result => {
							if (!result.success && result.error) {
								ctx.ui.notify(`Speech playback failed: ${result.error}`, "error");
							}
						},
					});
					return;
				}

				case "speak_text": {
					const text = parsed.text;
					if (!text) {
						ctx.ui.notify("No text to speak.", "warning");
						return;
					}
					const speed = getSpeedFor(sessionKey);
					ctx.ui.notify(`Speaking (${speed}x)...`, "info");
					void player.play(text, {
						speed,
						onComplete: result => {
							if (!result.success && result.error) {
								ctx.ui.notify(`Speech playback failed: ${result.error}`, "error");
							}
						},
					});
					return;
				}
			}
		},
	};

	for (const name of COMMAND_NAMES) {
		pi.registerCommand(name, commandDef);
	}
}
