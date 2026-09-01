/**
 * Append a pointer to this profile's shadow-daemon ledger after every finished
 * main-session turn. Subagents are skipped: their work lands in the parent turn.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { type ExtensionAPI, getAgentDir } from "@oh-my-pi/pi-coding-agent";

const SKIP_DIRS: Record<string, true> = { "shadow-daemon-sessions": true, "shadow-agent-sessions": true };

export default function shadowLedger(pi: ExtensionAPI): void {
	pi.on("turn_end", (_event, ctx) => {
		const file = ctx.sessionManager.getSessionFile();
		if (!file || !isMainSessionFile(file)) return;
		const message = _event.message;
		if (message.role !== "assistant" || !isSettledTurn(message)) return;
		const dir = path.join(getAgentDir(), "shadow-daemon");
		mkdirSync(dir, { recursive: true });
		const record = {
			ts: new Date().toISOString(),
			session: file,
			cwd: ctx.cwd,
			id: ctx.sessionManager.getSessionId(),
			leaf: ctx.sessionManager.getLeafId() ?? undefined,
		};
		appendFileSync(path.join(dir, "ledger.jsonl"), `${JSON.stringify(record)}\n`);
	});
}

function isSettledTurn(message: { stopReason?: string | null; content?: unknown }): boolean {
	const reason = message.stopReason;
	if (!reason || reason === "toolUse") return false;
	if (reason === "aborted" || reason === "error") return true;
	if (reason !== "stop" && reason !== "length") return false;
	return !hasToolCall(message.content);
}

function hasToolCall(content: unknown): boolean {
	if (!Array.isArray(content)) return false;
	return content.some(part => part && typeof part === "object" && "type" in part && part.type === "toolCall");
}

function isMainSessionFile(file: string): boolean {
	if (!file.endsWith(".jsonl")) return false;
	const parent = path.dirname(file);
	if (SKIP_DIRS[path.basename(parent)]) return false;
	return path.basename(path.dirname(parent)) === "sessions";
}
