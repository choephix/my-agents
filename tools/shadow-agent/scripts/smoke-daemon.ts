#!/usr/bin/env bun
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { groupBySession, skipJob, type Pending } from "../src/dispatch";
import { parseJobToml, loadJob } from "../src/job";
import { isLedgerPointer, parseCursor } from "../src/ledger";
import { cursorPath, ledgerPath } from "../src/paths";
import { sliceSession } from "../src/session-read";
import { tailJsonl } from "../src/tail";

function assert(cond: unknown, message: string): asserts cond {
	if (!cond) throw new Error(message);
}

const toml = parseJobToml(`
name = "journal"
quiesce_secs = 0
catchup_cap = 100
max_cost_usd = 50
match_cwd = ["nilo", "my-agents"]
instruction = """
line one
line two
"""
`);
assert(toml.name === "journal", "toml name");
assert(toml.quiesce_secs === 0, "toml quiesce");
assert(Array.isArray(toml.match_cwd) && toml.match_cwd[1] === "my-agents", "toml array");
assert(typeof toml.instruction === "string" && toml.instruction.includes("line two"), "toml instruction");

const job = await loadJob(path.join(import.meta.dir, "../examples/journal.toml"));
assert(job.name === "journal", "loadJob name");
assert(job.model.includes("luna"), "loadJob default-or-set model");
assert(job.instruction.includes("journal.md"), "loadJob instruction");

const pending: Pending[] = [
	{ pointer: { ts: "1", session: "/a.jsonl", cwd: "/a" }, start: 0, end: 10 },
	{ pointer: { ts: "2", session: "/b.jsonl", cwd: "/b" }, start: 10, end: 20 },
	{ pointer: { ts: "3", session: "/a.jsonl", cwd: "/a" }, start: 20, end: 30 },
];
const groups = groupBySession(pending);
assert(groups.length === 2, "group count");
assert(groups[0]?.length === 2 && groups[0][0]?.pointer.session === "/a.jsonl", "first group is session a");
assert(groups[1]?.length === 1 && groups[1][0]?.pointer.session === "/b.jsonl", "second group is session b");

assert(isLedgerPointer({ ts: "t", session: "/s", cwd: "/c" }), "valid pointer");
assert(!isLedgerPointer({ ts: "t", session: "/s" }), "missing cwd rejected");
assert(parseCursor("12\n") === 12, "cursor parse");
assert(parseCursor("nope") === 0, "bad cursor");

const tmp = mkdtempSync(path.join(os.tmpdir(), "shadow-daemon-"));
try {
	const instructionPath = path.join(tmp, "instruction.md");
	const externalJobPath = path.join(tmp, "external.toml");
	writeFileSync(instructionPath, "external standing instruction\n");
	writeFileSync(externalJobPath, 'name = "external"\nworkdir = "."\ninstruction_file = "instruction.md"\n');
	const externalJob = await loadJob(externalJobPath);
	assert(externalJob.instruction === "external standing instruction\n", "relative instruction_file");
	assert(externalJob.workdir === tmp, "relative workdir");

	const ledger = ledgerPath(tmp);
	mkdirSync(path.dirname(ledger), { recursive: true });
	const lines = [
		JSON.stringify({ ts: "2026-01-01T00:00:00.000Z", session: "/s.jsonl", cwd: "/proj" }),
		JSON.stringify({ ts: "2026-01-01T00:01:00.000Z", session: "/s.jsonl", cwd: "/proj" }),
	];
	writeFileSync(ledger, `${lines.join("\n")}\n`);

	const seen: { start: number; end: number }[] = [];
	const handle = tailJsonl(ledger, { fromEnd: false, fromOffset: 0 }, (entry, span) => {
		if (isLedgerPointer(entry)) seen.push(span);
	});
	await Bun.sleep(200);
	handle.stop();
	assert(seen.length === 2, `tailed ${seen.length} records`);
	assert(seen[0]?.start === 0, "first span starts at 0");
	assert(seen[1]?.start === seen[0]?.end, "spans are contiguous");

	const offset = await skipJob(tmp, "journal");
	assert(offset === Number(Bun.file(ledger).size), "skip to eof");
	const stored = parseCursor(await Bun.file(cursorPath(tmp, "journal")).text());
	assert(stored === offset, "cursor file matches skip");
} finally {
	rmSync(tmp, { recursive: true, force: true });
}

const sample = "/home/cx/.omp/agent/sessions/-workspace-my-agents/2026-08-16T11-25-27-993Z_01a00a51-cc39-7000-bcb8-ed3ca54c000a.jsonl";
if (await Bun.file(sample).exists()) {
	const slice = await sliceSession(sample, [
		{ ts: "2099-01-01T00:00:00.000Z", session: sample, cwd: "/home/cx/workspace/my-agents" },
	]);
	assert(typeof slice.full === "string", "slice full");
	process.stdout.write(`slice: prose ${slice.prose.length} chars, full ${slice.full.length} chars\n`);
}

process.stdout.write("smoke-daemon: ok\n");
