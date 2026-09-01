#!/usr/bin/env bun
import os from "node:os";
import path from "node:path";
import { loadJob } from "./src/job";
import { ledgerPath } from "./src/paths";
import { runJob, skipJob } from "./src/dispatch";

const USAGE = `usage: shadow-daemon [--profile <name>] <job.toml>
       shadow-daemon skip [--profile <name>] <job.toml>

  --profile <name>  use ~/.omp/profiles/<name>/agent (default: ~/.omp/agent)

Tails this profile's ledger and wakes an ephemeral Luna session once per
observed session that has finished turns. Memory lives in the job's files,
not in a continuous shadow transcript.

  skip   move this job's bookmark to the end of the ledger and exit
`;

type CliArgs = { skip: boolean; profile: string | undefined; jobPath: string };

function parseArgs(argv: string[]): CliArgs {
	let skip = false;
	let profile: string | undefined;
	let jobPath: string | undefined;
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index] as string;
		if (arg === "skip") skip = true;
		else if (arg === "--profile") profile = argv[++index];
		else if (arg.startsWith("--profile=")) profile = arg.slice("--profile=".length);
		else if (arg === "-h" || arg === "--help") {
			process.stdout.write(USAGE);
			process.exit(0);
		} else if (arg.startsWith("-")) {
			process.stderr.write(`shadow-daemon: unknown flag ${arg}\n\n${USAGE}`);
			process.exit(2);
		} else jobPath = arg;
	}
	if (!jobPath) {
		process.stderr.write(USAGE);
		process.exit(2);
	}
	return { skip, profile, jobPath };
}

function resolveAgentDir(profile: string | undefined): string {
	if (!profile || profile === "default") return path.join(os.homedir(), ".omp", "agent");
	return path.join(os.homedir(), ".omp", "profiles", profile, "agent");
}

const dim = (text: string): string => `\x1b[2m${text}\x1b[0m`;

const { skip, profile, jobPath } = parseArgs(process.argv.slice(2));
const agentDir = resolveAgentDir(profile);
const job = await loadJob(jobPath);

if (skip) {
	const offset = await skipJob(agentDir, job.name);
	process.stdout.write(`shadow-daemon: skipped ${job.name} → cursor ${offset}\n`);
	process.exit(0);
}

const handle = await runJob({
	agentDir,
	job,
	onExhausted: () => void shutdown(1),
});

process.stdout.write(
	[
		`shadow-daemon: ${job.name}`,
		`  profile    ${profile ?? "default"}`,
		`  ledger     ${ledgerPath(agentDir)}`,
		`  model      ${job.model}`,
		`  tools      ${job.tools.join(", ")}`,
		`  quiesce    ${job.quiesceSecs}s`,
		`  catchup    newest ${job.catchupCap} turns`,
		`  budget     $${job.maxCostUsd}`,
		`  files      ${job.workdir ?? path.join(agentDir, "shadow-daemon", "jobs", job.name)}`,
		dim("  waiting for finished turns — Ctrl+C to stop"),
		"",
	].join("\n"),
);

let closing = false;
async function shutdown(code = 0): Promise<void> {
	if (closing) return;
	closing = true;
	process.stdout.write(dim("\nshadow-daemon: stopping\n"));
	await handle.stop();
	process.exit(code);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
