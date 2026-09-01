import { createInterface, type Interface } from "node:readline/promises";

import {
  PrepareError,
  preparePrWorktree,
  type SourceContext,
} from "./prepare-worktree";

// The popup vanishes the moment this process exits, so errors need a keypress
// to stay readable. A normal pane keeps its scrollback — don't block there.
const inPopup = process.env.PRWT_POPUP === "1";
const interactive = process.stdin.isTTY === true;

// Built on first use only: attaching to a closed stdin (`prw 438` from a
// script) fires readline's close handler immediately and kills the process
// before any work happens.
let rl: Interface | undefined;
function ask(question: string): Promise<string> {
  if (!rl) {
    rl = createInterface({ input: process.stdin, output: process.stdout });
    // Ctrl-C / Ctrl-D close the interface without settling pending questions;
    // without this the popup would hang forever.
    rl.on("close", () => process.exit(process.exitCode ?? 0));
    // A bare Esc dismisses the popup; escape sequences (arrows, etc.) arrive as
    // longer chunks and pass through untouched.
    process.stdin.on("data", (chunk) => {
      if (String(chunk) === "\x1b") process.exit(process.exitCode ?? 0);
    });
  }
  return rl.question(question);
}

const source: SourceContext = {
  paneId: process.env.PRWT_SOURCE_PANE_ID || undefined,
  cwd: process.env.PRWT_SOURCE_CWD || undefined,
  workspaceId: process.env.PRWT_SOURCE_WORKSPACE_ID || undefined,
};

try {
  const argument = process.argv.slice(2).join(" ").trim();
  if (!argument && !interactive) {
    throw new PrepareError("usage: prw <pr-number|pr-url>");
  }

  const input = argument || (await ask("PR number or URL: ")).trim();
  if (input) {
    const ready = await preparePrWorktree({
      input,
      source,
      onStep: (message) => console.log(`  · ${message}`),
      confirmReplace: async (matches) => {
        console.log("Existing worktrees for this PR:");
        for (const match of matches) {
          const dirty = match.dirty ? " (dirty)" : "";
          const open = match.openWorkspaceId ? " [open]" : "";
          console.log(`  ${match.branch}  ${match.path}${dirty}${open}`);
        }

        // Reusing is the non-destructive answer; take it when nobody can reply.
        if (!interactive) {
          console.log("Not a terminal — reusing the existing worktree.");
          return false;
        }

        const answer = await ask("Delete and recreate? [y/N] ");
        return /^(?:y|yes)$/i.test(answer.trim());
      },
    });

    console.log(`${ready.action}: ${ready.branch}  ${ready.path}`);
  }
} catch (error) {
  if (error instanceof PrepareError) {
    console.error(`✗ ${error.message}`);
  } else {
    console.error(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
  }

  process.exitCode = 1;
  if (inPopup && interactive) await ask("Press Enter to close…");
} finally {
  rl?.close();
}
