/**
 * Scribe — a silent shadow ledger for long planning conversations.
 *
 * After each primary turn, a cheap side-channel model (Gemini 3.5 Flash,
 * medium reasoning) rewrites a small structured state of independently
 * resumable topic capsules. The extension validates that state in code —
 * caps, thread shape, and decision provenance (every decision must cite a
 * verbatim quote from the user turn it came from) — then renders it
 * deterministically to `.omp/scribe/LEDGER.md` in the project.
 *
 * The primary agent never waits: updates run detached, single-flight, and
 * coalesce. Failures keep the last good state and surface only in the
 * status line and `state.json`.
 *
 * Commands: /scribe on|off|status|show|refresh|note <text>
 *
 * Design notes:
 * - Incremental delta per turn + full-history rebase every REBASE_EVERY
 *   updates (or /scribe refresh). Incremental-only maintenance drifts;
 *   the rebase is the repair path.
 * - State is per-session: a different session id triggers a fresh rebuild.
 * - The model prompt lives in ledger-prompt.md next to this file so prompt
 *   tuning needs no process restart.
 * - Gated to UI-bearing sessions (subagents never scribe). SCRIBE_FORCE=1
 *   overrides for headless smoke tests.
 */
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MODEL_PATTERN = "google-antigravity/gemini-3.5-flash";
const THINKING_LEVEL = "medium";
const REBASE_EVERY = 10;
const MAX_ITEM_CHARS = 220;
const MAX_TURN_CHARS = 20_000;
const CAPS = {
	threads: 6,
	decisions: 6,
	facts: 8,
	options: 4,
	questions: 4,
	assumptions: 3,
	globalConstraints: 8,
} as const;
const THREAD_STATUSES = ["active", "paused", "blocked", "done"] as const;
const EXT_DIR = new URL(".", import.meta.url).pathname;

type ThreadStatus = (typeof THREAD_STATUSES)[number];

interface Decision {
	text: string;
	sourceTurn: number;
	evidence: string;
}

interface Thread {
	id: string;
	status: ThreadStatus;
	decisions: Decision[];
	facts: string[];
	options: string[];
	questions: string[];
	assumptions: string[];
}

interface LedgerState {
	threads: Thread[];
	global_constraints: string[];
	alert: string;
}

interface ScribeFile {
	version: 1;
	enabled: boolean;
	sessionId: string | null;
	processedTurns: number;
	updatesSinceRebase: number;
	updatedAt: string | null;
	lastError: string | null;
	/** User-asserted constraints from `/scribe note` — survive model rewrites by construction. */
	notes: string[];
	state: LedgerState;
}

interface Turn {
	user: string;
	assistant: string[];
	tools: string[];
}

/**
 * Minimal structural view of session entries and message content blocks.
 * Invariant: the omp session-entry format (`{type:"message", message:{role,
 * content}}` with `text`/`toolCall` blocks) — asserted once at this boundary.
 */
interface MessageEntryView {
	type: string;
	message?: {
		role?: string;
		content?: unknown;
	};
}
interface ContentBlockView {
	type?: string;
	text?: string;
	name?: string;
}

function emptyState(): LedgerState {
	return { threads: [], global_constraints: [], alert: "" };
}

function defaultFile(): ScribeFile {
	return {
		version: 1,
		enabled: false,
		sessionId: null,
		processedTurns: 0,
		updatesSinceRebase: 0,
		updatedAt: null,
		lastError: null,
		notes: [],
		state: emptyState(),
	};
}

function clampText(value: string, cap: number = MAX_ITEM_CHARS): string {
	const trimmed = value.trim();
	return trimmed.length > cap ? `${trimmed.slice(0, cap - 1)}…` : trimmed;
}

/** Lenient string-collection clamp for model output: drops non-strings instead of failing the update. */
function asStringArray(value: unknown, cap: number): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	for (const item of value) {
		if (out.length >= cap) break;
		if (typeof item !== "string") continue;
		const text = clampText(item);
		if (text) out.push(text);
	}
	return out;
}

/** User notes lead and take precedence; model-emitted duplicates are dropped. */
function mergeConstraints(notes: string[], modelConstraints: string[]): string[] {
	return [...notes, ...modelConstraints.filter(item => !notes.includes(item))].slice(0, CAPS.globalConstraints);
}

// ---------------------------------------------------------------------------
// Turn extraction from the session branch

function extractTurns(entries: readonly unknown[]): Turn[] {
	const turns: Turn[] = [];
	let current: Turn | undefined;
	for (const rawEntry of entries) {
		const entry = rawEntry as MessageEntryView; // session-entry format invariant, see MessageEntryView
		if (entry?.type !== "message" || !entry.message) continue;
		const { role, content } = entry.message;
		const blocks: readonly ContentBlockView[] = Array.isArray(content)
			? (content as readonly ContentBlockView[])
			: typeof content === "string"
				? [{ type: "text", text: content }]
				: [];
		if (role === "user") {
			const text = blocks
				.filter(block => block?.type === "text" && typeof block.text === "string")
				.map(block => block.text)
				.join("\n")
				.trim();
			if (!text) continue;
			current = { user: text, assistant: [], tools: [] };
			turns.push(current);
		} else if (role === "assistant" && current) {
			for (const block of blocks) {
				if (block?.type === "text" && typeof block.text === "string") current.assistant.push(block.text);
				else if (block?.type === "toolCall" && typeof block.name === "string") current.tools.push(block.name);
			}
		}
	}
	return turns;
}

function formatTurn(turn: Turn, turnNumber: number): string {
	const assistant = clampText(turn.assistant.join("\n\n"), MAX_TURN_CHARS) || "(no text reply)";
	const user = clampText(turn.user, MAX_TURN_CHARS);
	const tools = turn.tools.length > 0 ? `\n(tools used: ${[...new Set(turn.tools)].join(", ")})` : "";
	return `### Turn ${turnNumber} — USER\n${user}\n\n### Turn ${turnNumber} — ASSISTANT\n${assistant}${tools}`;
}

// ---------------------------------------------------------------------------
// Deterministic Markdown rendering — the model never writes this file

function renderSection(lines: string[], title: string, items: string[]): void {
	if (items.length === 0) return;
	lines.push(`**${title}**`);
	for (const item of items) lines.push(`- ${item}`);
	lines.push("");
}

function renderLedger(file: ScribeFile): string {
	const lines: string[] = ["# Ledger", ""];
	const session = file.sessionId ? file.sessionId.slice(0, 27) : "no session";
	const updated = file.updatedAt ? `${file.updatedAt.slice(0, 16).replace("T", " ")} UTC` : "never";
	lines.push(`> ${session} · turn ${file.processedTurns} · updated ${updated} · ${MODEL_PATTERN}`, "");
	if (file.lastError) lines.push(`> ⚠ last update failed: ${file.lastError}`, "");
	if (file.state.alert) lines.push(`> **ALERT:** ${file.state.alert}`, "");

	for (const thread of file.state.threads) {
		lines.push(`## [${thread.status}] ${thread.id}`, "");
		renderSection(
			lines,
			"Decisions",
			thread.decisions.map(decision => `${decision.text} *(turn ${decision.sourceTurn})*`),
		);
		renderSection(lines, "Facts", thread.facts);
		renderSection(lines, "Options", thread.options);
		renderSection(lines, "Open questions", thread.questions);
		renderSection(lines, "Assumptions", thread.assumptions);
	}

	const constraints = mergeConstraints(file.notes, file.state.global_constraints);
	if (constraints.length > 0) {
		lines.push("## Global constraints", "");
		for (const item of constraints) lines.push(`- ${item}`);
		lines.push("");
	}

	if (file.state.threads.length === 0 && constraints.length === 0) lines.push("_Nothing recorded yet._", "");
	return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Extension entry

export default function scribeExtension(pi: ExtensionAPI) {
	const z = pi.zod;

	// Boundary schemas. Model output is parsed leniently (per-item, so one bad
	// element never voids a whole update); our own state.json is parsed strictly.
	const DecisionSchema = z.object({
		text: z.string(),
		sourceTurn: z.number().int(),
		evidence: z.string(),
	});
	const ThreadEnvelopeSchema = z.object({
		id: z.string(),
		status: z.unknown().optional(),
		decisions: z.array(z.unknown()).optional(),
		facts: z.unknown().optional(),
		options: z.unknown().optional(),
		questions: z.unknown().optional(),
		assumptions: z.unknown().optional(),
	});
	const ResponseEnvelopeSchema = z.object({
		threads: z.array(z.unknown()).optional(),
		global_constraints: z.unknown().optional(),
		alert: z.unknown().optional(),
	});
	const StoredThreadSchema = z.object({
		id: z.string(),
		status: z.enum(THREAD_STATUSES),
		decisions: z.array(DecisionSchema),
		facts: z.array(z.string()),
		options: z.array(z.string()),
		questions: z.array(z.string()),
		assumptions: z.array(z.string()),
	});
	const ScribeFileSchema = z.object({
		version: z.literal(1),
		enabled: z.boolean(),
		sessionId: z.string().nullable(),
		processedTurns: z.number().int(),
		updatesSinceRebase: z.number().int(),
		updatedAt: z.string().nullable(),
		lastError: z.string().nullable(),
		notes: z.array(z.string()),
		state: z.object({
			threads: z.array(StoredThreadSchema),
			global_constraints: z.array(z.string()),
			alert: z.string(),
		}),
	});

	const loadFile = (cwd: string): ScribeFile => {
		let raw: string;
		try {
			raw = readFileSync(join(cwd, ".omp", "scribe", "state.json"), "utf8");
		} catch {
			return defaultFile();
		}
		try {
			const parsed = ScribeFileSchema.safeParse(JSON.parse(raw));
			return parsed.success ? parsed.data : defaultFile();
		} catch {
			return defaultFile();
		}
	};

	const saveFile = (cwd: string, file: ScribeFile): void => {
		const dir = join(cwd, ".omp", "scribe");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "state.json"), `${JSON.stringify(file, null, "\t")}\n`);
		writeFileSync(join(dir, "LEDGER.md"), renderLedger(file));
	};

	/** Validate a model response into LedgerState. Decision provenance is enforced here, in code. */
	const sanitizeState = (raw: string, turns: Turn[]): { state: LedgerState; rejectedDecisions: number } => {
		const start = raw.indexOf("{");
		const end = raw.lastIndexOf("}");
		if (start < 0 || end <= start) throw new Error(`no JSON object in scribe response: ${clampText(raw, 120)}`);
		const envelope = ResponseEnvelopeSchema.safeParse(JSON.parse(raw.slice(start, end + 1)));
		if (!envelope.success) throw new Error(`scribe response shape rejected: ${envelope.error.message}`);

		const state = emptyState();
		let rejectedDecisions = 0;
		for (const rawThread of envelope.data.threads ?? []) {
			if (state.threads.length >= CAPS.threads) break;
			const thread = ThreadEnvelopeSchema.safeParse(rawThread);
			if (!thread.success) continue;
			const id = thread.data.id.trim().slice(0, 64);
			if (!id) continue;

			const decisions: Decision[] = [];
			for (const rawDecision of thread.data.decisions ?? []) {
				if (decisions.length >= CAPS.decisions) break;
				const decision = DecisionSchema.safeParse(rawDecision);
				if (!decision.success) {
					rejectedDecisions++;
					continue;
				}
				const evidence = decision.data.evidence.trim();
				const sourceUser = turns[decision.data.sourceTurn - 1]?.user;
				// Provenance gate: without a verbatim user quote it is not a decision.
				if (!evidence || !sourceUser?.includes(evidence)) {
					rejectedDecisions++;
					continue;
				}
				const text = clampText(decision.data.text);
				if (!text) continue;
				decisions.push({ text, sourceTurn: decision.data.sourceTurn, evidence: clampText(evidence) });
			}

			state.threads.push({
				id,
				status: THREAD_STATUSES.find(status => status === thread.data.status) ?? "paused",
				decisions,
				facts: asStringArray(thread.data.facts, CAPS.facts),
				options: asStringArray(thread.data.options, CAPS.options),
				questions: asStringArray(thread.data.questions, CAPS.questions),
				assumptions: asStringArray(thread.data.assumptions, CAPS.assumptions),
			});
		}

		state.global_constraints = asStringArray(envelope.data.global_constraints, CAPS.globalConstraints);
		if (typeof envelope.data.alert === "string") {
			const alert = envelope.data.alert.trim();
			state.alert = /^(none|null|n\/a|-)?$/i.test(alert) ? "" : clampText(alert);
		}
		return { state, rejectedDecisions };
	};

	/** Side-channel one-shot: in-memory session, private registry, no tools, no discovery. */
	const runModel = async (ctx: ExtensionContext, prompt: string): Promise<string> => {
		const model = ctx.models.resolve(MODEL_PATTERN);
		if (!model) throw new Error(`model unavailable: ${MODEL_PATTERN}`);
		const systemPrompt = readFileSync(join(EXT_DIR, "ledger-prompt.md"), "utf8");
		const { createAgentSession, SessionManager, AgentRegistry } = pi.pi;
		const { session } = await createAgentSession({
			cwd: ctx.cwd,
			model,
			thinkingLevel: THINKING_LEVEL,
			systemPrompt,
			sessionManager: SessionManager.inMemory(),
			agentRegistry: new AgentRegistry(),
			disableExtensionDiscovery: true,
			skills: [],
			rules: [],
			contextFiles: [],
			enableMCP: false,
			enableLsp: false,
			toolNames: [],
			restrictToolNames: true,
		});
		try {
			let text = "";
			const unsubscribe = session.subscribe(event => {
				if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
					text += event.assistantMessageEvent.delta;
				}
			});
			await session.prompt(prompt);
			unsubscribe();
			return text;
		} finally {
			await session.dispose();
		}
	};

	const setStatus = (ctx: ExtensionContext, text: string | undefined): void => {
		try {
			ctx.ui.setStatus("scribe", text);
		} catch {
			// Status is best-effort decoration; never let it break an update.
		}
	};

	const update = async (ctx: ExtensionContext, forceRebase: boolean): Promise<void> => {
		const cwd = ctx.cwd;
		const file = loadFile(cwd);
		if (!file.enabled) return;
		if (!ctx.sessionManager.getSessionFile()) return; // nothing durable to scribe in --no-session runs

		const sessionId = ctx.sessionManager.getSessionId();
		if (file.sessionId !== sessionId) {
			file.sessionId = sessionId;
			file.processedTurns = 0;
			file.updatesSinceRebase = 0;
			file.state = emptyState();
			forceRebase = true;
		}

		const turns = extractTurns(ctx.sessionManager.getBranch());
		const rebase = forceRebase || file.updatesSinceRebase >= REBASE_EVERY;
		const startIndex = rebase ? 0 : file.processedTurns;
		if (turns.length <= startIndex) return;

		const baseState: LedgerState = rebase
			? emptyState()
			: { ...file.state, global_constraints: mergeConstraints(file.notes, file.state.global_constraints) };
		const delta = turns
			.slice(startIndex)
			.map((turn, index) => formatTurn(turn, startIndex + index + 1))
			.join("\n\n");

		setStatus(ctx, `scribe · updating (t${turns.length}${rebase ? " · rebase" : ""})`);
		const raw = await runModel(ctx, `# CURRENT STATE\n${JSON.stringify(baseState)}\n\n# DELTA\n${delta}\n\nReturn the complete new state.`);
		const { state, rejectedDecisions } = sanitizeState(raw, turns);

		// The branch may have moved (switch/branch/fork) while the model ran;
		// never write a stale session's state over the new one.
		if (ctx.sessionManager.getSessionId() !== sessionId) return;

		file.state = state;
		file.processedTurns = turns.length;
		file.updatesSinceRebase = rebase ? 0 : file.updatesSinceRebase + 1;
		file.updatedAt = new Date().toISOString();
		file.lastError = null;
		saveFile(cwd, file);

		const rejected = rejectedDecisions > 0 ? ` · ${rejectedDecisions} rejected` : "";
		setStatus(ctx, `scribe · ${state.threads.length} threads · t${turns.length}${rejected}`);
	};

	const recordError = (ctx: ExtensionContext, error: unknown): void => {
		const message = clampText(error instanceof Error ? error.message : String(error), 160);
		setStatus(ctx, `scribe · error: ${message}`);
		try {
			const file = loadFile(ctx.cwd);
			if (!file.enabled) return;
			file.lastError = message;
			saveFile(ctx.cwd, file);
		} catch {
			// Keeping the error visible on disk is best-effort.
		}
	};

	let running = false;
	let queued = false;
	let queuedRebase = false;

	/** Detached, single-flight, coalescing runner. Never throws, never blocks the primary turn. */
	const kick = (ctx: ExtensionContext, forceRebase = false): void => {
		if (running) {
			queued = true;
			queuedRebase ||= forceRebase;
			return;
		}
		running = true;
		void (async () => {
			try {
				await update(ctx, forceRebase);
			} catch (error) {
				recordError(ctx, error);
			} finally {
				running = false;
				if (queued) {
					queued = false;
					const rebase = queuedRebase;
					queuedRebase = false;
					kick(ctx, rebase);
				}
			}
		})();
	};

	pi.on("turn_end", (_event, ctx) => {
		// Subagents and RPC contexts never scribe; SCRIBE_FORCE=1 enables headless smoke tests.
		if (ctx.hasUI || process.env.SCRIBE_FORCE === "1") kick(ctx);
	});

	pi.registerCommand("scribe", {
		description: "Shadow ledger: on | off | status | show | refresh | note <text>",
		getArgumentCompletions: prefix => {
			const verbs = ["on", "off", "status", "show", "refresh", "note "];
			const matches = verbs.filter(verb => verb.startsWith(prefix.toLowerCase()));
			return matches.length > 0 ? matches.map(verb => ({ value: verb, label: verb.trim() })) : null;
		},
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			const verb = trimmed.split(/\s+/)[0]?.toLowerCase() ?? "";
			const rest = trimmed.slice(verb.length).trim();
			const ledgerPath = join(ctx.cwd, ".omp", "scribe", "LEDGER.md");
			const file = loadFile(ctx.cwd);

			switch (verb) {
				case "on": {
					file.enabled = true;
					saveFile(ctx.cwd, file);
					ctx.ui.notify(`scribe enabled — ledger at ${ledgerPath}`, "info");
					kick(ctx, true);
					return;
				}
				case "off": {
					file.enabled = false;
					saveFile(ctx.cwd, file);
					setStatus(ctx, undefined);
					ctx.ui.notify("scribe disabled — state kept on disk", "info");
					return;
				}
				case "status": {
					const threads = file.state.threads.map(thread => `${thread.id}(${thread.status})`).join(", ") || "none";
					const error = file.lastError ? ` · last error: ${file.lastError}` : "";
					ctx.ui.notify(
						`scribe ${file.enabled ? "on" : "off"} · turn ${file.processedTurns} · updated ${file.updatedAt ?? "never"} · threads: ${threads}${error}`,
						file.lastError ? "warning" : "info",
					);
					return;
				}
				case "show": {
					const alert = file.state.alert ? ` · ALERT: ${file.state.alert}` : "";
					ctx.ui.notify(`${ledgerPath} · ${file.state.threads.length} threads${alert}`, "info");
					return;
				}
				case "refresh": {
					if (!file.enabled) {
						ctx.ui.notify("scribe is off — `/scribe on` first", "warning");
						return;
					}
					kick(ctx, true);
					ctx.ui.notify("scribe · full rebase queued", "info");
					return;
				}
				case "note": {
					if (!rest) {
						ctx.ui.notify("usage: /scribe note <text>", "warning");
						return;
					}
					const note = clampText(rest);
					if (!file.notes.includes(note)) file.notes = [...file.notes, note].slice(-CAPS.globalConstraints);
					saveFile(ctx.cwd, file);
					ctx.ui.notify("scribe · note recorded", "info");
					return;
				}
				default: {
					ctx.ui.notify("usage: /scribe on | off | status | show | refresh | note <text>", "info");
					return;
				}
			}
		},
	});
}
