import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

/**
 * /stage <text> — append a message to the conversation without giving up the turn.
 *
 * Idle + deliverAs:"nextTurn" + triggerTurn:false is the only path in AgentSession
 * that calls agent.appendMessage() + sessionManager.appendCustomMessageEntry()
 * without starting a run. The text lands in live context and on disk; the model
 * first sees it when the next real prompt fires.
 */
export default function stageNote(pi: ExtensionAPI) {
  pi.registerCommand("stage", {
    description: "Append text to context without starting a turn",
    handler: async (args, ctx) => {
      const text = args.trim();
      if (!text) {
        ctx.ui.notify("usage: /stage <text>", "warning");
        return;
      }
      pi.sendMessage(
        {
          customType: "dev.stefan.staged-note",
          content: text,
          display: true,
          attribution: "user",
        },
        { deliverAs: "nextTurn", triggerTurn: false },
      );
      ctx.ui.notify(`staged ${text.length} chars (no turn)`, "info");
    },
  });
}
