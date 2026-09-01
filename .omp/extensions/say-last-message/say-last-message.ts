/**
 * /say-last-message (aliases: /speak, /say) — speak the last assistant prose
 * message aloud or toggle auto-speak.
 *
 * Uses `omp say` under the hood, piping audio to the default PulseAudio sink
 * (e.g. omp_remote_speaker), which feeds Rhinox Console or local audio.
 *
 * Commands:
 *   /say-last-message          speak the last assistant prose message
 *   /say-last-message <text>   speak custom text
 *   /say-last-message auto     toggle auto-speak for this session (default: off)
 *   /say-last-message auto on  enable auto-speak for this session
 *   /say-last-message auto off disable auto-speak for this session
 *   /say-last-message on | off shorthand for auto on / off
 *   /say-last-message status   check auto-speak status and current voice
 *   /say-last-message stop     stop any active speech playback
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
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
								block.type === "text" &&
								typeof (block as { text?: unknown }).text === "string",
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
	private spawnFn: SpeechSpawn;
	private ompPath: string;

	constructor(options: { spawn?: SpeechSpawn; ompPath?: string } = {}) {
		this.spawnFn =
			options.spawn ??
			((command, args, opts) => nodeSpawn(command, args, { ...opts, stdio: "pipe" }));
		this.ompPath = options.ompPath ?? resolveOmpPath();
	}

	stop(): boolean {
		if (this.activeChild) {
			try {
				this.activeChild.kill("SIGTERM");
			} catch {
				// Process might already have exited
			}
			this.activeChild = null;
			return true;
		}
		return false;
	}

	isPlaying(): boolean {
		return this.activeChild !== null;
	}

	async play(
		text: string,
		options: { voice?: string; onComplete?: (result: { success: boolean; error?: string }) => void } = {},
	): Promise<{ success: boolean; error?: string }> {
		this.stop(); // Preempt previous speech

		const voice = options.voice ?? getConfiguredVoice();
		const { promise, resolve } = Promise.withResolvers<{ success: boolean; error?: string }>();

		let child: ChildProcessWithoutNullStreams;
		try {
			child = this.spawnFn(this.ompPath, ["say", text, "--voice", voice], {});
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			const res = { success: false, error: errorMsg };
			options.onComplete?.(res);
			resolve(res);
			return promise;
		}

		this.activeChild = child;
		let stderr = "";

		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		child.on("error", error => {
			if (this.activeChild === child) this.activeChild = null;
			const res = { success: false, error: error.message };
			options.onComplete?.(res);
			resolve(res);
		});

		child.on("close", code => {
			if (this.activeChild === child) this.activeChild = null;
			const success = code === 0 || code === null;
			const res = success
				? { success: true }
				: { success: false, error: stderr.trim() || `Process exited with code ${code}` };
			options.onComplete?.(res);
			resolve(res);
		});

		return promise;
	}
}

export function parseSpeakCommand(args: string): {
	action: "speak_last" | "speak_text" | "auto_toggle" | "auto_on" | "auto_off" | "status" | "stop" | "help";
	text?: string;
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

	return { action: "speak_text", text: trimmed };
}

export const COMMAND_NAMES = ["say-last-message", "speak", "say"] as const;

export default function speakExtension(pi: ExtensionAPI, options: { player?: SpeechPlayer } = {}): void {
	pi.setLabel("Speak Assistant Messages");

	const player = options.player ?? new SpeechPlayer();
	const autoSpeakSessions = new Set<string>();

	const sessionKeyOf = (sessionManager?: ReadonlySessionManager): string =>
		sessionManager?.getSessionId?.() ?? "default";

	pi.on("turn_end", (_event, ctx) => {
		const sessionKey = sessionKeyOf(ctx.sessionManager);
		if (!autoSpeakSessions.has(sessionKey)) return;

		const entries = ctx.sessionManager?.getBranch?.() ?? [];
		const text = lastProse(entries);
		if (!text) return;

		void player.play(text, {
			onComplete: result => {
				if (!result.success && result.error) {
					ctx.ui.notify(`Auto-speak failed: ${result.error}`, "error");
				}
			},
		});
	});

	const commandDef = {
		description: "Speak assistant message aloud or toggle auto-speak (on|off|status|stop)",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const verbs = ["auto", "auto on", "auto off", "on", "off", "status", "stop", "help"];
			const matches = verbs.filter(v => v.startsWith(prefix.toLowerCase()));
			return matches.length > 0 ? matches.map(v => ({ value: v, label: v })) : null;
		},
		handler: async (args: string, ctx: ExtensionContext) => {
			const parsed = parseSpeakCommand(args);
			const sessionKey = sessionKeyOf(ctx.sessionManager);

			switch (parsed.action) {
				case "help": {
					ctx.ui.notify(
						"Usage: /say-last-message [text] | auto [on|off] | on | off | status | stop",
						"info",
					);
					return;
				}

				case "stop": {
					const stopped = player.stop();
					ctx.ui.notify(stopped ? "Speech playback stopped." : "No active speech playback.", "info");
					return;
				}

				case "status": {
					const enabled = autoSpeakSessions.has(sessionKey);
					const voice = getConfiguredVoice();
					ctx.ui.notify(
						`Auto-speak: ${enabled ? "enabled" : "disabled"} for this session (voice: ${voice})`,
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
					ctx.ui.notify("Speaking last assistant message...", "info");
					void player.play(text, {
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
					ctx.ui.notify("Speaking...", "info");
					void player.play(text, {
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
