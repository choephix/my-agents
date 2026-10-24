import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const ruleTypes = ["folderPrefix", "folderName", "remoteGlob", "pathGlob", "pathRegex"] as const;
export type RuleType = (typeof ruleTypes)[number];

// Windows daemons report roots like `D:\Sources\Nilo`; rules and matching compare with `/` separators.
const slashes = (path: string) => path.replace(/\\/g, "/");

// One check shared by the schema and the settings form, so both report the same problem.
export function ruleValueError(type: RuleType, value: string): string | undefined {
  if (!value) return "Enter a value";
  if (type === "folderName" && /[\\/]/.test(value)) return "One folder name, without / or \\";
  // Project roots are absolute daemon paths; `~` and relative paths would silently never match.
  if ((type === "folderPrefix" || type === "pathGlob") && !/^(\/|[A-Za-z]:\/)/.test(slashes(value))) return "Use an absolute path (~ is not expanded)";
  if (type === "pathRegex") {
    try { new RegExp(value); } catch (cause) {
      return `Invalid regular expression: ${cause instanceof Error ? cause.message.replace(/^Invalid regular expression: /, "") : String(cause)}`;
    }
  }
  return undefined;
}
function rule<Type extends RuleType>(type: Type) {
  return z.object({
    type: z.literal(type),
    value: z.string().superRefine((value, context) => {
      const message = ruleValueError(type, value);
      if (message) context.addIssue({ code: "custom", message });
    }),
  }).strict();
}
export const ruleSchema = z.discriminatedUnion("type", [
  rule("folderPrefix"), rule("folderName"), rule("remoteGlob"), rule("pathGlob"), rule("pathRegex"),
]);
export const presetIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/).refine((id) => id !== "all" && id !== "other", "all and other are reserved");
export const presetsSchema = z.array(z.object({
  id: presetIdSchema,
  name: z.string().trim().min(1),
  rules: z.array(ruleSchema).min(1),
}).strict()).refine((presets) => new Set(presets.map((preset) => preset.id)).size === presets.length, "Preset IDs must be unique");

export const defaultPresets = [{
  id: "nilo",
  name: "Nilo",
  rules: [{ type: "folderName" as const, value: "nilo" }, { type: "folderName" as const, value: "nilo-*" }],
}];

export const preferences = defineSettings({
  id: "presets",
  scope: "host",
  version: 1,
  schema: z.object({ presets: presetsSchema.default(defaultPresets) }),
});
export type Preset = z.infer<typeof presetsSchema>[number];

export interface Project {
  projectId: string;
  projectKey?: string;
  projectRootPath: string;
  projectDisplayName: string;
  projectCustomName?: string | null;
}

/** The name Paseo's sidebar shows: a rename wins over the folder name. */
export function projectName(project: Project): string {
  return project.projectCustomName || project.projectDisplayName;
}

/**
 * A rule that matches this project and no other current one. "Inside folder" also catches projects nested below
 * the root (e.g. /mnt/vault contains /mnt/vault/Infra), so those cases get an exact path pattern instead.
 */
export function projectOnlyRule(project: Project, projects: readonly Project[]): { type: "folderPrefix" | "pathGlob"; value: string } {
  const root = project.projectRootPath;
  const inside = slashes(root).replace(/\/+$/, "") + "/";
  const nested = projects.some((other) => slashes(other.projectRootPath).startsWith(inside));
  return nested && !/[*?]/.test(root) ? { type: "pathGlob", value: root } : { type: "folderPrefix", value: root };
}

// Globs are anchored, case-sensitive: * excludes /, ** includes /, ? is one non-/ character.
function glob(pattern: string): RegExp {
  let expression = "^";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*" && pattern[i + 1] === "*") { expression += ".*"; i++; }
    else if (char === "*") expression += "[^/]*";
    else if (char === "?") expression += "[^/]";
    else expression += char.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }
  return new RegExp(expression + "$");
}

export function compilePreset(preset: Pick<Preset, "rules">): (project: Project) => boolean {
  const rules = preset.rules.map((rule) => {
    if (rule.type === "folderPrefix") {
      const prefix = slashes(rule.value).replace(/\/+$/, "");
      return (project: Project) => {
        const root = slashes(project.projectRootPath);
        return root === prefix || root.startsWith(prefix + "/");
      };
    }
    if (rule.type === "folderName") {
      const regex = glob(rule.value);
      return (project: Project) => slashes(project.projectRootPath).split("/").some((segment) => regex.test(segment));
    }
    if (rule.type === "pathRegex") {
      const regex = new RegExp(rule.value);
      return (project: Project) => regex.test(project.projectRootPath);
    }
    if (rule.type === "pathGlob") {
      const regex = glob(slashes(rule.value));
      return (project: Project) => regex.test(slashes(project.projectRootPath));
    }
    const raw = rule.value.replace(/^remote:/, "");
    // org/repo patterns are GitHub shortcuts. Full host/org/repo patterns work on other forges.
    const githubShortcut = !raw.split("/")[0].includes(".");
    // The daemon lower-cases GitHub owner/repo in project keys, so GitHub patterns compare lower-case too.
    const regex = glob(githubShortcut || /^github\.com\//i.test(raw) ? raw.toLowerCase() : raw);
    return (project: Project) => {
      if (!project.projectKey?.startsWith("remote:")) return false;
      const remote = project.projectKey.slice(7).split("#subdir:")[0];
      return regex.test(githubShortcut ? remote.replace(/^github\.com\//, "") : remote);
    };
  });
  return (project) => rules.some((matches) => matches(project));
}
