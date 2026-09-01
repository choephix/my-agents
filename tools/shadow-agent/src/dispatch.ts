import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ShadowJob } from "./job";
import { isLedgerPointer, type LedgerPointer, parseCursor } from "./ledger";
import { cursorPath, ledgerPath } from "./paths";
import { type TailHandle, tailJsonl } from "./tail";
import { runWakeup } from "./wakeup";

export type Pending = { pointer: LedgerPointer; start: number; end: number };

export type DispatchHandle = { stop: () => Promise<void> };

const dim = (text: string): string => `\x1b[2m${text}\x1b[0m`;
const bold = (text: string): string => `\x1b[1m${text}\x1b[0m`;

export async function runJob(opts: {
	agentDir: string;
	job: ShadowJob;
	onExhausted?: () => void;
}): Promise<DispatchHandle> {
	const { agentDir, job } = opts;
	mkdirSync(path.dirname(cursorPath(agentDir, job.name)), { recursive: true });
	mkdirSync(path.dirname(ledgerPath(agentDir)), { recursive: true });

	const pending: Pending[] = [];
	let busy = false;
	let exhausted = false;
	let stopped = false;
	let costSpent = 0;
	let tokensSpent = 0;
	let scheduled = false;
	let lastSeenEnd = 0;

	const cursorFile = cursorPath(agentDir, job.name);
	const startOffset = await readCursor(cursorFile);
	lastSeenEnd = startOffset;

	function persistCursor(): void {
		const offset = pending[0]?.start ?? lastSeenEnd;
		writeFileSync(cursorFile, `${offset}\n`);
	}

	function matches(pointer: LedgerPointer): boolean {
		if (!job.matchCwd || job.matchCwd.length === 0) return true;
		return job.matchCwd.some(needle => pointer.cwd.includes(needle));
	}

	function trimCatchup(): void {
		if (pending.length <= job.catchupCap) return;
		const dropped = pending.splice(0, pending.length - job.catchupCap);
		process.stderr.write(
			`shadow-daemon: dropped ${dropped.length} old turn(s) (catchup_cap ${job.catchupCap})\n`,
		);
		persistCursor();
	}

	async function dispatch(): Promise<void> {
		if (stopped || exhausted || busy) return;
		trimCatchup();
		if (pending.length === 0) return;
		if (costSpent >= job.maxCostUsd) {
			exhausted = true;
			process.stdout.write(`\n${bold("▪ budget spent")} ${dim(`$${costSpent.toFixed(4)} — not waking again`)}\n`);
			opts.onExhausted?.();
			return;
		}

		const now = Date.now();
		const groups = groupBySession(pending);
		const ready = groups.find(group => {
			const newest = group[group.length - 1];
			if (!newest) return false;
			return Date.parse(newest.pointer.ts) + job.quiesceSecs * 1000 <= now;
		});
		if (!ready) return;

		busy = true;
		const batch = ready;
		const first = batch[0];
		if (!first) {
			busy = false;
			return;
		}
		for (const item of batch) {
			const index = pending.indexOf(item);
			if (index >= 0) pending.splice(index, 1);
		}
		const label = `${batch.length} turn${batch.length === 1 ? "" : "s"}`;
		process.stdout.write(
			`\n${bold(`▸ ${job.name} · ${label}`)} ${dim(`${first.pointer.cwd} · ${new Date().toLocaleTimeString()}`)}\n`,
		);
		try {
			const result = await runWakeup({
				agentDir,
				job,
				pointers: batch.map(item => item.pointer),
				onText: text => process.stdout.write(text),
			});
			costSpent += result.costUsd;
			tokensSpent += result.tokens;
		} catch (error) {
			process.stderr.write(
				`\nshadow-daemon: wakeup failed: ${error instanceof Error ? error.message : String(error)}\n`,
			);
			pending.unshift(...batch);
		} finally {
			busy = false;
			persistCursor();
		}
		process.stdout.write(
			`\n${dim(`— idle — ${(tokensSpent / 1000).toFixed(1)}k tok, $${costSpent.toFixed(4)} · ${pending.length} queued`)}\n`,
		);
		if (!stopped) void dispatch();
	}

	function schedule(): void {
		if (scheduled) return;
		scheduled = true;
		queueMicrotask(() => {
			scheduled = false;
			void dispatch();
		});
	}

	const tail: TailHandle = tailJsonl(ledgerPath(agentDir), { fromEnd: false, fromOffset: startOffset }, (entry, span) => {
		lastSeenEnd = Math.max(lastSeenEnd, span.end);
		if (!isLedgerPointer(entry) || !matches(entry)) return;
		pending.push({ pointer: entry, start: span.start, end: span.end });
		schedule();
	});

	const tick = setInterval(() => void dispatch(), 500);

	return {
		stop: async () => {
			stopped = true;
			clearInterval(tick);
			tail.stop();
			persistCursor();
		},
	};
}

export function groupBySession(pending: Pending[]): Pending[][] {
	const groups = new Map<string, Pending[]>();
	const order: string[] = [];
	for (const item of pending) {
		const key = item.pointer.session;
		let group = groups.get(key);
		if (!group) {
			group = [];
			groups.set(key, group);
			order.push(key);
		}
		group.push(item);
	}
	return order.map(key => groups.get(key) ?? []);
}

export async function skipJob(agentDir: string, name: string): Promise<number> {
	mkdirSync(path.dirname(cursorPath(agentDir, name)), { recursive: true });
	const offset = Number(Bun.file(ledgerPath(agentDir)).size);
	writeFileSync(cursorPath(agentDir, name), `${offset}\n`);
	return offset;
}

async function readCursor(file: string): Promise<number> {
	try {
		return parseCursor(await Bun.file(file).text());
	} catch {
		return 0;
	}
}
