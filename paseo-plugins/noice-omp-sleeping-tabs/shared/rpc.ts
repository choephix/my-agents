import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Why the daemon's idle timer left a chat awake (fork `agent.get_sleep_state` keptAwake reasons). */
export const keptAwakeReasonSchema = z.enum(["running", "permission", "background_work", "open_in_client"]);
export type KeptAwakeReason = z.output<typeof keptAwakeReasonSchema>;

const providerSleepSchema = z.object({ provider: z.string(), enabled: z.boolean(), idleMinutes: z.number() });
export type ProviderSleep = z.output<typeof providerSleepSchema>;

/**
 * Asleep chats for the composer pills. `supported` is false on a daemon without the fork's sleep
 * feature; the client then shows nothing at all.
 */
export const pillsRpc = defineRpc({
  name: "sleep.pills",
  input: z.object({}),
  output: z.object({
    supported: z.boolean(),
    asleep: z.array(z.object({
      agentId: z.string(),
      workspaceId: z.string(),
      /** Null for a chat that is closed but wasn't put to sleep by the daemon (e.g. after a restart). */
      sleptAt: z.string().nullable(),
    })),
  }),
});

/** Everything the settings screen shows. */
export const overviewRpc = defineRpc({
  name: "sleep.overview",
  input: z.object({}),
  output: z.object({
    supported: z.boolean(),
    /** Every provider whose chats can sleep (OMP and providers that extend it). */
    providers: z.array(providerSleepSchema),
    asleep: z.number(),
    /** Asleep chats that carry a measured memory figure (the rest were closed by a restart). */
    measured: z.number(),
    freedBytes: z.number(),
    keptAwake: z.array(z.object({ agentId: z.string(), title: z.string(), reason: keptAwakeReasonSchema })),
  }),
});

export const wakeRpc = defineRpc({
  name: "sleep.wake",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({ status: z.string() }),
});

/**
 * Puts one chat to sleep now (`/sleep`, ⌘K "Sleep this chat"). A refusal comes back as a plain
 * sentence in `refused` rather than as an error, so the client can show it without the RPC's
 * "Request failed … code=…" wrapping.
 */
export const sleepRpc = defineRpc({
  name: "sleep.sleep",
  input: z.object({ agentId: z.string().min(1), provider: z.string().min(1) }),
  output: z.object({ refused: z.string().nullable() }),
});

/** Writes `agents.providers.<id>.sleep` for every provider whose chats can sleep. */
export const configureRpc = defineRpc({
  name: "sleep.configure",
  input: z.object({ enabled: z.boolean(), idleMinutes: z.number().int().positive().max(10_080) }),
  output: z.object({ providers: z.array(providerSleepSchema) }),
});
