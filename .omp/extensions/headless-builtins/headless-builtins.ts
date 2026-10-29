/**
 * Makes OMP's TUI-only built-in slash commands work over RPC (Paseo, omp-web,
 * any `omp --mode rpc|rpc-ui` client): /tan, /omfg and /btw.
 *
 * Some built-ins only have a TUI handler, so over RPC their text falls through
 * to the model as a plain prompt. This extension intercepts them on RPC input
 * (prompt, steer and follow-up all run input hooks) and runs OMP's own code
 * against the live AgentSession, adapting only the TUI surface (status lines,
 * dialogs, progress panels) to the RPC extension UI. The TUI keeps its
 * built-ins: the hook ignores every input source but "rpc".
 *
 * - /tan, /omfg: OMP's TUI command controllers with TUI calls mapped to RPC UI.
 *   Inside Paseo the /tan "Dispatched background tan bg_N" status is not posted:
 *   the noice-omp-slash-aliases plugin shows the tangent as a row of its own.
 * - /btw: OMP's headless RPC side-question engine (`RpcBtwController`, the
 *   handler of the RPC `btw` command): native prompt, full conversation memory,
 *   no history change, runs while a turn streams, answers saved to the
 *   session's /btw history. Inside Paseo (PASEO_AGENT_ID set) answers stream to
 *   the chat's outbox for the noice-omp-slash-aliases plugin (see btw-outbox.ts);
 *   elsewhere the finished answer is posted as a notification.
 *
 * Commands run in the background: the input hook returns at once, so a slow
 * command (or one waiting on a dialog) never holds up the session's input.
 * Failures are posted as error notifications.
 *
 * To add a command: add an entry to COMMANDS.
 *
 * Coupled to OMP internals (verified against omp 18.11.0): the module
 * specifiers below (OMP serves them from its own build), each controller's
 * constructor shape, RpcBtwController's frames, and AgentRegistry holding the
 * live AgentSession. If an update moves a module, the extension fails to load
 * (OMP reports the load error) and the commands are plain text over RPC again.
 * If the registry stops holding the live session, the command posts an error.
 */
import { OmfgController } from "@oh-my-pi/pi-coding-agent/modes/controllers/omfg-controller";
import { TanCommandController } from "@oh-my-pi/pi-coding-agent/modes/controllers/tan-command-controller";
import { RpcBtwController } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-btw";
import { BtwOutbox, type BtwRecord, btwOutboxDir, writeProcessMarker } from "./btw-outbox";

/** The parts of the live AgentSession the adapters touch. */
interface LiveSession {
	sessionManager: unknown;
	settings: unknown;
}

interface RegistryRef {
	session: LiveSession | null;
}

type NotifyType = "info" | "warning" | "error";

interface ExtensionUi {
	notify(message: string, type?: NotifyType): void;
	select(title: string, options: string[]): Promise<string | undefined>;
	confirm(title: string, message: string): Promise<boolean>;
	input(title: string, placeholder?: string): Promise<string | undefined>;
}

interface InputContext {
	sessionManager: unknown;
	ui: ExtensionUi;
}

interface InputEvent {
	text: string;
	source: string;
}

interface HeadlessBuiltinsApi {
	pi: { AgentRegistry: { global(): { list(): RegistryRef[] } } };
	on(
		event: "input",
		handler: (event: InputEvent, ctx: InputContext) => Promise<{ handled: true } | undefined>,
	): void;
}

/** Runs one invocation of a command; `args` is the trimmed text after the command name. */
type CommandRunner = (args: string) => Promise<void>;

/**
 * Builds a command's runner once per session, so its state (a running /btw, a
 * superseded /tan) persists across invocations as in the TUI. `ui` always
 * forwards to the UI of the latest input.
 */
type CommandFactory = (session: LiveSession, ui: ExtensionUi) => CommandRunner;

/** TUI status-line and dialog methods the controllers call, mapped to RPC extension UI. */
function hostDialogs(ui: ExtensionUi) {
	return {
		showStatus: (message: string) => ui.notify(message, "info"),
		showError: (message: string) => ui.notify(message, "error"),
		showHookConfirm: (title: string, message: string) => ui.confirm(title, message),
		showHookSelector: (title: string, options: string[]) => ui.select(title, options),
		showHookInput: (title: string, placeholder?: string) => ui.input(title, placeholder),
	};
}

/** The /omfg progress panel's terminal outcomes; everything else is in-progress status. */
interface OmfgPanel {
	markSaved(path: string): void;
	markRejected(): void;
	markAborted(): void;
	markError(message: string): void;
}

/**
 * /omfg renders its progress and outcome only in a TUI panel. Headless, nothing
 * draws the panel, so report its terminal outcome as a notification.
 */
function reportOmfgOutcome(panel: OmfgPanel, ui: ExtensionUi): void {
	const { markSaved, markRejected, markAborted, markError } = panel;
	panel.markSaved = path => {
		markSaved.call(panel, path);
		ui.notify(`/omfg: saved ${path} and registered it live.`, "info");
	};
	panel.markRejected = () => {
		markRejected.call(panel);
		ui.notify("/omfg: rule was not saved.", "warning");
	};
	panel.markAborted = () => {
		markAborted.call(panel);
		ui.notify("/omfg: cancelled.", "warning");
	};
	panel.markError = message => {
		markError.call(panel, message);
		ui.notify(`/omfg: ${message}`, "error");
	};
}

/** Frames RpcBtwController emits (the RPC host would forward them to its client). */
type BtwFrame =
	| { type: "btw_record"; record: BtwRecord }
	| { type: "btw_delta"; recordId: string; delta: string }
	| { type: "notice"; level: string; message: string };

/** Outside Paseo nothing reads the outbox; post the finished answer instead. */
function notifyBtwOutcome(record: BtwRecord, ui: ExtensionUi): void {
	if (record.status === "complete") ui.notify(`/btw ${record.question}\n\n${record.answer}`, "info");
	else if (record.status === "error") ui.notify(`/btw failed: ${record.error ?? "unknown error"}`, "error");
	else if (record.status === "cancelled") ui.notify("/btw cancelled.", "warning");
}

function btwCommand(session: LiveSession, ui: ExtensionUi): CommandRunner {
	const dir = btwOutboxDir(process.env);
	let outbox: BtwOutbox | undefined;
	const controller = new RpcBtwController(session, (frame: BtwFrame) => {
		switch (frame.type) {
			case "btw_record":
				if (outbox) outbox.record(frame.record);
				else notifyBtwOutcome(frame.record, ui);
				return;
			case "btw_delta":
				outbox?.delta(frame.recordId, frame.delta);
				return;
			case "notice":
				ui.notify(frame.message, frame.level === "error" ? "error" : "warning");
				return;
		}
	});
	if (dir) {
		outbox = new BtwOutbox({
			dir,
			agentId: process.env.PASEO_AGENT_ID as string,
			onDismissRunning: recordId => controller.cancel(recordId),
		});
	}
	return async question => {
		if (!question) {
			ui.notify("Usage: /btw <question>", "warning");
			return;
		}
		try {
			await controller.ask(question);
		} catch (error) {
			// Refused before a record existed (one already running, no model, …).
			if (!outbox) throw error;
			const now = Date.now();
			outbox.record({
				id: `refused-${now}`,
				question,
				answer: "",
				status: "error",
				error: error instanceof Error ? error.message : String(error),
				createdAt: now,
				updatedAt: now,
			});
		}
	};
}

/** TanCommandController's status line after it registered the tangent's background job. */
const TAN_DISPATCHED = /^Dispatched background tan \S+$/;

const COMMANDS: Record<string, CommandFactory> = {
	tan: (session, ui) => {
		const dialogs = hostDialogs(ui);
		const inPaseo = !!process.env.PASEO_AGENT_ID;
		const controller = new TanCommandController({
			...dialogs,
			showStatus: (message: string) => {
				if (!(inPaseo && TAN_DISPATCHED.test(message))) dialogs.showStatus(message);
			},
			session,
			sessionManager: session.sessionManager,
			settings: session.settings,
			// RPC mode keeps no MCP manager reachable from extensions; the tangent runs without MCP tools.
			mcpManager: undefined,
			// No transcript to redraw headless; the RPC client renders from session events.
			rebuildChatFromMessages: () => {},
		});
		return args => controller.start(args);
	},
	omfg: (session, ui) => {
		const controller = new OmfgController({
			...hostDialogs(ui),
			session,
			sessionManager: session.sessionManager,
			settings: session.settings,
			// The panel is never drawn; it only needs a render hook to call.
			ui: { requestRender: () => {} },
			omfgContainer: {
				clear: () => {},
				addChild: (panel: OmfgPanel) => reportOmfgOutcome(panel, ui),
			},
		});
		return args => controller.start(args);
	},
	btw: btwCommand,
};

const SLASH_COMMAND = /^\/([a-z][\w-]*)(?:\s+([\s\S]*))?$/;

/** Parses `/name args` for a known command; undefined for anything else. */
function parseCommand(text: string): { name: string; args: string } | undefined {
	const match = SLASH_COMMAND.exec(text.trim());
	const name = match?.[1];
	if (!match || !name || !Object.hasOwn(COMMANDS, name)) return undefined;
	return { name, args: (match[2] ?? "").trim() };
}

/**
 * The extension context hands out the session manager, not the AgentSession;
 * the AgentRegistry is where OMP keeps the live session for it.
 */
function findLiveSession(api: HeadlessBuiltinsApi, sessionManager: unknown): LiveSession | undefined {
	for (const ref of api.pi.AgentRegistry.global().list()) {
		if (ref.session && ref.session.sessionManager === sessionManager) return ref.session;
	}
	return undefined;
}

/** Per-session command runners plus the UI they report to. */
interface SessionCommands {
	ui: { current: ExtensionUi };
	runners: Map<string, CommandRunner>;
}

function forwardingUi(ref: { current: ExtensionUi }): ExtensionUi {
	return {
		notify: (message, type) => ref.current.notify(message, type),
		select: (title, options) => ref.current.select(title, options),
		confirm: (title, message) => ref.current.confirm(title, message),
		input: (title, placeholder) => ref.current.input(title, placeholder),
	};
}

export default function headlessBuiltins(api: HeadlessBuiltinsApi) {
	const sessions = new WeakMap<LiveSession, SessionCommands>();
	const btwDir = btwOutboxDir(process.env);
	// Tools launch nested non-RPC `omp` processes with the same environment; only RPC hosts take /btw.
	if (btwDir && process.argv.some(arg => /^(--mode=)?rpc(-ui)?$/.test(arg))) writeProcessMarker(btwDir, process.pid);

	function runner(session: LiveSession, name: string, ui: ExtensionUi): CommandRunner {
		let state = sessions.get(session);
		if (!state) {
			state = { ui: { current: ui }, runners: new Map() };
			sessions.set(session, state);
		}
		state.ui.current = ui;
		let run = state.runners.get(name);
		if (!run) {
			run = COMMANDS[name](session, forwardingUi(state.ui));
			state.runners.set(name, run);
		}
		return run;
	}

	api.on("input", async (event, ctx) => {
		if (event.source !== "rpc") return undefined;
		const command = parseCommand(event.text);
		if (!command) return undefined;

		const session = findLiveSession(api, ctx.sessionManager);
		if (!session) {
			ctx.ui.notify(`/${command.name}: could not find the live OMP session for this conversation.`, "error");
			return { handled: true };
		}
		const run = runner(session, command.name, ctx.ui);
		run(command.args).catch(error =>
			ctx.ui.notify(`/${command.name}: ${error instanceof Error ? error.message : String(error)}`, "error"),
		);
		return { handled: true };
	});
}
