import type { PluginClientContext } from "@getpaseo/plugin/client";
import { listSettledQuestions, type Thread } from "../shared/contracts";

export interface SettledQuestions {
  /** A thread block was drawn: its question shows or hides with its `settled`. */
  sync(thread: Thread): void;
  stop(): void;
}

/**
 * Hides your question above each settled thread: a timeline transformer drops those
 * `user_message` rows and leaves every other row to Paseo. Paseo transforms a row once and caches
 * the result per transformer, so a change registers the transformer again to have every row
 * transformed anew.
 */
export function hideSettledQuestions(client: PluginClientContext): SettledQuestions {
  const hidden = new Set<string>();
  /** Ids whose state came from a drawn block; the start-up list doesn't override them. */
  const synced = new Set<string>();
  let remove: (() => void) | undefined;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const register = () => {
    remove?.();
    remove = client.addTimelineTransformer({
      id: "settled-questions",
      query: { itemType: "user_message" },
      transform: ({ item }) => (item.messageId && hidden.has(item.messageId)) || (item.clientMessageId && hidden.has(item.clientMessageId)) ? { items: [] } : undefined,
    });
  };
  // One registration for a burst of changes (Settle all read redraws many blocks).
  const refresh = () => {
    pending ??= setTimeout(() => {
      pending = undefined;
      register();
    }, 0);
  };
  const set = (id: string, hide: boolean) => {
    if (hidden.has(id) === hide) return;
    if (hide) hidden.add(id);
    else hidden.delete(id);
    refresh();
  };
  register();
  void client.rpc(listSettledQuestions, {})
    .then(ids => { for (const id of ids) if (!synced.has(id)) set(id, true); })
    .catch(error => console.error("noice-bots: loading settled questions failed", error));
  return {
    sync(thread) {
      if (!thread.questionId) return;
      synced.add(thread.questionId);
      set(thread.questionId, !!thread.settled);
    },
    stop() {
      clearTimeout(pending);
      remove?.();
    },
  };
}
