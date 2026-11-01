import { existsSync } from "node:fs";
import { mkdir, open, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

/**
 * Per-chat instructions: appends `~/.omp/agent/session-instructions/<sessionId>.md`
 * to the system prompt of every turn of that session. No file, or an empty one,
 * changes nothing. The Paseo plugin noice-omp-slash-aliases edits these files.
 *
 * The file is read on every `before_agent_start`, so an edit applies from the
 * next turn. OMP keeps the returned prompt for the whole run (tool loops,
 * queued follow-ups), and compaction does not touch the system prompt.
 *
 * A session copy (/prose, a fork) names its source in its header's
 * `parentSession`. Once per process, a session without a file of its own
 * copies the nearest ancestor's file, so the copy starts with the same
 * instructions and edits to either side stay apart. Subagent and tangent
 * sessions also name a parent, but their files sit in the parent's artifact
 * folder (`<parent>/<Name>.jsonl`); they inherit nothing.
 */

export const INSTRUCTIONS_DIR = join(homedir(), ".omp", "agent", "session-instructions");
const HEADING = "## Instructions for this chat";
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_ANCESTORS = 20;

interface Header {
	id?: string;
	parentSession?: string;
}

/** The file's text, or undefined when there is none. */
async function readInstructions(id: string): Promise<string | undefined> {
	if (!SAFE_ID.test(id)) return undefined;
	try {
		return await readFile(join(INSTRUCTIONS_DIR, `${id}.md`), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

/** The `session` line near the top of a session file (after its `title` line). */
async function readHeader(file: string): Promise<Header | undefined> {
	const handle = await open(file, "r").catch(() => undefined);
	if (!handle) return undefined;
	const buffer = Buffer.alloc(16_384);
	const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0).finally(() => handle.close());
	const head = buffer.subarray(0, bytesRead).toString("utf8");
	for (const line of head.split("\n").slice(0, 4)) {
		try {
			const entry = JSON.parse(line);
			if (entry?.type === "session") return entry;
		} catch {}
	}
	return undefined;
}

/** `parentSession` is a session file path or a bare id; a bare id is looked up next to the child. */
async function parentFile(ref: string, childDir: string): Promise<string | undefined> {
	if (ref.endsWith(".jsonl")) return ref;
	const name = (await readdir(childDir).catch(() => [] as string[])).find(entry => entry.endsWith(`_${ref}.jsonl`));
	return name ? join(childDir, name) : undefined;
}

/** The nearest ancestor's instructions file text (possibly empty), if any ancestor has one. */
async function inherited(header: Header | null, file: string): Promise<string | undefined> {
	let ref = header?.parentSession;
	let dir = dirname(file);
	for (let hop = 0; ref && hop < MAX_ANCESTORS; hop++) {
		const parent = await parentFile(ref, dir);
		const parentHeader = parent ? await readHeader(parent) : undefined;
		const id = parentHeader?.id ?? (ref.endsWith(".jsonl") ? undefined : ref);
		if (!id) return undefined;
		const text = await readInstructions(id);
		if (text !== undefined) return text;
		if (!parent) return undefined;
		ref = parentHeader?.parentSession;
		dir = dirname(parent);
	}
	return undefined;
}

export default function sessionInstructions(pi: ExtensionAPI): void {
	/** Sessions whose ancestry this process has already looked at. */
	const checked = new Set<string>();

	pi.on("before_agent_start", async (event, ctx) => {
		const id = ctx.sessionManager.getSessionId();
		if (!id) return;
		let text = await readInstructions(id);
		const file = ctx.sessionManager.getSessionFile();
		if (text === undefined && file && !checked.has(id)) {
			checked.add(id);
			// A file inside another session's artifact folder is a subagent or tangent, not a copy.
			if (!existsSync(`${dirname(file)}.jsonl`)) {
				text = await inherited(ctx.sessionManager.getHeader() as Header | null, file);
				if (text?.trim()) {
					await mkdir(INSTRUCTIONS_DIR, { recursive: true });
					// `wx`: never overwrite a file written meanwhile (the Paseo plugin, another process).
					await writeFile(join(INSTRUCTIONS_DIR, `${id}.md`), text, { flag: "wx" }).catch(() => undefined);
				}
			}
		}
		const body = text?.trim();
		if (!body) return;
		return { systemPrompt: [...event.systemPrompt, `${HEADING}\n\n${body}`] };
	});
}
