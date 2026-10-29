import { describe, expect, test } from "vitest";
import { compilePreset, presetsSchema, projectOnlyRule, ruleValueError, type Project } from "../shared/presets";

const project = (projectRootPath: string, projectKey?: string): Project => ({
  projectId: projectRootPath, projectRootPath, projectKey, projectDisplayName: projectRootPath.split("/").at(-1)!,
});

describe("Add to: this project only", () => {
  const vault = project("/mnt/notes");
  const infra = project("/mnt/notes/Example Team");
  const game = project("/home/user/workspace/acme-game");
  const projects = [vault, infra, game];

  test("a project with another project inside its folder matches only itself", () => {
    const matches = compilePreset({ rules: [projectOnlyRule(vault, projects)] });
    expect(projects.filter(matches)).toEqual([vault]);
  });

  test("a project with nothing nested keeps the Inside folder rule", () => {
    expect(projectOnlyRule(game, projects)).toEqual({ type: "folderPrefix", value: game.projectRootPath });
    expect(projects.filter(compilePreset({ rules: [projectOnlyRule(infra, projects)] }))).toEqual([infra]);
  });

  test("a similarly named neighbour is not nested", () => {
    const neighbour = project("/mnt/notes-2");
    expect(projectOnlyRule(vault, [vault, neighbour]).type).toBe("folderPrefix");
  });
});

describe("rules that could never match are rejected", () => {
  test.each([
    ["folderPrefix", "~/workspace/acme"],
    ["folderPrefix", "workspace/acme"],
    ["pathGlob", "~/workspace/acme-*"],
  ] as const)("%s %s", (type, value) => {
    expect(ruleValueError(type, value)).toMatch(/absolute path/);
    expect(presetsSchema.safeParse([{ id: "acme", name: "Acme", rules: [{ type, value }] }]).success).toBe(false);
  });

  test("absolute paths stay valid", () => {
    expect(ruleValueError("folderPrefix", "/home/user/workspace/acme")).toBeUndefined();
    expect(ruleValueError("pathGlob", "/home/*/workspace/acme-*")).toBeUndefined();
  });
});

describe("GitHub remote patterns ignore case", () => {
  // The daemon lower-cases GitHub owner/repo in project keys.
  const acme = project("/home/user/workspace/acme", "remote:github.com/acme/acme-app");
  const gitlab = project("/home/user/work/team", "remote:gitlab.com/Team/App");

  test.each(["Acme/*", "github.com/Acme/Acme-App", "remote:GitHub.com/acme/*"])("%s", (value) => {
    expect(compilePreset({ rules: [{ type: "remoteGlob", value }] })(acme)).toBe(true);
  });

  test("other forges stay case-sensitive", () => {
    expect(compilePreset({ rules: [{ type: "remoteGlob", value: "gitlab.com/Team/*" }] })(gitlab)).toBe(true);
    expect(compilePreset({ rules: [{ type: "remoteGlob", value: "gitlab.com/team/*" }] })(gitlab)).toBe(false);
  });
});

describe("Windows project roots", () => {
  const acme = project("D:\\Sources\\Acme");
  const app = project("D:\\Sources\\acme-app\\client");
  const notes = project("D:\\Notes");
  const team = project("D:\\Notes\\Team");
  const share = project("\\\\server\\share\\acme-tools");
  const projects = [acme, app, notes, team, share];
  const matching = (type: "folderPrefix" | "folderName" | "pathGlob", value: string) =>
    projects.filter(compilePreset({ rules: [{ type, value }] }));

  test("folder names match any segment of a backslash path", () => {
    expect(matching("folderName", "Acme")).toEqual([acme]);
    expect(matching("folderName", "acme-*")).toEqual([app, share]);
  });

  test("folders and patterns match with either separator and drive-letter case", () => {
    expect(matching("folderPrefix", "D:\\Sources")).toEqual([acme, app]);
    expect(matching("folderPrefix", "d:/Sources/")).toEqual([acme, app]);
    expect(matching("folderPrefix", "\\\\server\\share")).toEqual([share]);
    expect(matching("pathGlob", "D:\\Sources\\*")).toEqual([acme]);
    expect(matching("pathGlob", "D:/Sources/**")).toEqual([acme, app]);
  });

  test("drive and UNC paths are absolute; a lone leading backslash is not", () => {
    expect(ruleValueError("folderPrefix", "D:\\Sources")).toBeUndefined();
    expect(ruleValueError("pathGlob", "c:/work/*")).toBeUndefined();
    expect(ruleValueError("folderPrefix", "\\\\server\\share")).toBeUndefined();
    expect(ruleValueError("folderPrefix", "Sources\\Acme")).toMatch(/absolute path/);
    expect(ruleValueError("pathGlob", "\\Sources\\*")).toMatch(/absolute path/);
  });

  test("Add to picks an exact pattern for a folder holding another project", () => {
    expect(projects.filter(compilePreset({ rules: [projectOnlyRule(notes, projects)] }))).toEqual([notes]);
    expect(projectOnlyRule(acme, projects)).toEqual({ type: "folderPrefix", value: acme.projectRootPath });
  });
});

describe("POSIX paths keep backslashes as part of folder names", () => {
  const archive = project("/work/team\\archive");

  test("a backslash is not a separator", () => {
    expect(compilePreset({ rules: [{ type: "folderName", value: "archive" }] })(archive)).toBe(false);
    expect(compilePreset({ rules: [{ type: "folderName", value: "team\\archive" }] })(archive)).toBe(true);
    expect(compilePreset({ rules: [{ type: "folderPrefix", value: "/work/team" }] })(archive)).toBe(false);
    expect(ruleValueError("folderName", "team\\archive")).toBeUndefined();
  });
});
