// Loaded by @omp-session-recap via `omp -e`: puts the recap named by
// OMP_SESSION_RECAP_FILE into the new session as a displayed custom message,
// without starting a turn. The user's first prompt goes out after it.
import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const ENV = "OMP_SESSION_RECAP_FILE";

export default function (pi: ExtensionAPI) {
  let sent = false;
  pi.on("session_start", async (_event, ctx) => {
    const file = process.env[ENV];
    if (sent || !file) return;
    sent = true;
    // Later sessions in this process (/new, /resume, subagents) must not get it.
    delete process.env[ENV];
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch (error) {
      ctx.ui.notify(`Session recap not loaded: ${(error as Error).message}`, "error");
      return;
    }
    await pi.sendMessage(
      { customType: "omp-session-recap", content, display: true, attribution: "agent" },
      { deliverAs: "nextTurn" },
    );
  });
}
