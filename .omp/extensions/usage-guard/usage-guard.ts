import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { agentPauseGate } from "@oh-my-pi/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { Component } from "@oh-my-pi/pi-tui";
import {
  acknowledgeEvaluations,
  evaluateUsagePolicy,
  normalizeUsageJson,
  parseUsageGuardConfig,
  type PolicyDecision,
  type UsageGuardConfig,
  type UsageLimitSnapshot,
} from "./policy";

const UI_KEY = "usage-guard";
const MESSAGE_TYPE = "usage-guard-warning";

interface ProviderState {
  snapshots: UsageLimitSnapshot[];
  attemptedAt: number;
  error?: string;
}

class PauseOverlay implements Component {
  constructor(
    private readonly summary: string,
    private readonly resume: () => void,
  ) {}

  handleInput(data: string): void {
    if (data === "\x1b" || data === "\r" || data === "\n" || data === " " || data === "\x03") {
      this.resume();
    }
  }

  render(width: number): string[] {
    const fit = (text: string) => text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
    return [
      fit("USAGE GUARD PAUSED"),
      "",
      fit(this.summary),
      "",
      fit("Main agent, subagents, and advisor are held at their next safe step."),
      fit("Press Esc, Enter, Space, or Ctrl-C to acknowledge and resume."),
    ];
  }
}

function configPath(): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".omp", "agent");
  return join(agentDir, "usage-guard.json");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function percent(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

function describeEvaluation(evaluation: PolicyDecision["evaluations"][number]): string {
  const selector = evaluation.rule.limit ?? evaluation.rule.window ?? "unknown";
  if (!evaluation.snapshot) {
    return `${evaluation.rule.provider}/${selector}: unavailable → ${evaluation.rule.action}`;
  }
  const reset = evaluation.snapshot.resetsAt
    ? `, resets ${new Date(evaluation.snapshot.resetsAt).toLocaleString()}`
    : "";
  return `${evaluation.rule.provider}/${selector}: ${percent(evaluation.snapshot.usedPercent)} / ${percent(
    evaluation.rule.thresholdPercent,
  )} (${evaluation.state}) → ${evaluation.rule.action}${reset}`;
}

export default function usageGuard(pi: ExtensionAPI): void {
  pi.setLabel("Usage Guard");

  let config: UsageGuardConfig | undefined;
  let activated = false;
  let loadError: string | undefined;
  let latestCtx: ExtensionContext | undefined;
  let pollTimer: Timer | undefined;
  let refreshPromise: Promise<void> | undefined;
  let lastRefreshStartedAt = 0;
  let decision: PolicyDecision = { active: [], evaluations: [], unavailableEnforcement: [] };
  const providers = new Map<string, ProviderState>();
  const acknowledgements = new Set<string>();
  const announced = new Set<string>();

  let pauseOwned = false;
  let pausePromise: Promise<void> | undefined;
  let closePauseOverlay: (() => void) | undefined;
  let manualOverlayResume = false;

  function recompute(): PolicyDecision {
    decision = activated && config
      ? evaluateUsagePolicy(
          config,
          [...providers.values()].flatMap((state) => state.snapshots),
          acknowledgements,
        )
      : { active: [], evaluations: [], unavailableEnforcement: [] };
    return decision;
  }

  function warningText(evaluation: PolicyDecision["active"][number]): string {
    const snapshot = evaluation.snapshot!;
    const reset = snapshot.resetsAt ? ` Reset: ${new Date(snapshot.resetsAt).toLocaleString()}.` : "";
    return `[usage-guard] ${evaluation.rule.provider} ${snapshot.label} usage is ${percent(
      snapshot.usedPercent,
    )}, crossing the ${percent(evaluation.rule.thresholdPercent)} ${evaluation.rule.action} threshold.${reset}`;
  }

  function announceActive(ctx: ExtensionContext): void {
    for (const evaluation of decision.active) {
      if (!evaluation.activationKey || announced.has(evaluation.activationKey)) continue;
      announced.add(evaluation.activationKey);
      const message = warningText(evaluation);
      ctx.ui.notify(message, "warning");
      pi.sendMessage(
        {
          customType: MESSAGE_TYPE,
          content: message,
          display: true,
          attribution: "user",
        },
        { deliverAs: "nextTurn", triggerTurn: false },
      );
    }
  }

  function updateStatus(ctx: ExtensionContext): void {
    if (!activated) {
      ctx.ui.setStatus(UI_KEY, undefined);
      return;
    }
    if (loadError) {
      ctx.ui.setStatus(UI_KEY, "Usage guard: config error");
      return;
    }
    if (decision.action === "pause") {
      ctx.ui.setStatus(UI_KEY, ctx.hasUI ? "Usage guard: PAUSED" : "Usage guard: PAUSE requested; draining headless session");
      return;
    }
    if (decision.action === "drain-subagents") {
      ctx.ui.setStatus(UI_KEY, "Usage guard: new subagents blocked");
      return;
    }
    const missing = decision.unavailableEnforcement.length;
    ctx.ui.setStatus(UI_KEY, missing ? `Usage guard: ${missing} enforcement rule(s) unavailable` : undefined);
  }

  function finishOwnedPause(): void {
    if (!pauseOwned) return;
    pauseOwned = false;
    agentPauseGate.resume();
  }

  function startPause(ctx: ExtensionContext): void {
    if (pausePromise || pauseOwned) return;
    if (!ctx.hasUI) {
      ctx.ui.notify("Usage guard pause threshold crossed in a headless session; new subagents are blocked instead.", "warning");
      return;
    }
    if (!agentPauseGate.pause()) {
      ctx.ui.notify("Usage guard pause threshold crossed while the global pause gate is already engaged.", "warning");
      return;
    }

    pauseOwned = true;
    manualOverlayResume = false;
    const summary = decision.active
      .filter((evaluation) => evaluation.rule.action === "pause")
      .map(warningText)
      .join(" ");

    pausePromise = ctx.ui
      .custom<void>(
        (_tui, _theme, _keybindings, done) => {
          let closed = false;
          const close = () => {
            if (closed) return;
            closed = true;
            done();
          };
          closePauseOverlay = close;
          return new PauseOverlay(summary, () => {
            manualOverlayResume = true;
            close();
          });
        },
        { overlay: true },
      )
      .catch((error) => {
        pi.logger.error("usage-guard pause overlay failed", { error: errorText(error) });
      })
      .finally(() => {
        closePauseOverlay = undefined;
        if (manualOverlayResume) {
          acknowledgeEvaluations(
            acknowledgements,
            decision.evaluations.filter((evaluation) => evaluation.rule.action === "pause"),
          );
        }
        finishOwnedPause();
        pausePromise = undefined;
        recompute();
        applyDecision(ctx);
      });
  }

  function applyDecision(ctx: ExtensionContext): void {
    announceActive(ctx);
    updateStatus(ctx);
    if (decision.action === "pause") {
      startPause(ctx);
    } else if (pauseOwned) {
      closePauseOverlay?.();
    }
  }

  async function fetchProvider(provider: string, cfg: UsageGuardConfig): Promise<void> {
    const attemptedAt = Date.now();
    try {
      const result = await pi.exec("omp", ["usage", "--json", "--provider", provider], {
        timeout: cfg.commandTimeoutSeconds * 1000,
      });
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || `omp usage exited with code ${result.code}`);
      }
      const parsed = normalizeUsageJson(JSON.parse(result.stdout));
      const providerSnapshots = parsed.filter((snapshot) => snapshot.provider === provider);
      if (providerSnapshots.length === 0) throw new Error("provider returned no usable limits");
      providers.set(provider, { snapshots: providerSnapshots, attemptedAt });
    } catch (error) {
      const previous = providers.get(provider);
      providers.set(provider, {
        snapshots: previous?.snapshots ?? [],
        attemptedAt,
        error: errorText(error),
      });
    }
  }

  async function refresh(maxAgeMs: number): Promise<void> {
    if (!activated || !config) return;
    if (refreshPromise) return refreshPromise;
    if (Date.now() - lastRefreshStartedAt < maxAgeMs) return;

    lastRefreshStartedAt = Date.now();
    const cfg = config;
    refreshPromise = Promise.all([...new Set(cfg.rules.map((rule) => rule.provider))].map((provider) => fetchProvider(provider, cfg)))
      .then(() => {
        if (config !== cfg) return;
        recompute();
        if (latestCtx) applyDecision(latestCtx);
      })
      .finally(() => {
        refreshPromise = undefined;
      });
    return refreshPromise;
  }

  function armPolling(ctx: ExtensionContext): void {
    if (pollTimer) ctx.clearTimer(pollTimer);
    pollTimer = undefined;
    if (!activated || !config) return;
    pollTimer = ctx.setInterval(() => refresh(0), config.pollSeconds * 1000);
  }

  async function reload(ctx: ExtensionContext, notify: boolean): Promise<void> {
    const path = configPath();
    try {
      const source = await readFile(path, "utf8");
      config = parseUsageGuardConfig(JSON.parse(source));
      loadError = undefined;
      acknowledgements.clear();
      announced.clear();
      providers.clear();
      lastRefreshStartedAt = 0;
      armPolling(ctx);
      if (activated) await refresh(0);
      if (notify) {
        ctx.ui.notify(
          `Usage guard loaded ${config.rules.length} rule(s) from ${path}${activated ? " and is active" : "; it remains inactive"}.`,
          "info",
        );
      }
    } catch (error) {
      config = undefined;
      loadError = `${path}: ${errorText(error)}`;
      activated = false;
      recompute();
      armPolling(ctx);
      applyDecision(ctx);
      if (notify) ctx.ui.notify(`Usage guard config error: ${loadError}`, "error");
    }
  }

  function statusText(): string {
    const lines = [
      `Usage guard: ${activated ? "ACTIVE" : "inactive"}`,
      `Config: ${configPath()}`,
    ];
    if (loadError) return [...lines, `Error: ${loadError}`].join("\n");
    if (!config) {
      return [...lines, activated ? "No valid configuration loaded." : "Run /usage-guard activate to load and start it."].join("\n");
    }
    if (!activated) return [...lines, `${config.rules.length} rule(s) loaded but not enforced.`].join("\n");

    lines.push(`Decision: ${decision.action ?? "allow"}`);
    for (const evaluation of decision.evaluations) lines.push(`- ${describeEvaluation(evaluation)}`);
    for (const [provider, state] of providers) {
      if (state.error) lines.push(`- ${provider} refresh error: ${state.error}`);
    }
    return lines.join("\n");
  }

  pi.registerCommand("usage-guard", {
    description: "Activate, deactivate, inspect, or reload provider usage policies",
    handler: async (args, ctx) => {
      latestCtx = ctx;
      const [command = "status", provider, ...extra] = args.trim().split(/\s+/).filter(Boolean);
      if (command === "status" && !provider) {
        if (activated) await refresh(config ? config.forceRefreshSeconds * 1000 : 0);
        ctx.ui.notify(statusText(), loadError ? "error" : "info");
        return;
      }
      if (command === "activate" && !provider) {
        if (activated) {
          ctx.ui.notify("Usage guard is already active.", "info");
          return;
        }
        activated = true;
        await reload(ctx, true);
        return;
      }
      if (command === "deactivate" && !provider) {
        activated = false;
        if (pollTimer) ctx.clearTimer(pollTimer);
        pollTimer = undefined;
        closePauseOverlay?.();
        finishOwnedPause();
        recompute();
        updateStatus(ctx);
        ctx.ui.notify("Usage guard deactivated for this session.", "info");
        return;
      }
      if (command === "reload" && !provider) {
        await reload(ctx, true);
        return;
      }
      if (command === "resume" && extra.length === 0 && activated) {
        recompute();
        const count = acknowledgeEvaluations(acknowledgements, decision.evaluations, provider);
        recompute();
        applyDecision(ctx);
        ctx.ui.notify(
          count
            ? `Acknowledged ${count} active usage rule(s)${provider ? ` for ${provider}` : ""} until their quota windows change.`
            : `No active usage rules${provider ? ` for ${provider}` : ""} to acknowledge.`,
          count ? "info" : "warning",
        );
        return;
      }
      ctx.ui.notify("usage: /usage-guard activate | deactivate | status | reload | resume [provider]", "warning");
    },
  });

  pi.on("session_start", (_event, ctx) => {
    latestCtx = ctx;
    updateStatus(ctx);
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "task" || !activated || !config) return;
    latestCtx = ctx;
    await refresh(config.forceRefreshSeconds * 1000);
    recompute();
    applyDecision(ctx);

    if (decision.unavailableEnforcement.length > 0) {
      const providers = [...new Set(decision.unavailableEnforcement.map((evaluation) => evaluation.rule.provider))];
      return {
        block: true,
        reason: `Usage guard could not verify enforcement limits for ${providers.join(", ")}; refusing a new subagent launch. Run /usage-guard status or reload.`,
      };
    }
    if (decision.action === "drain-subagents" || decision.action === "pause") {
      return {
        block: true,
        reason: `Usage guard blocked this new subagent launch (${decision.action}). Existing subagents may finish; use /usage-guard resume [provider] to acknowledge the current quota window.`,
      };
    }
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (pollTimer) ctx.clearTimer(pollTimer);
    pollTimer = undefined;
    closePauseOverlay?.();
    finishOwnedPause();
    ctx.ui.setStatus(UI_KEY, undefined);
  });
}
