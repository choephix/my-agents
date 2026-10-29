import { describe, expect, it } from "vitest";
import { ompProviderIds } from "./providers";

describe("ompProviderIds", () => {
  it("includes providers that extend omp directly or through another custom provider", () => {
    const providers = {
      omp: {},
      "omp-nilo": { extends: "omp" },
      "omp-custom-fast": { extends: "omp-nilo" },
      cursor: { extends: "acp" },
      antigravity: {},
    };
    expect(ompProviderIds(providers).sort()).toEqual(["omp", "omp-custom-fast", "omp-nilo"]);
  });

  it("keeps omp without any config and survives an extends cycle", () => {
    expect(ompProviderIds({})).toEqual(["omp"]);
    expect(ompProviderIds({ a: { extends: "b" }, b: { extends: "a" } })).toEqual(["omp"]);
  });
});
