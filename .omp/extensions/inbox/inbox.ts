import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { homedir } from "node:os";
import type { AgentSession, ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

/**
 * An inbox for the running session: other programs on this machine (Stefan's desk) can send it a message as if he
 * typed it, watch its replies as they're written, and stop, steer or switch its model.
 *
 * While this omp runs a session it listens at `~/.omp/run/inbox/<session id>.sock`, in a folder only this user can
 * enter, and writes `~/.omp/run/inbox/<pid>.pid` holding that id ("this omp has an inbox"). The protocol is one JSON
 * line in, one JSON line out:
 *
 *   in:  {"text": "...", "key": "..."}   text: the message; key: delivered once, a retry with the same key is not a
 *                                        second turn. No text: only asks "open? busy? called what?".
 *   out: {"ok": true, "v": 2, "sessionId", "title", "idle"}
 *        {"ok": false, "moved": "<id>"}  this omp now runs another session (/new, /resume, a fork, or omp moved the
 *                                        session to a copy); it listens under the new id from now on.
 *
 * Idle, the message starts a turn. Busy, it waits behind the current turn (followUp). The composer's draft is never
 * touched.
 *
 * Version 2 adds commands, `{"cmd": …}` beside the same fields; each answers one line, as above, plus its own fields:
 *
 *   subscribe        the connection stays open: first `{"ev": "state", …}` with the whole live state, then one again
 *                    whenever it changes, at most every 50 ms while a reply streams (the timer exists only between a
 *                    change and its send). `{"ev": "moved", "sessionId"}` and the end when this omp leaves the session.
 *                    State: `busy`; `reply`, the assistant message being written: `at`, its `timestamp` (the same
 *                    number its entry in the session file carries), and `blocks` (text, thinking, tool calls as far as
 *                    written); `ended`, the last reply that finished: its `at` and `stopReason` (`stop`, `toolUse`,
 *                    `aborted`, `error`); `tools`, the tools running, with the last 4,000 characters of their output.
 *   abort, what?     stops the turn, or with `what: "shell"` only the shell commands run from here; answers `pending`:
 *                    whether messages still wait in omp's queue (they run next; an extension can't empty it)
 *   steer, text      cuts into the turn (`deliverAs: "steer"`); idle, it starts one, as a plain message would
 *   model, spec, thinking?   `spec` a model or role (`@sol`), resolved as omp's own `--model`; `thinking` a level
 *   thinking, level  only the level
 *   shell, command, context, key   runs `bash -lc command` in the session's folder; `context`: the model gets the
 *                    output on its next turn (`!`), else it's only recorded (`!!`). Answers when it ends: output, code.
 *                    One at a time, ended after 10 minutes.
 *   commands         the session's slash commands (extensions', prompt templates, skills; not omp's built-ins)
 *   resolve, specs   which of `specs` (models or roles, `@sol`) this omp can switch to: `models`, each spec's
 *                    `provider/id` or null (a role whose model omp's catalog doesn't have)
 *   compact          compacts the context
 *   command, text, key   runs a `/command` the session lists (`commands`) as omp's own prompt does: extension commands,
 *                    prompt templates, skills. Idle only. Answers once it started; what the command says shows in omp.
 *
 * A subscriber whose socket backs up past 1 MB is dropped; it subscribes again and gets the whole state.
 * Only the main agent listens; a subagent's memos belong to its parent. No timers while idle.
 */

const DIR = `${homedir()}/.omp/run/inbox`;
const PID_FILE = `${DIR}/${process.pid}.pid`;
const MAX_LINE = 1 << 20;
const BACKLOG = 1 << 20;
const TAIL = 4000;
const SHELL_TAIL = 50_000;
/** A desk shell command ends after 10 minutes: `!tail -f` or a password prompt would otherwise run until Stop. */
const SHELL_LIMIT = 600_000;
const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

interface Request {
	cmd?: unknown;
	text?: unknown;
	key?: unknown;
	spec?: unknown;
	thinking?: unknown;
	level?: unknown;
	command?: unknown;
	context?: unknown;
	what?: unknown;
	specs?: unknown;
}

type Block =
	| { type: "text"; text: string }
	| { type: "thinking"; thinking: string }
	| { type: "toolCall"; id: string; name: string; arguments: unknown; intent?: string };

interface LiveTool {
	id: string;
	name: string;
	intent?: string;
	tail: string;
}

/** The last `max` characters of a tool's partial or final result's text (`AgentToolResult.content`). */
function textOf(result: unknown, max: number): string {
	const content = (result as { content?: unknown } | null)?.content;
	if (!Array.isArray(content)) return "";
	const text = content.flatMap((block) => (block?.type === "text" && typeof block.text === "string" ? [block.text] : [])).join("");
	return text.length > max ? text.slice(-max) : text;
}

/** An assistant message's blocks as the desk draws them: signatures and pictures left out. */
function blocksOf(message: unknown): Block[] {
	const content = (message as { content?: unknown } | null)?.content;
	if (!Array.isArray(content)) return [];
	return content.flatMap((block): Block[] => {
		if (block?.type === "text") return [{ type: "text", text: String(block.text ?? "") }];
		if (block?.type === "thinking") return [{ type: "thinking", thinking: String(block.thinking ?? "") }];
		if (block?.type === "toolCall")
			return [{ type: "toolCall", id: String(block.id ?? ""), name: String(block.name ?? ""), arguments: block.arguments ?? {}, ...(block.intent ? { intent: String(block.intent) } : {}) }];
		return [];
	});
}

export default function inbox(pi: ExtensionAPI): void {
	let bound = "";
	let server: Server | null = null;
	let latest: ExtensionContext | null = null;
	const seen = new Set<string>();
	const subscribers = new Set<Socket>();
	const shells = new Map<string, AbortController>();

	// The live state subscribers get (see the header).
	let busy = false;
	let reply: { timestamp?: unknown } | null = null;
	let ended: { at: number; stopReason: string } | null = null;
	const tools = new Map<string, LiveTool>();
	let timer: ReturnType<typeof setTimeout> | null = null;

	const state = () => ({ ev: "state", busy, reply: reply ? { at: Number(reply.timestamp ?? 0), blocks: blocksOf(reply) } : null, ended, tools: [...tools.values()] });
	const write = (conn: Socket, line: object) => {
		if (conn.writableLength > BACKLOG) return void conn.destroy();
		conn.write(`${JSON.stringify(line)}\n`);
	};
	const flush = () => {
		clearTimeout(timer ?? undefined);
		timer = null;
		if (!subscribers.size) return;
		const line = state();
		for (const conn of subscribers) write(conn, line);
	};
	const soon = () => {
		if (subscribers.size) timer ??= setTimeout(flush, 50);
	};

	const close = () => {
		server?.close();
		server = null;
		for (const conn of subscribers) conn.end();
		subscribers.clear();
		if (bound) rmSync(`${DIR}/${bound}.sock`, { force: true });
		rmSync(PID_FILE, { force: true });
		bound = "";
	};

	const listen = (ctx: ExtensionContext) => {
		latest = ctx;
		const id = ctx.sessionManager.getSessionId();
		if (!id || id === bound) return;
		// Subscribers watched the old session: they're told where it went, then let go.
		for (const conn of subscribers) conn.end(`${JSON.stringify({ ev: "moved", sessionId: id })}\n`);
		subscribers.clear();
		close();
		mkdirSync(DIR, { recursive: true, mode: 0o700 });
		const path = `${DIR}/${id}.sock`;
		rmSync(path, { force: true }); // a killed omp leaves its socket file behind
		const next = createServer((conn) => serve(conn));
		next.on("error", () => {
			if (server === next) close();
		});
		next.listen(path);
		server = next;
		writeFileSync(PID_FILE, id);
		bound = id;
	};

	const shell = async (command: string, context: boolean, key: string, ctx: ExtensionContext) => {
		const abort = new AbortController();
		shells.set(key, abort);
		try {
			const result = await pi.exec("bash", ["-lc", command], { cwd: ctx.cwd, signal: abort.signal, timeout: SHELL_LIMIT });
			let output = `${result.stdout}${result.stderr}`;
			if (output.length > SHELL_TAIL) output = output.slice(-SHELL_TAIL);
			const details = { command, code: result.code, ...(result.killed ? { killed: true } : {}) };
			if (context) pi.sendMessage({ customType: "desk-shell", content: `$ ${command}\n${output}`, display: true, details }, { deliverAs: "nextTurn" });
			else pi.appendEntry("desk-shell", { ...details, output });
			return { output, code: result.code, killed: result.killed };
		} finally {
			shells.delete(key);
		}
	};

	// omp's `sendUserMessage` skips command handling on purpose, so a command goes to the live AgentSession (found as
	// `headless-builtins` finds it): its `prompt()` runs extension commands and prompt templates; skills, which omp's
	// terminal expands itself, go as omp's RPC mode sends them. The skill helpers load only here, so an omp update
	// that moves them breaks skills from the desk, not the inbox.
	const command = async (session: AgentSession, text: string) => {
		if (!text.startsWith("/skill:")) return void session.prompt(text).catch(() => { });
		const { buildSkillPromptMessage, parseSkillInvocation } = await import("@oh-my-pi/pi-coding-agent/extensibility/skills");
		const { SKILL_PROMPT_MESSAGE_TYPE } = await import("@oh-my-pi/pi-coding-agent/session/messages");
		const parsed = parseSkillInvocation(text);
		const skill = parsed && session.skills.find((each) => each.name === parsed.name);
		if (!parsed || !skill) throw new Error(`no skill ${text.split(/\s/, 1)[0]}`);
		const built = await buildSkillPromptMessage(skill, parsed, "user");
		const message = { customType: SKILL_PROMPT_MESSAGE_TYPE, content: built.message, display: true, details: built.details, attribution: "user" as const };
		void session.promptCustomMessage(message).catch(() => { });
	};

	const handle = async (msg: Request, conn: Socket): Promise<object | null> => {
		const ctx = latest!;
		const id = ctx.sessionManager.getSessionId();
		if (id !== bound) {
			listen(ctx);
			return { ok: false, moved: id };
		}
		const idle = ctx.isIdle();
		const info = { ok: true, v: 2, sessionId: id, title: ctx.sessionManager.getSessionName() ?? "", idle };
		const text = typeof msg.text === "string" ? msg.text : "";
		const key = typeof msg.key === "string" ? msg.key : "";
		const fresh = () => !key || !seen.has(key);
		const remember = () => key && seen.add(key);
		const fail = (error: unknown) => ({ ...info, ok: false, error: error instanceof Error ? error.message : String(error) });
		switch (msg.cmd) {
			case undefined:
				break;
			case "subscribe":
				subscribers.add(conn);
				conn.on("close", () => subscribers.delete(conn));
				write(conn, state());
				return null; // stays open
			case "abort":
				// `what`: "shell" stops only the desk's shell commands, else the turn. `pending`: messages still queued in
				// omp, which run next (an extension can't empty omp's queue).
				if (msg.what === "shell") for (const each of shells.values()) each.abort();
				else ctx.abort();
				return { ...info, pending: ctx.hasPendingMessages() };
			case "steer":
				if (!text || !fresh()) return info;
				remember();
				try {
					// Idle, a steer has no turn to cut into and would only wait in the queue (agent-session.ts `sendUserMessage`).
					await (idle ? pi.sendUserMessage(text) : pi.sendUserMessage(text, { deliverAs: "steer" }));
					return { ...info, state: idle ? "sent" : "steered" };
				} catch (error) {
					return fail(error);
				}
			case "model": {
				const spec = typeof msg.spec === "string" ? msg.spec : "";
				const model = spec ? ctx.models.resolve(spec) : undefined;
				if (!model) return fail(`no model for ${spec || "nothing"}`);
				try {
					if (!(await pi.setModel(model))) return fail(`no key for ${model.provider}/${model.id}`);
				} catch (error) {
					return fail(error);
				}
				if (typeof msg.thinking === "string" && LEVELS.includes(msg.thinking)) pi.setThinkingLevel(msg.thinking as never);
				// omp records the switch under role `default`; this says which role was picked (the desk's transcript reads it).
				if (spec.startsWith("@")) pi.appendEntry("desk-model", { role: spec.slice(1) });
				return { ...info, model: `${model.provider}/${model.id}`, thinking: pi.getThinkingLevel() ?? null };
			}
			case "thinking":
				if (typeof msg.level !== "string" || !LEVELS.includes(msg.level)) return fail(`no thinking level ${String(msg.level)}`);
				pi.setThinkingLevel(msg.level as never);
				return { ...info, thinking: pi.getThinkingLevel() ?? null };
			case "shell": {
				const command = typeof msg.command === "string" ? msg.command.trim() : "";
				if (!command || !fresh()) return info;
				// Mid-turn, the output for the model would only be saved after the next message (`nextTurn`), out of order.
				if (msg.context === true && !idle) return fail("omp is working: run it once the turn ends, or with !! to keep it from the model");
				// One at a time: a second would race the first for the card's working line and its Stop.
				if (shells.size) return fail("a shell command from the desk still runs: stop it or wait for it");
				remember();
				try {
					return { ...info, ...(await shell(command, msg.context === true, key || String(Math.random()), ctx)) };
				} catch (error) {
					return fail(error);
				}
			}
			case "resolve":
				return {
					...info,
					models: Object.fromEntries(
						(Array.isArray(msg.specs) ? msg.specs : []).flatMap((spec) => {
							if (typeof spec !== "string") return [];
							const model = ctx.models.resolve(spec);
							return [[spec, model ? `${model.provider}/${model.id}` : null]];
						}),
					),
				};
			case "commands":
				return { ...info, commands: pi.getCommands().map(({ name, description, source }) => ({ name, ...(description ? { description } : {}), source })) };
			case "compact":
				void Promise.resolve(ctx.compact()).catch(() => { });
				return info;
			case "command": {
				// Only commands this session lists: any other `/word` (omp's built-ins, `/tan`, `/tree`) would reach the
				// model as plain text.
				const name = text.startsWith("/") ? text.slice(1).split(/\s/, 1)[0] : "";
				if (!name || !pi.getCommands().some((each) => each.name === name)) return fail(`/${name} isn't one of this session's commands; omp's own (/tan, /tree, …) run only from its prompt`);
				if (!idle) return fail("omp is working: run it once the turn ends");
				if (!fresh()) return info;
				const session = pi.pi.AgentRegistry.global().list().find((ref) => ref.session?.sessionManager === ctx.sessionManager)?.session;
				if (!session) return fail("couldn't find this omp's live session");
				remember();
				try {
					await command(session, text);
					return info;
				} catch (error) {
					return fail(error);
				}
			}
			default:
				return fail(`unknown command ${String(msg.cmd)}`);
		}
		if (!text || !fresh()) return info;
		remember();
		const sent = idle ? pi.sendUserMessage(text) : pi.sendUserMessage(text, { deliverAs: "followUp" });
		void Promise.resolve(sent).catch(() => { });
		return info;
	};

	const serve = (conn: Socket) => {
		let buffer = "";
		let taken = false;
		conn.setEncoding("utf8");
		conn.on("error", () => conn.destroy());
		conn.on("data", (chunk: string) => {
			if (taken) return; // one request per connection; a subscriber sends nothing more
			buffer += chunk;
			const end = buffer.indexOf("\n");
			if (end < 0) {
				if (buffer.length > MAX_LINE) conn.destroy();
				return;
			}
			taken = true;
			let msg: Request;
			try {
				msg = JSON.parse(buffer.slice(0, end)) as Request;
			} catch (error) {
				return void conn.end(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
			}
			handle(msg, conn).then(
				(reply) => reply && conn.end(`${JSON.stringify(reply)}\n`),
				(error) => conn.end(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`),
			);
		});
	};

	const onSession = (_event: unknown, ctx: ExtensionContext) => {
		if (main(ctx)) listen(ctx);
	};
	pi.on("session_start", onSession);
	pi.on("session_switch", onSession);
	pi.on("session_branch", onSession);
	pi.on("session_shutdown", (_event, ctx) => {
		if (main(ctx)) close();
	});

	// The live state. Only the main agent's session and events count (handlers run for subagents too); some hosts (omp's
	// RPC mode with every extension loaded) give no `ctx.agent`: that is the main agent.
	function main(ctx: ExtensionContext) {
		return (ctx.agent?.kind ?? "main") === "main";
	}
	pi.on("agent_start", (_event, ctx) => {
		if (!main(ctx)) return;
		busy = true;
		ended = null;
		flush();
	});
	pi.on("agent_end", (_event, ctx) => {
		if (!main(ctx)) return;
		// A reply cut off before it finished (Esc, a provider error) gets no message_end: it goes here.
		busy = false;
		reply = null;
		tools.clear();
		flush();
	});
	pi.on("message_update", (event, ctx) => {
		if (!main(ctx)) return;
		reply = event.message;
		soon();
	});
	pi.on("message_end", (event, ctx) => {
		if (!main(ctx) || (event.message as { role?: string }).role !== "assistant") return;
		reply = null;
		const message = event.message as { stopReason?: string; timestamp?: unknown };
		ended = { at: Number(message.timestamp ?? 0), stopReason: String(message.stopReason ?? "stop") };
		flush();
	});
	pi.on("tool_execution_start", (event, ctx) => {
		if (!main(ctx)) return;
		tools.set(event.toolCallId, { id: event.toolCallId, name: event.toolName, ...(event.intent ? { intent: event.intent } : {}), tail: "" });
		soon();
	});
	pi.on("tool_execution_update", (event, ctx) => {
		const tool = main(ctx) ? tools.get(event.toolCallId) : undefined;
		if (!tool) return;
		tool.tail = textOf(event.partialResult, TAIL);
		soon();
	});
	pi.on("tool_execution_end", (event, ctx) => {
		if (!main(ctx)) return;
		tools.delete(event.toolCallId);
		soon();
	});
}
