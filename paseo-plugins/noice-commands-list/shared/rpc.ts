import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const CommandSchema = z.object({
  name: z.string(),
  description: z.string(),
  argumentHint: z.string(),
  onClick: z.enum(["insert", "send"]),
  scope: z.enum(["project", "user"]),
  source: z.enum(["agents", "claude", "cursor", "omp", "codex"]),
  path: z.string(),
  body: z.string(),
});
export type CommandView = z.infer<typeof CommandSchema>;

/** This agent's commands (its cwd up to the git root, then `~`), first of each name, by name. */
export const listCommands = defineRpc({
  name: "agent-commands.list",
  input: z.object({ agentId: z.string() }),
  output: z.object({
    commands: z.array(CommandSchema),
    /** OMP-based provider: a send while busy is queued as a follow-up rather than steered in. */
    queues: z.boolean(),
    /** The "Project / User groups" setting. */
    groups: z.boolean(),
  }),
});
export type CommandListing = z.output<typeof listCommands.output>;

/** Names for the `/` menu: the union over the given folders (slash commands are global per plugin). */
export const slashCatalog = defineRpc({
  name: "agent-commands.slash-catalog",
  input: z.object({ cwds: z.array(z.string()) }),
  output: z.object({
    commands: z.array(z.object({ name: z.string(), description: z.string(), argumentHint: z.string() })),
  }),
});

/**
 * Expands this agent's command `name` with `args` and sends the text. Busy agents: OMP queues it
 * (`/follow-up`), other providers get it steered into the running turn. `sent: false` when the
 * agent has no such command.
 */
export const sendCommand = defineRpc({
  name: "agent-commands.send",
  input: z.object({ agentId: z.string(), name: z.string(), args: z.string() }),
  output: z.object({ sent: z.boolean(), how: z.enum(["send", "follow-up", "steer", "none"]) }),
});
