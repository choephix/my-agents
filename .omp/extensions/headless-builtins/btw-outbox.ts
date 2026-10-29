/**
 * Hands /btw answers from an OMP process to the Paseo plugin `noice-omp-slash-aliases`.
 *
 * Paseo starts every OMP agent with PASEO_AGENT_ID, so one outbox directory per
 * Paseo chat is the routing key: answers cannot land in another chat. Layout:
 *
 *   $PASEO_HOME/omp-btw/<agentId>/<recordId>.json        latest record state
 *   $PASEO_HOME/omp-btw/<agentId>/<recordId>.dismissed   written by the plugin
 *   $PASEO_HOME/omp-btw/<agentId>/.process-<pid>         this RPC OMP process has /btw support
 *
 * Record files are replaced atomically (write + rename), so a reader never sees
 * a partial file. A dismissal marker is final: once it exists the record file is
 * never written again, and a still-running answer is cancelled.
 *
 * Keep the file shape in sync with `paseo-plugins/noice-omp-slash-aliases/shared/btw.ts`.
 */
import { existsSync, mkdirSync, renameSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const BTW_FILE_VERSION = 1;

export type BtwStatus = "running" | "complete" | "cancelled" | "error" | "interrupted";

/** The fields of OMP's BtwHistoryRecord that Paseo shows. */
export interface BtwRecord {
	id: string;
	question: string;
	answer: string;
	status: BtwStatus;
	error?: string;
	createdAt: number;
	updatedAt: number;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** The outbox directory for this process's Paseo chat, or undefined outside Paseo. */
export function btwOutboxDir(env: Record<string, string | undefined>): string | undefined {
	const agentId = env.PASEO_AGENT_ID;
	if (!agentId || !SAFE_ID.test(agentId)) return undefined;
	const paseoHome = env.PASEO_HOME || join(env.HOME || homedir(), ".paseo");
	return join(paseoHome, "omp-btw", agentId);
}

/**
 * Records that this process handles /btw for the chat. The plugin refuses to send
 * /btw to a live RPC OMP process without it: an agent started before this
 * extension had /btw would pass the question to the model as an ordinary message.
 */
export function writeProcessMarker(dir: string, pid: number): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `.process-${pid}`), "");
}

/** Copies only the shown fields; OMP records also carry leafId and follow-ups. */
export function toBtwRecord(source: BtwRecord): BtwRecord {
	return {
		id: source.id,
		question: source.question,
		answer: source.answer,
		status: source.status,
		...(source.error ? { error: source.error } : {}),
		createdAt: source.createdAt,
		updatedAt: source.updatedAt,
	};
}

export interface BtwOutboxOptions {
	dir: string;
	agentId: string;
	/** Called when the plugin dismisses a record that is still running. */
	onDismissRunning(recordId: string): void;
	/** Minimum spacing of streaming writes for one record. */
	throttleMs?: number;
}

export class BtwOutbox {
	readonly #dir: string;
	readonly #agentId: string;
	readonly #onDismissRunning: (recordId: string) => void;
	readonly #throttleMs: number;
	readonly #records = new Map<string, BtwRecord>();
	/** Records with a streaming write scheduled; removing an id makes its scheduled write a no-op. */
	readonly #flushing = new Set<string>();
	#watcher: FSWatcher | undefined;

	constructor(options: BtwOutboxOptions) {
		this.#dir = options.dir;
		this.#agentId = options.agentId;
		this.#onDismissRunning = options.onDismissRunning;
		this.#throttleMs = options.throttleMs ?? 150;
	}

	/** A new or changed record (started, finished, failed, cancelled): written at once. */
	record(record: BtwRecord): void {
		if (!SAFE_ID.test(record.id)) throw new Error(`Unsafe /btw record id: ${record.id}`);
		const next = toBtwRecord(record);
		this.#records.set(next.id, next);
		this.#flushing.delete(next.id);
		this.#write(next);
		if (next.status !== "running") this.#records.delete(next.id);
		this.#syncWatcher();
	}

	/** A streamed answer fragment: coalesced into at most one write per throttle window. */
	delta(recordId: string, delta: string): void {
		const record = this.#records.get(recordId);
		if (!record || record.status !== "running") return;
		record.answer += delta;
		record.updatedAt = Date.now();
		if (this.#flushing.has(recordId)) return;
		this.#flushing.add(recordId);
		setTimeout(() => {
			if (!this.#flushing.delete(recordId)) return;
			const latest = this.#records.get(recordId);
			if (latest) this.#write(latest);
		}, this.#throttleMs);
	}

	close(): void {
		this.#flushing.clear();
		this.#watcher?.close();
		this.#watcher = undefined;
	}

	#write(record: BtwRecord): void {
		if (existsSync(join(this.#dir, `${record.id}.dismissed`))) return;
		mkdirSync(this.#dir, { recursive: true });
		const file = join(this.#dir, `${record.id}.json`);
		const temp = `${file}.${process.pid}.tmp`;
		writeFileSync(temp, JSON.stringify({ version: BTW_FILE_VERSION, agentId: this.#agentId, record }));
		renameSync(temp, file);
	}

	/** Watch for dismissals only while something can still be cancelled. */
	#syncWatcher(): void {
		const running = [...this.#records.values()].some(record => record.status === "running");
		if (running && !this.#watcher) {
			mkdirSync(this.#dir, { recursive: true });
			this.#watcher = watch(this.#dir, (_event, filename) => {
				const name = filename?.toString();
				if (!name?.endsWith(".dismissed")) return;
				const recordId = name.slice(0, -".dismissed".length);
				if (this.#records.get(recordId)?.status === "running") this.#onDismissRunning(recordId);
			});
		} else if (!running && this.#watcher) {
			this.#watcher.close();
			this.#watcher = undefined;
		}
	}
}
