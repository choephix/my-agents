import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

/**
 * Tells the model which session it is running in.
 *
 * `before_agent_start` can rewrite the system prompt for the turn, so the
 * session identity rides along for free: no tool call, no round trip.
 *
 * Only session-stable fields go in here. Anything that changes per turn
 * (leaf id, entry counts) would move the cached prefix and re-bill the whole
 * prompt on every turn.
 */
export default function sessionIdExtension(pi: ExtensionAPI): void {
	pi.on("before_agent_start", (event, ctx) => {
		const id = ctx.sessionManager.getSessionId();
		if (!id) return;
		const file = ctx.sessionManager.getSessionFile();
		const lines = [`<session>`, `- id: ${id}`];
		if (file) lines.push(`- file: ${file}`);
		lines.push(`</session>`);
		return { systemPrompt: [...event.systemPrompt, lines.join("\n")] };
	});
}
