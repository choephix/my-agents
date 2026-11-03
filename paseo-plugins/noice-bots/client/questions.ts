import type { PluginClientContext } from "@getpaseo/plugin/client";
import { findQuestion, listQuestions, type Thread } from "../shared/contracts";

export interface HubQuestions {
  /** A thread block was drawn: its question row goes, as the block draws the question itself. */
  sync(thread: Thread): void;
  stop(): void;
}

/**
 * Hides your question above each thread block, which draws it itself: a timeline transformer drops
 * those `user_message` rows and leaves every other row to Paseo. Paseo transforms a row once and
 * caches the result per transformer, so a new id registers the transformer again to have every row
 * transformed anew.
 */
export function hideQuestions(client: PluginClientContext): HubQuestions {
  const hidden = new Set<string>();
  /** Threads drawn without a `questionId` that were looked up already (found or not). */
  const looked = new Set<string>();
  let remove: (() => void) | undefined;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const register = () => {
    remove?.();
    remove = client.addTimelineTransformer({
      id: "questions",
      query: { itemType: "user_message" },
      transform: ({ item }) => (item.messageId && hidden.has(item.messageId)) || (item.clientMessageId && hidden.has(item.clientMessageId)) ? { items: [] } : undefined,
    });
  };
  // One registration for a burst of new ids (the start-up list, blocks drawn as a hub opens).
  const refresh = () => {
    pending ??= setTimeout(() => {
      pending = undefined;
      register();
    }, 0);
  };
  const hide = (id: string) => {
    if (hidden.has(id)) return;
    hidden.add(id);
    refresh();
  };
  register();
  void client.rpc(listQuestions, {})
    .then(ids => ids.forEach(hide))
    .catch(error => console.error("noice-bots: loading questions failed", error));
  return {
    sync(thread) {
      if (thread.questionId) return hide(thread.questionId);
      if (looked.has(thread.id)) return;
      looked.add(thread.id);
      void client.rpc(findQuestion, { id: thread.id })
        .then(({ questionId }) => { if (questionId) hide(questionId); })
        .catch(error => console.error(`noice-bots: finding the question of ${thread.id} failed`, error));
    },
    stop() {
      clearTimeout(pending);
      remove?.();
    },
  };
}
