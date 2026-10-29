import { describe, expect, test } from "vitest";
import { hostFromPath, hostFromScopes, ownerFromTestId, providerFromScopes } from "../shared/identity";

const NILO_AGENT = "00000000-0000-4000-8000-000000000001";
const CLAUDE_AGENT = "00000000-0000-4000-8000-000000000002";
const directory = {
  agents: new Map([[NILO_AGENT, "omp-nilo"], [CLAUDE_AGENT, "claude"]]),
  providers: new Set(["claude", "omp", "omp-nilo"]),
  labels: new Map([["Oh My Pi (nilo)", "omp-nilo"], ["Oh My Pi", "omp"]]),
};

// Synthetic ids using the Paseo 0.12.0 web app's data-testid formats.
describe("tier 1: data-testid owners", () => {
  test("agent tabs resolve through the agent's exact provider, so identical Bot glyphs differ", () => {
    expect(ownerFromTestId(`workspace-tab-agent_${NILO_AGENT}`, directory)).toEqual({ provider: "omp-nilo", host: undefined });
    expect(ownerFromTestId(`workspace-tab-agent_${CLAUDE_AGENT}`, directory)?.provider).toBe("claude");
    expect(ownerFromTestId("workspace-tab-agent_00000000-0000-0000-0000-000000000000", directory)).toBeUndefined();
    expect(ownerFromTestId("workspace-tab-terminal_00000000-0000-4000-8000-000000000003", directory)).toBeUndefined();
  });
  test("history rows carry their host, which matters on host-less routes like /sessions", () => {
    expect(ownerFromTestId(`agent-row-srv_example-${NILO_AGENT}`, directory)).toEqual({ provider: "omp-nilo", host: "srv_example" });
  });
  test("model rows pick the longest provider id prefix: omp-nilo is not omp", () => {
    expect(ownerFromTestId("model-row-omp-nilo-anthropic/claude-fable-5.1", directory)?.provider).toBe("omp-nilo");
    expect(ownerFromTestId("model-row-omp-anthropic/claude-fable-5.1", directory)?.provider).toBe("omp");
    expect(ownerFromTestId("model-row-unknown-model", directory)).toBeUndefined();
  });
  test("picker provider rows require a provider the daemon knows", () => {
    expect(ownerFromTestId("model-provider-omp-nilo", directory)?.provider).toBe("omp-nilo");
    expect(ownerFromTestId("model-provider-search", directory)).toBeUndefined();
  });
  test("command-center model choices carry host and provider, including model ids with colons", () => {
    expect(ownerFromTestId("command-center-model-srv_1:omp-nilo:model:variant", directory)).toEqual({ provider: "omp-nilo", host: "srv_1" });
    expect(ownerFromTestId("command-center-thinking-srv_1:omp-nilo:high", directory)).toBeUndefined();
  });
  test("catalog tiles and the import filter trigger", () => {
    expect(ownerFromTestId("provider-catalog-tile-goose", directory)?.provider).toBe("goose");
    expect(ownerFromTestId("import-session-filter-trigger", directory, "Filter: Oh My Pi (nilo)")?.provider).toBe("omp-nilo");
    expect(ownerFromTestId("import-session-filter-trigger", directory, "Filter: All providers")).toBeUndefined();
    expect(ownerFromTestId("other-filter", directory, "Filter: Oh My Pi (nilo)")).toBeUndefined();
  });
  test("containers that merely hold glyphs are not owners", () => {
    for (const id of ["combined-model-selector", "host-page-providers-card", "subagents-track-row-ExampleAgent", "tool-call-badge", "settings-host-section-agents"]) {
      expect(ownerFromTestId(id, directory)).toBeUndefined();
    }
  });
  test("an agent the page has not seen yet is asked for, once per sighting", () => {
    const asked: string[] = [];
    const unknown = "00000000-0000-0000-0000-0000000000aa";
    const watching = { ...directory, missing: (id: string) => asked.push(id) };
    expect(ownerFromTestId(`workspace-tab-agent_${unknown}`, watching)).toBeUndefined();
    expect(providerFromScopes([{ tab: { target: { kind: "agent", agentId: unknown } } }], watching)).toBeUndefined();
    expect(ownerFromTestId(`workspace-tab-agent_${NILO_AGENT}`, watching)?.provider).toBe("omp-nilo");
    // History rows already fall back to their props; archived agents must not trigger fetches.
    ownerFromTestId(`agent-row-srv_1-${unknown}`, watching);
    expect(asked).toEqual([unknown, unknown]);
  });
  test("history row children (title, workspace, project, branch) are not taken for the row", () => {
    for (const part of ["title", "workspace", "project", "branch"]) {
      expect(ownerFromTestId(`agent-row-${part}-srv_example-${NILO_AGENT}`, directory)).toBeUndefined();
    }
  });
});

describe("tier 2: component props", () => {
  test("each provider-icon consumer's prop shape resolves", () => {
    // model-browser/schedules, terminal profiles, settings rows, agent list, import rows, sub-agent rows.
    for (const scope of [{ provider: "omp-nilo" }, { iconKey: "omp-nilo" }, { def: { id: "omp-nilo" } }, { agent: { provider: "omp-nilo" } }, { entry: { providerId: "omp-nilo" } }, { row: { provider: "omp-nilo" } }]) {
      expect(providerFromScopes([scope], directory)).toBe("omp-nilo");
    }
  });
  test("tab targets: agent, provider-native sub-agent via its parent, draft setup; never terminals", () => {
    expect(providerFromScopes([{ tab: { target: { kind: "agent", agentId: CLAUDE_AGENT } } }], directory)).toBe("claude");
    expect(providerFromScopes([{ item: { target: { kind: "provider_subagent", parentAgentId: NILO_AGENT } } }], directory)).toBe("omp-nilo");
    expect(providerFromScopes([{ tab: { target: { kind: "draft", setup: { provider: "claude" } } } }], directory)).toBe("claude");
    expect(providerFromScopes([{ tab: { target: { kind: "terminal", agentId: NILO_AGENT } } }], directory)).toBeUndefined();
  });
  test("the nearest owner wins over an enclosing selection", () => {
    expect(providerFromScopes([{ size: 16 } as object, { provider: "claude" }, { selectedProvider: "omp-nilo" }], directory)).toBe("claude");
  });
  test("labels count only in an icon slot and only when they are an exact provider label", () => {
    expect(providerFromScopes([{ label: "Oh My Pi (nilo)", leadingSlot: {} }], directory)).toBe("omp-nilo");
    expect(providerFromScopes([{ label: "Oh My Pi (nilo)" }], directory)).toBeUndefined();
    expect(providerFromScopes([{ label: "Checks passed", leadingSlot: {} }], directory)).toBeUndefined();
  });
  test("non-string props are ignored rather than coerced", () => {
    expect(providerFromScopes([{ provider: { id: "omp-nilo" } }, { provider: "" }], directory)).toBeUndefined();
  });
});

describe("host ownership", () => {
  test("glyph owner's serverId, then an agent's serverId, then the route", () => {
    expect(hostFromScopes([{}, { serverId: "other-host" }])).toBe("other-host");
    expect(hostFromScopes([{ agent: { provider: "claude", serverId: "srv_a" } }])).toBe("srv_a");
    expect(hostFromScopes([{ provider: "claude" }])).toBeUndefined();
    expect(hostFromPath("/settings/hosts/this-host/providers")).toBe("this-host");
    expect(hostFromPath("/h/this-host/workspace/w")).toBe("this-host");
    expect(hostFromPath("/sessions")).toBeUndefined();
    expect(hostFromPath("/h/bad%E0%A4%A/workspace")).toBe("bad%E0%A4%A");
  });
});
