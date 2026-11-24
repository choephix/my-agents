import type { PaseoApi } from "@getpaseo/client";
import type { PluginHandlerContext, PluginSettings } from "@getpaseo/plugin/server";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { NEW_WORKSPACE_EFFORT_KEY } from "../shared/new-workspace";
import type { folderSettings } from "../shared/settings";
import { BindingStore } from "./bindings";
import { EffortsService } from "./efforts";

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "efforts-nw-test-"));
  dirs.push(dir);
  return dir;
}

afterAll(async () => {
  for (const dir of dirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

type FolderSettings = PluginSettings<(typeof folderSettings)["schema"]>;

function mockSettings(values: Partial<{ extraFolders: string[]; excludedFolders: string[]; showHeaderButton: boolean; commitsShown: number }> = {}): FolderSettings {
  return {
    read: async () => ({
      status: "ready",
      revision: "1",
      values: {
        extraFolders: [],
        excludedFolders: [],
        showHeaderButton: true,
        commitsShown: 30,
        ...values,
      },
    }),
  } as unknown as FolderSettings;
}

function mockContext(input: {
  projects?: { projectId: string; projectRootPath: string }[];
  workspaces?: { id: string; projectId: string; projectRootPath: string; workspaceDirectory?: string; archivingAt?: string | null; internal?: boolean }[];
}): PluginHandlerContext {
  const paseo = {
    projects: {
      list: async () => ({ projects: input.projects ?? [] }),
    },
    workspaces: {
      list: async () => ({
        entries: input.workspaces ?? [],
        pageInfo: { hasMore: false, nextCursor: null },
      }),
    },
  } as unknown as PaseoApi;
  return { paseo };
}

async function createEffort(scratchDir: string, slug: string, mapContent: string): Promise<void> {
  const effortDir = path.join(scratchDir, slug);
  await mkdir(effortDir, { recursive: true });
  await writeFile(path.join(effortDir, "map.md"), mapContent);
}

describe("EffortsService.projectEfforts", () => {
  it("finds efforts in the project's .scratch and filters by multi-word query", async () => {
    const dir = await tempDir();
    const projectDir = path.join(dir, "acme");
    const scratchDir = path.join(projectDir, ".scratch");
    await createEffort(scratchDir, "alpha-launch", "# Alpha Launch\n\nStatus: delivery\n\n## Destination\n\nShip onboarding flow.\n");
    await createEffort(scratchDir, "beta-cleanup", "# Beta Cleanup\n\nStatus: planning\n\n## Destination\n\nPrune old endpoints.\n");

    const service = new EffortsService(new BindingStore(path.join(dir, "bindings.json")), mockSettings());
    const context = mockContext({ projects: [{ projectId: "prj_1", projectRootPath: projectDir }] });

    const all = await service.projectEfforts({ projectId: "prj_1" }, context);
    expect(all.hasEfforts).toBe(true);
    expect(all.rootCount).toBe(1);
    expect(all.efforts.map((e) => e.slug).sort()).toEqual(["alpha-launch", "beta-cleanup"]);
    expect(all.efforts[0]?.rootLabel).toBe("acme");

    const filtered = await service.projectEfforts({ projectId: "prj_1", query: "onboarding ship" }, context);
    expect(filtered.hasEfforts).toBe(true);
    expect(filtered.efforts.map((e) => e.slug)).toEqual(["alpha-launch"]);
  });

  it("discovers workspace-level .scratch roots and extraFolders inside the project", async () => {
    const dir = await tempDir();
    const repoDir = path.join(dir, "monorepo");
    const subDir = path.join(repoDir, "plugins");
    const subScratch = path.join(subDir, ".scratch");
    await createEffort(subScratch, "plugin-upgrade", "# Plugin Upgrade\n\nStatus: active\n");

    const service = new EffortsService(new BindingStore(path.join(dir, "bindings.json")), mockSettings({ extraFolders: [subScratch] }));
    const context = mockContext({ projects: [{ projectId: "prj_mono", projectRootPath: repoDir }] });

    const result = await service.projectEfforts({ projectId: "prj_mono" }, context);
    expect(result.hasEfforts).toBe(true);
    expect(result.efforts.map((e) => e.slug)).toEqual(["plugin-upgrade"]);
    expect(result.efforts[0]?.rootLabel).toBe("plugins");
  });

  it("returns hasEfforts: false for projects with no .scratch efforts", async () => {
    const dir = await tempDir();
    const plainDir = path.join(dir, "plain-repo");
    await mkdir(plainDir, { recursive: true });

    const service = new EffortsService(new BindingStore(path.join(dir, "bindings.json")), mockSettings());
    const context = mockContext({ projects: [{ projectId: "prj_plain", projectRootPath: plainDir }] });

    const result = await service.projectEfforts({ projectId: "prj_plain" }, context);
    expect(result).toEqual({ hasEfforts: false, rootCount: 0, efforts: [] });
  });
});

describe("EffortsService.applyInitialBinding", () => {
  it("persists an effort binding from workspace metadata", async () => {
    const dir = await tempDir();
    const scratchDir = path.join(dir, "acme", ".scratch");
    await createEffort(scratchDir, "onboarding-flow", "# Onboarding Flow\n");
    const realScratch = await realpath(scratchDir);

    const store = new BindingStore(path.join(dir, "bindings.json"));
    const service = new EffortsService(store, mockSettings());

    const applied = await service.applyInitialBinding("wks_new", {
      [NEW_WORKSPACE_EFFORT_KEY]: { kind: "effort", root: realScratch, slug: "onboarding-flow", label: "onboarding-flow" },
    });
    expect(applied).toBe(true);
    const bindings = await store.all();
    expect(bindings.wks_new).toMatchObject({ kind: "effort", root: realScratch, slug: "onboarding-flow" });
  });

  it("persists an explicit No effort binding and ignores missing or invalid metadata", async () => {
    const dir = await tempDir();
    const store = new BindingStore(path.join(dir, "bindings.json"));
    const service = new EffortsService(store, mockSettings());

    expect(await service.applyInitialBinding("wks_empty", {})).toBe(false);
    expect(await service.applyInitialBinding("wks_bad", { [NEW_WORKSPACE_EFFORT_KEY]: "oops" })).toBe(false);
    expect(await service.applyInitialBinding("wks_none", { [NEW_WORKSPACE_EFFORT_KEY]: { kind: "none" } })).toBe(true);

    const bindings = await store.all();
    expect(bindings.wks_empty).toBeUndefined();
    expect(bindings.wks_bad).toBeUndefined();
    expect(bindings.wks_none).toMatchObject({ kind: "none" });
  });

  it("rejects traversal slugs or non-.scratch roots in metadata", async () => {
    const dir = await tempDir();
    const store = new BindingStore(path.join(dir, "bindings.json"));
    const service = new EffortsService(store, mockSettings());

    await expect(
      service.applyInitialBinding("wks_evil", {
        [NEW_WORKSPACE_EFFORT_KEY]: { kind: "effort", root: dir, slug: "../escape" },
      }),
    ).rejects.toThrow();
  });
});
