import { describe, expect, it } from "vitest";
import { featureSwitch } from "./feature-switch";

describe("featureSwitch", () => {
  it("keeps at most one registration while on and none while off", () => {
    // Settings refreshes switch a feature on again and again; each extra start would add a listener.
    let listeners = 0;
    const feature = featureSwitch("test", () => {
      listeners += 1;
      return () => {
        listeners -= 1;
      };
    });
    feature.set(true);
    feature.set(true);
    expect(listeners).toBe(1);
    feature.set(false);
    feature.set(false);
    expect(listeners).toBe(0);
    feature.set(true);
    expect(listeners).toBe(1);
  });
});
