import { describe, expect, test } from "bun:test";
import {
  acknowledgeEvaluations,
  evaluateUsagePolicy,
  normalizeUsageJson,
  parseUsageGuardConfig,
  type UsageGuardConfig,
  type UsageLimitSnapshot,
} from "./policy";

const NOW = 2_000_000_000_000;

function config(rules: unknown[]): UsageGuardConfig {
  return parseUsageGuardConfig({
    pollSeconds: 30,
    forceRefreshSeconds: 10,
    staleAfterSeconds: 120,
    commandTimeoutSeconds: 5,
    rules,
  });
}

function snapshot(overrides: Partial<UsageLimitSnapshot> = {}): UsageLimitSnapshot {
  return {
    provider: "openai-codex",
    limitId: "openai-codex:primary",
    label: "7 days",
    windowId: "7d",
    resetsAt: NOW + 100_000,
    usedPercent: 51,
    fetchedAt: NOW,
    windowKey: "openai-codex|openai-codex:primary|7d|2000000100000|shared|default",
    ...overrides,
  };
}

describe("parseUsageGuardConfig", () => {
  test("accepts exact limit and window selectors", () => {
    const parsed = config([
      {
        provider: "openai-codex",
        limit: "openai-codex:primary",
        window: "7d",
        thresholdPercent: 50,
        action: "drain-subagents",
      },
    ]);

    expect(parsed.rules[0]).toMatchObject({
      provider: "openai-codex",
      limit: "openai-codex:primary",
      window: "7d",
      thresholdPercent: 50,
      action: "drain-subagents",
    });
  });

  test("rejects rules without a usage selector", () => {
    expect(() => config([{ provider: "anthropic", thresholdPercent: 90, action: "pause" }])).toThrow(
      "must specify limit or window",
    );
  });

  test("rejects out-of-range percentages and unknown actions", () => {
    expect(() =>
      config([{ provider: "anthropic", window: "5h", thresholdPercent: 101, action: "pause" }]),
    ).toThrow("between 0 and 100");
    expect(() =>
      config([{ provider: "anthropic", window: "5h", thresholdPercent: 90, action: "cancel" }]),
    ).toThrow("warn, drain-subagents, or pause");
  });
});

describe("normalizeUsageJson", () => {
  test("normalizes the stable omp usage JSON fields", () => {
    const normalized = normalizeUsageJson({
      generatedAt: NOW,
      reports: [
        {
          provider: "anthropic",
          fetchedAt: NOW - 1_000,
          limits: [
            {
              id: "anthropic:5h",
              label: "5 hours",
              scope: { provider: "anthropic", accountId: "account-a", windowId: "5h" },
              window: { id: "5h", resetsAt: NOW + 3_600_000 },
              amount: { usedFraction: 0.91, unit: "percent" },
              status: "ok",
            },
          ],
        },
      ],
    });

    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({
      provider: "anthropic",
      limitId: "anthropic:5h",
      windowId: "5h",
      usedPercent: 91,
      fetchedAt: NOW - 1_000,
    });
    expect(normalized[0].windowKey).toContain("account-a");
  });

  test("does not turn malformed or failed limits into zero usage", () => {
    expect(
      normalizeUsageJson({
        reports: [
          {
            provider: "anthropic",
            fetchedAt: NOW,
            limits: [
              { id: "anthropic:5h", scope: { windowId: "5h" }, amount: {}, status: "ok" },
              { id: "anthropic:7d", scope: { windowId: "7d" }, amount: { usedFraction: 0 }, status: "error" },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });
});

describe("evaluateUsagePolicy", () => {
  test("triggers at the threshold and chooses the strongest action", () => {
    const parsed = config([
      { provider: "openai-codex", window: "7d", thresholdPercent: 50, action: "drain-subagents" },
      { provider: "anthropic", window: "5h", thresholdPercent: 90, action: "pause" },
    ]);
    const anthropic = snapshot({
      provider: "anthropic",
      limitId: "anthropic:5h",
      windowId: "5h",
      usedPercent: 90,
      windowKey: "anthropic|anthropic:5h|5h|reset-a|shared|default",
    });

    const decision = evaluateUsagePolicy(parsed, [snapshot(), anthropic], new Set(), NOW);
    expect(decision.action).toBe("pause");
    expect(decision.active).toHaveLength(2);
  });

  test("uses the highest matching account usage", () => {
    const parsed = config([
      { provider: "openai-codex", window: "7d", thresholdPercent: 50, action: "drain-subagents" },
    ]);
    const decision = evaluateUsagePolicy(
      parsed,
      [snapshot({ usedPercent: 12, windowKey: "low" }), snapshot({ usedPercent: 77, windowKey: "high" })],
      new Set(),
      NOW,
    );

    expect(decision.active[0].snapshot?.usedPercent).toBe(77);
  });

  test("acknowledges only the current quota window and re-arms on reset", () => {
    const parsed = config([
      { provider: "openai-codex", window: "7d", thresholdPercent: 50, action: "drain-subagents" },
    ]);
    const acknowledgements = new Set<string>();
    const first = evaluateUsagePolicy(parsed, [snapshot()], acknowledgements, NOW);
    expect(acknowledgeEvaluations(acknowledgements, first.evaluations, "openai-codex")).toBe(1);
    expect(evaluateUsagePolicy(parsed, [snapshot()], acknowledgements, NOW).action).toBeUndefined();

    const nextWindow = snapshot({
      resetsAt: NOW + 200_000,
      windowKey: "openai-codex|openai-codex:primary|7d|next-reset|shared|default",
    });
    expect(evaluateUsagePolicy(parsed, [nextWindow], acknowledgements, NOW).action).toBe("drain-subagents");
  });

  test("marks stale or missing enforcement data unavailable", () => {
    const parsed = config([
      { provider: "openai-codex", window: "7d", thresholdPercent: 50, action: "drain-subagents" },
      { provider: "anthropic", window: "5h", thresholdPercent: 90, action: "warn" },
    ]);
    const stale = snapshot({ fetchedAt: NOW - 121_000 });
    const decision = evaluateUsagePolicy(parsed, [stale], new Set(), NOW);

    expect(decision.action).toBeUndefined();
    expect(decision.unavailableEnforcement).toHaveLength(1);
    expect(decision.evaluations.every((evaluation) => evaluation.state === "unavailable")).toBe(true);
  });
});
