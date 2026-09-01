export type UsageGuardAction = "warn" | "drain-subagents" | "pause";

export interface UsageGuardRule {
  id: string;
  provider: string;
  limit?: string;
  window?: string;
  thresholdPercent: number;
  action: UsageGuardAction;
}

export interface UsageGuardConfig {
  pollSeconds: number;
  forceRefreshSeconds: number;
  staleAfterSeconds: number;
  commandTimeoutSeconds: number;
  rules: UsageGuardRule[];
}

export interface UsageLimitSnapshot {
  provider: string;
  limitId: string;
  label: string;
  windowId: string;
  resetsAt?: number;
  usedPercent: number;
  fetchedAt: number;
  windowKey: string;
}

export interface RuleEvaluation {
  rule: UsageGuardRule;
  snapshot?: UsageLimitSnapshot;
  activationKey?: string;
  state: "below" | "triggered" | "acknowledged" | "unavailable";
}

export interface PolicyDecision {
  action?: UsageGuardAction;
  active: RuleEvaluation[];
  evaluations: RuleEvaluation[];
  unavailableEnforcement: RuleEvaluation[];
}

const ACTION_RANK: Record<UsageGuardAction, number> = {
  warn: 1,
  "drain-subagents": 2,
  pause: 3,
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function positiveNumber(value: unknown, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

function nonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

export function parseUsageGuardConfig(value: unknown): UsageGuardConfig {
  const root = record(value);
  if (!root) throw new Error("usage-guard config must be a JSON object");
  if (!Array.isArray(root.rules) || root.rules.length === 0) {
    throw new Error("usage-guard config must contain at least one rule");
  }

  const rules = root.rules.map((rawRule, index): UsageGuardRule => {
    const raw = record(rawRule);
    const at = `rules[${index}]`;
    if (!raw) throw new Error(`${at} must be an object`);

    const provider = nonEmptyString(raw.provider, `${at}.provider`);
    const limit = raw.limit === undefined ? undefined : nonEmptyString(raw.limit, `${at}.limit`);
    const window = raw.window === undefined ? undefined : nonEmptyString(raw.window, `${at}.window`);
    if (!limit && !window) throw new Error(`${at} must specify limit or window`);

    const thresholdPercent = raw.thresholdPercent;
    if (
      typeof thresholdPercent !== "number" ||
      !Number.isFinite(thresholdPercent) ||
      thresholdPercent < 0 ||
      thresholdPercent > 100
    ) {
      throw new Error(`${at}.thresholdPercent must be between 0 and 100`);
    }

    const action = raw.action;
    if (action !== "warn" && action !== "drain-subagents" && action !== "pause") {
      throw new Error(`${at}.action must be warn, drain-subagents, or pause`);
    }

    const selector = `${limit ?? "*"}/${window ?? "*"}`;
    return {
      id: `${index}:${provider}:${selector}:${thresholdPercent}:${action}`,
      provider,
      limit,
      window,
      thresholdPercent,
      action,
    };
  });

  return {
    pollSeconds: positiveNumber(root.pollSeconds, "pollSeconds", 60),
    forceRefreshSeconds: positiveNumber(root.forceRefreshSeconds, "forceRefreshSeconds", 60),
    staleAfterSeconds: positiveNumber(root.staleAfterSeconds, "staleAfterSeconds", 180),
    commandTimeoutSeconds: positiveNumber(root.commandTimeoutSeconds, "commandTimeoutSeconds", 20),
    rules,
  };
}

export function normalizeUsageJson(value: unknown): UsageLimitSnapshot[] {
  const root = record(value);
  if (!root || !Array.isArray(root.reports)) {
    throw new Error("usage JSON must contain a reports array");
  }

  const snapshots: UsageLimitSnapshot[] = [];
  for (const rawReport of root.reports) {
    const report = record(rawReport);
    if (!report) continue;
    const provider = typeof report.provider === "string" ? report.provider : undefined;
    const fetchedAt = typeof report.fetchedAt === "number" ? report.fetchedAt : undefined;
    if (!provider || !Number.isFinite(fetchedAt) || !Array.isArray(report.limits)) continue;

    for (const rawLimit of report.limits) {
      const limit = record(rawLimit);
      if (!limit || (limit.status !== undefined && limit.status !== "ok")) continue;
      const scope = record(limit.scope);
      const window = record(limit.window);
      const amount = record(limit.amount);
      const limitId = typeof limit.id === "string" ? limit.id : undefined;
      const windowId =
        typeof scope?.windowId === "string"
          ? scope.windowId
          : typeof window?.id === "string"
            ? window.id
            : undefined;
      const usedFraction = amount?.usedFraction;
      if (
        !limitId ||
        !windowId ||
        typeof usedFraction !== "number" ||
        !Number.isFinite(usedFraction) ||
        usedFraction < 0
      ) {
        continue;
      }

      const resetsAt = typeof window?.resetsAt === "number" && Number.isFinite(window.resetsAt)
        ? window.resetsAt
        : undefined;
      const account = typeof scope?.accountId === "string" ? scope.accountId : "shared";
      const tier = typeof scope?.tier === "string" ? scope.tier : "default";
      snapshots.push({
        provider,
        limitId,
        label: typeof limit.label === "string" ? limit.label : limitId,
        windowId,
        resetsAt,
        usedPercent: usedFraction * 100,
        fetchedAt,
        windowKey: `${provider}|${limitId}|${windowId}|${resetsAt ?? "unknown"}|${account}|${tier}`,
      });
    }
  }
  return snapshots;
}

export function evaluateUsagePolicy(
  config: UsageGuardConfig,
  snapshots: readonly UsageLimitSnapshot[],
  acknowledgements: ReadonlySet<string>,
  now = Date.now(),
): PolicyDecision {
  const staleAfterMs = config.staleAfterSeconds * 1000;
  const evaluations = config.rules.map((rule): RuleEvaluation => {
    let snapshot: UsageLimitSnapshot | undefined;
    for (const candidate of snapshots) {
      if (
        candidate.provider !== rule.provider ||
        (rule.limit !== undefined && candidate.limitId !== rule.limit) ||
        (rule.window !== undefined && candidate.windowId !== rule.window) ||
        now - candidate.fetchedAt > staleAfterMs
      ) {
        continue;
      }
      if (!snapshot || candidate.usedPercent > snapshot.usedPercent) snapshot = candidate;
    }
    if (!snapshot) return { rule, state: "unavailable" };
    if (snapshot.usedPercent < rule.thresholdPercent) return { rule, snapshot, state: "below" };

    const key = `${rule.id}|${snapshot.windowKey}`;
    return {
      rule,
      snapshot,
      activationKey: key,
      state: acknowledgements.has(key) ? "acknowledged" : "triggered",
    };
  });

  const active = evaluations.filter((evaluation) => evaluation.state === "triggered");
  const unavailableEnforcement = evaluations.filter(
    (evaluation) => evaluation.state === "unavailable" && evaluation.rule.action !== "warn",
  );
  const action = active.reduce<UsageGuardAction | undefined>(
    (strongest, evaluation) =>
      !strongest || ACTION_RANK[evaluation.rule.action] > ACTION_RANK[strongest]
        ? evaluation.rule.action
        : strongest,
    undefined,
  );

  return { action, active, evaluations, unavailableEnforcement };
}

export function acknowledgeEvaluations(
  acknowledgements: Set<string>,
  evaluations: readonly RuleEvaluation[],
  provider?: string,
): number {
  let added = 0;
  for (const evaluation of evaluations) {
    if (!evaluation.activationKey || evaluation.state !== "triggered") continue;
    if (provider && evaluation.rule.provider !== provider) continue;
    if (!acknowledgements.has(evaluation.activationKey)) {
      acknowledgements.add(evaluation.activationKey);
      added++;
    }
  }
  return added;
}

