/**
 * Moves a Paseo-hosted OMP chat around its own session tree, for the Paseo
 * plugin `session-tree` (`paseo-plugins/session-tree/`). OMP's `/tree` keeps
 * every branch in one session file and moves the "leaf" (the message the chat
 * continues from); Paseo has no RPC for that, so the plugin asks this
 * extension through files and then reloads the chat.
 *
 * Only `omp --mode rpc|rpc-ui` processes started by Paseo (PASEO_AGENT_ID set)
 * take part. Layout, one directory per Paseo chat:
 *
 *   $PASEO_HOME/omp-session-tree/<agentId>/.process-<pid>          this process serves requests
 *   $PASEO_HOME/omp-session-tree/<agentId>/<id>.request.json       written by the plugin
 *   $PASEO_HOME/omp-session-tree/<agentId>/<id>.claimed-<pid>.json the request, claimed by one process
 *   $PASEO_HOME/omp-session-tree/<agentId>/<id>.result.json        written here: running → done | cancelled | error
 *   $PASEO_HOME/omp-session-tree/<agentId>/<id>.cancel             written by the plugin: stop a running summary
 *
 * Requests (keep in sync with `paseo-plugins/session-tree/shared/link.ts`):
 * - `goto {target}`: `navigateTree(target)`. A user message moves to its
 *   parent (OMP's "edit and resend"); anything else becomes the leaf.
 * - `summarize {from, fork, focus}`: while the chat still sits at `fork` with
 *   nothing new sent, go back to `from` (the branch that was left) and then
 *   `navigateTree(fork, {summarize, customInstructions: focus})`. OMP writes
 *   a real `branch_summary` entry at the fork.
 *
 * A move without a summary writes nothing to the session file, and OMP and
 * Paseo both take the last line as the leaf. So every move ends with a
 * `custom` entry `paseo-session-tree` (hidden from the model and from Paseo)
 * under the new leaf; it also tells the plugin where the chat came from.
 *
 * Calls the live AgentSession (found in OMP's AgentRegistry by session file),
 * not `ctx.navigateTree`: the extension wrappers pass only `summarize` and
 * drop `customInstructions` (omp 18.12.2). Coupled to these AgentSession
 * members: navigateTree, abortBranchSummary, isBusyForSnapshot, sessionManager
 * (getSessionFile, getLeafId, getEntry, appendCustomEntry, flush).
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, watch, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const MARKER_TYPE = "paseo-session-tree";
const FILE_VERSION = 1;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
/** Requests older than this are left alone: the plugin has given up on them. */
const STALE_MS = 60_000;
/** Entries that carry conversation; anything else (markers, model usage, pins) is bookkeeping. */
const CONTENT_TYPES = new Set(["message", "custom_message", "branch_summary", "compaction"]);

interface Entry {
	type: string;
	id: string;
	parentId: string | null;
	display?: boolean;
}

/** Hidden custom messages (`display: false`, e.g. `eval-state-context` after a reload) are bookkeeping too. */
function isContent(entry: Entry): boolean {
	return CONTENT_TYPES.has(entry.type) && !(entry.type === "custom_message" && entry.display === false);
}

interface SessionManager {
	getSessionFile(): string | undefined;
	getLeafId(): string | null;
	getEntry(id: string): Entry | undefined;
	appendCustomEntry(customType: string, data?: unknown): string;
	flush(): Promise<void>;
}

interface NavigateResult {
	cancelled: boolean;
	aborted?: boolean;
	editorText?: string;
	summaryEntry?: { id: string };
}

interface LiveSession {
	sessionManager: SessionManager;
	isBusyForSnapshot: boolean;
	navigateTree(targetId: string, options?: { summarize?: boolean; customInstructions?: string }): Promise<NavigateResult>;
	abortBranchSummary(): void;
}

interface SessionTreeApi {
	pi: { AgentRegistry: { global(): { list(): { session: LiveSession | null }[] } } };
}

type Request =
	| { version: 1; id: string; createdAt: number; sessionFile: string; op: "goto"; target: string; kind: string }
	| { version: 1; id: string; createdAt: number; sessionFile: string; op: "summarize"; from: string; fork: string; focus: string };

type Result =
	| { status: "running"; phase: "switching" | "summarizing" }
	| { status: "done"; leafId: string | null; editorText?: string; summaryId?: string }
	| { status: "cancelled" }
	| { status: "error"; error: string };

function linkDir(env: Record<string, string | undefined>): string | undefined {
	const agentId = env.PASEO_AGENT_ID;
	if (!agentId || !SAFE_ID.test(agentId)) return undefined;
	return join(env.PASEO_HOME || join(env.HOME || homedir(), ".paseo"), "omp-session-tree", agentId);
}

function writeAtomic(path: string, value: unknown): void {
	const temp = `${path}.${process.pid}.tmp`;
	writeFileSync(temp, JSON.stringify(value));
	renameSync(temp, path);
}

function parseRequest(text: string): Request | undefined {
	const value = JSON.parse(text) as Partial<Request> & Record<string, unknown>;
	if (value.version !== FILE_VERSION || typeof value.id !== "string" || !SAFE_ID.test(value.id)) return undefined;
	if (typeof value.sessionFile !== "string" || typeof value.createdAt !== "number") return undefined;
	if (value.op === "goto" && typeof value.target === "string" && typeof value.kind === "string") return value as Request;
	if (value.op === "summarize" && typeof value.from === "string" && typeof value.fork === "string" && typeof value.focus === "string") {
		return value as Request;
	}
	return undefined;
}

/** True if the chat sits at `fork` with nothing but bookkeeping entries after it. */
function stillAtFork(manager: SessionManager, fork: string): boolean {
	let id = manager.getLeafId();
	while (id) {
		if (id === fork) return true;
		const entry = manager.getEntry(id);
		if (!entry || isContent(entry)) return false;
		id = entry.parentId;
	}
	return false;
}

export default function sessionTree(api: SessionTreeApi) {
	const dir = linkDir(process.env);
	// Tools can start nested non-RPC `omp` processes with the same environment; only Paseo's RPC host serves requests.
	if (!dir || !process.argv.some(arg => /^(--mode=)?rpc(-ui)?$/.test(arg))) return;
	// Loaded twice (config overlay and an extensions folder)? Serve once, or two watchers race for each request.
	const loaded = Symbol.for("paseo-session-tree.loaded");
	if (Reflect.get(globalThis, loaded)) return;
	Reflect.set(globalThis, loaded, true);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `.process-${process.pid}`), "");

	/** Request id → session whose branch summary that request is generating. */
	const summarizing = new Map<string, LiveSession>();
	let busy = false;

	function liveSession(sessionFile: string): LiveSession | undefined {
		for (const ref of api.pi.AgentRegistry.global().list()) {
			if (ref.session?.sessionManager.getSessionFile() === sessionFile) return ref.session;
		}
		return undefined;
	}

	async function run(request: Request, session: LiveSession): Promise<Result> {
		const manager = session.sessionManager;
		if (session.isBusyForSnapshot) return { status: "error", error: "The agent is busy. Try again when it has finished." };
		if (request.op === "goto") {
			const from = manager.getLeafId();
			if (!manager.getEntry(request.target)) return { status: "error", error: "That message is not in this chat any more." };
			const moved = await session.navigateTree(request.target);
			if (moved.cancelled) return { status: "cancelled" };
			const fork = manager.getLeafId();
			if (fork !== from) manager.appendCustomEntry(MARKER_TYPE, { v: 1, op: "goto", kind: request.kind, from, fork, requestId: request.id });
			await manager.flush();
			return { status: "done", leafId: fork, ...(moved.editorText ? { editorText: moved.editorText } : {}) };
		}
		if (!stillAtFork(manager, request.fork)) {
			return { status: "error", error: "A message was sent after going back, so the summary can no longer go at the branch point." };
		}
		if (!manager.getEntry(request.from)) return { status: "error", error: "The branch you left is not in this chat any more." };
		writeAtomic(join(dir!, `${request.id}.result.json`), { version: FILE_VERSION, id: request.id, updatedAt: Date.now(), status: "running", phase: "summarizing" });
		summarizing.set(request.id, session);
		let summary: NavigateResult;
		try {
			await session.navigateTree(request.from);
			summary = await session.navigateTree(request.fork, { summarize: true, ...(request.focus ? { customInstructions: request.focus } : {}) });
		} catch (error) {
			// Whatever failed, never leave the chat on the branch the user left.
			await session.navigateTree(request.fork).catch(() => undefined);
			manager.appendCustomEntry(MARKER_TYPE, { v: 1, op: "goto", kind: "resume", from: request.from, fork: request.fork, requestId: request.id });
			await manager.flush();
			throw error;
		} finally {
			summarizing.delete(request.id);
		}
		if (summary.cancelled) {
			await session.navigateTree(request.fork);
			manager.appendCustomEntry(MARKER_TYPE, { v: 1, op: "goto", kind: "resume", from: request.from, fork: request.fork, requestId: request.id });
			await manager.flush();
			return { status: "cancelled" };
		}
		const summaryId = summary.summaryEntry?.id;
		manager.appendCustomEntry(MARKER_TYPE, {
			v: 1, op: "summarize", from: request.from, fork: request.fork, focus: request.focus, summaryId, requestId: request.id,
		});
		await manager.flush();
		return { status: "done", leafId: manager.getLeafId(), ...(summaryId ? { summaryId } : {}) };
	}

	async function claim(name: string): Promise<void> {
		const id = name.slice(0, -".request.json".length);
		const path = join(dir!, name);
		let request: Request | undefined;
		try {
			request = parseRequest(readFileSync(path, "utf8"));
		} catch {
			return; // Half-written or already claimed by another process.
		}
		if (!request || request.id !== id || Date.now() - request.createdAt > STALE_MS) return;
		const session = liveSession(request.sessionFile);
		if (!session) return; // Another process (or none) holds this chat's session.
		try {
			renameSync(path, join(dir!, `${id}.claimed-${process.pid}.json`));
		} catch {
			return;
		}
		const resultPath = join(dir!, `${id}.result.json`);
		if (busy) {
			writeAtomic(resultPath, { version: FILE_VERSION, id, updatedAt: Date.now(), status: "error", error: "Another branch move is still running." });
			return;
		}
		busy = true;
		writeAtomic(resultPath, { version: FILE_VERSION, id, updatedAt: Date.now(), status: "running", phase: "switching" });
		let result: Result;
		try {
			result = await run(request, session);
		} catch (error) {
			result = { status: "error", error: error instanceof Error ? error.message : String(error) };
		} finally {
			busy = false;
		}
		writeAtomic(resultPath, { version: FILE_VERSION, id, updatedAt: Date.now(), ...result });
	}

	function scan(): void {
		let names: string[];
		try {
			names = readdirSync(dir!);
		} catch {
			return;
		}
		for (const name of names) {
			if (name.endsWith(".request.json")) void claim(name);
			else if (name.endsWith(".cancel")) {
				const id = name.slice(0, -".cancel".length);
				const session = summarizing.get(id);
				if (!session) continue;
				session.abortBranchSummary();
				rmSync(join(dir!, name), { force: true });
			}
		}
	}

	// Never keep OMP alive at exit just for this watcher.
	watch(dir, () => scan()).unref();
	scan();
}
