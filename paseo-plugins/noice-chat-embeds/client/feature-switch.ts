/** A feature behind its own settings switch. */
export interface FeatureSwitch {
  set(on: boolean): void;
}

/**
 * Runs a feature only while its switch is on. `start()` registers everything the feature needs and
 * returns its `stop()`, which removes all of it. `set(true)` starts the feature once however often
 * it is called; `set(false)` stops it. A feature that throws is logged and left off, so it cannot
 * break the rest of the plugin.
 */
export function featureSwitch(name: string, start: () => () => void): FeatureSwitch {
  let stop: (() => void) | null = null;
  return {
    set(on) {
      if (on === (stop !== null)) return;
      if (on) {
        try {
          stop = start();
        } catch (error) {
          console.error(`[noice-chat-embeds] ${name} failed to start`, error);
        }
        return;
      }
      const running = stop;
      stop = null;
      try {
        running?.();
      } catch (error) {
        console.error(`[noice-chat-embeds] ${name} failed to stop`, error);
      }
    },
  };
}
