import { mkdirSync } from "node:fs";
import { createAgentSession, SessionManager } from "@oh-my-pi/pi-coding-agent";
import type { ShadowJob } from "./job";
import type { LedgerPointer } from "./ledger";
import { daemonSessionDir, jobWorkdir, newDaemonSessionFile } from "./paths";
import { projectLabel } from "./project";
import { sliceSession } from "./session-read";

export type WakeupResult = { costUsd: number; tokens: number };

export async function runWakeup(opts: {
	agentDir: string;
	job: ShadowJob;
	pointers: LedgerPointer[];
	onText?: (text: string) => void;
}): Promise<WakeupResult> {
	const { agentDir, job, pointers } = opts;
	const sessionFile = pointers[0]?.session;
	if (!sessionFile) return { costUsd: 0, tokens: 0 };

	const workdir = job.workdir ?? jobWorkdir(agentDir, job.name);
	mkdirSync(workdir, { recursive: true });
	const sessionDir = daemonSessionDir(agentDir);
	mkdirSync(sessionDir, { recursive: true });
	const ownFile = newDaemonSessionFile(agentDir);

	const slice = await sliceSession(sessionFile, pointers);
	const cwd = pointers[0]?.cwd ?? slice.cwd ?? workdir;
	const project = await projectLabel(cwd);
	const prompt = renderDaemonWakeup({
		project,
		cwd,
		sessionFile,
		sessionId: pointers[0]?.id,
		turnCount: pointers.length,
		prose: slice.prose,
		full: slice.full,
		workdir,
	});

	const sessionManager = await SessionManager.open(ownFile, sessionDir, undefined, {
		initialCwd: workdir,
		suppressBreadcrumb: true,
	});
	const { session, modelFallbackMessage } = await createAgentSession({
		cwd: workdir,
		agentDir,
		sessionManager,
		modelPattern: job.model,
		toolNames: job.tools,
		restrictToolNames: true,
		hasUI: false,
		enableLsp: false,
		enableMCP: false,
		enableIrc: false,
		disableExtensionDiscovery: true,
		contextFiles: [],
		skills: [],
		rules: [],
		appendSystemPrompt: buildDaemonPrompt(job.instruction),
	});
	if (modelFallbackMessage) {
		opts.onText?.(`model fallback: ${modelFallbackMessage}\n`);
	}

	let tokens = 0;
	let costUsd = 0;
	session.subscribe(event => {
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			opts.onText?.(event.assistantMessageEvent.delta);
			return;
		}
		if (event.type === "turn_end" && event.message.role === "assistant") {
			const usage = event.message.usage;
			if (!usage) return;
			tokens += usage.totalTokens ?? 0;
			costUsd += usage.cost?.total ?? 0;
		}
	});

	try {
		await session.prompt(prompt);
	} finally {
		await session.dispose();
	}
	return { costUsd, tokens };
}

function buildDaemonPrompt(instruction: string): string {
	return [
		"## Shadow-daemon job",
		"",
		"You observe finished turns from Stefan's OMP sessions across this profile. You do not control those sessions and you are not talking to him: never ask questions, never offer follow-ups, never request approval.",
		"",
		"Your working directory is this job's own files — they are your memory. Read them at the start of every wakeup and write them before you end. The observed project is named in the prompt; use absolute paths if you need to inspect it.",
		"",
		"Do the work now and end your turn. Nothing else will wake you until the next finished turn.",
		"",
		"### Standing instruction",
		"",
		instruction,
	].join("\n");
}

function renderDaemonWakeup(input: {
	project: string;
	cwd: string;
	sessionFile: string;
	sessionId?: string;
	turnCount: number;
	prose: string;
	full: string;
	workdir: string;
}): string {
	const lines = [
		input.turnCount === 1
			? "One finished turn in the session below."
			: `${input.turnCount} finished turns in the session below, oldest first. They queued while you were busy or catching up.`,
		"",
		`project: ${input.project}`,
		`cwd: ${input.cwd}`,
		`session: ${input.sessionFile}`,
	];
	if (input.sessionId) lines.push(`session id: ${input.sessionId}`);
	lines.push(`job files: ${input.workdir}`, "");
	if (input.prose) {
		lines.push("## Conversation so far (stripped)", "", input.prose, "");
	}
	lines.push("## Finished turn(s) (full)", "", input.full || "(no recoverable transcript for this turn)", "");
	lines.push("Act on your standing instruction now, then end your turn.");
	return lines.join("\n");
}

