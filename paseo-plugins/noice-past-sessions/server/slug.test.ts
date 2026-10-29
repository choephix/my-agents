import { describe, expect, it } from "vitest";
import { ompDirNames, subtreeDirMatcher } from "./slug";

// Expected names use synthetic paths under a fixture home.
const roots = { home: "/home/user", tmp: "/tmp" };

describe("ompDirNames", () => {
  it("encodes folders under home relative to home", () => {
    expect(ompDirNames("/home/user/workspace/acme-app", roots).current).toBe("-workspace-acme-app");
    expect(ompDirNames("/home/user/.herdr/worktrees/acme-app/TICKET-123", roots).current).toBe(
      "-.herdr-worktrees-acme-app-TICKET-123",
    );
    expect(ompDirNames("/home/user", roots).current).toBe("-");
  });

  it("wraps folders outside home in double dashes and keeps spaces", () => {
    expect(ompDirNames("/mnt/shared-vault/Example Notes", roots).current).toBe(
      "--mnt-shared-vault-Example Notes--",
    );
  });

  it("encodes the temp dir before home, so /tmp/x and ~/tmp/x can share a name", () => {
    expect(ompDirNames("/tmp/sample-project", roots).current).toBe("-tmp-sample-project");
    expect(ompDirNames("/home/user/tmp", roots).current).toBe("-tmp");
    expect(ompDirNames("/tmp", roots).current).toBe("-tmp");
  });

  it("lists the legacy hashed name OMP has not migrated yet", () => {
    const names = ompDirNames("/home/user/.herdr/worktrees/acme-app/sample-theme", roots).all;
    expect(names).toContain(
      "home-sample-theme-51526ee1a1033d4a33558e4944d029082a43706a1339cfeaeb5b2edcf12de900",
    );
    expect(ompDirNames("/home/user/workspace/acme-app-copy-2", roots).all).toContain(
      "home-acme-app-copy-2-500b143193d3eaeb271daee50e6eb7cc7279a8876f22418d1217a64e13651232",
    );
  });

  it("lists the legacy absolute name for home folders", () => {
    expect(ompDirNames("/home/user/workspace/acme-app", roots).all).toContain("--home-user-workspace-acme-app--");
  });
});

describe("subtreeDirMatcher", () => {
  const underIndex = subtreeDirMatcher(["/home/user/workspace/acme-app"], roots);
  const underVault = subtreeDirMatcher(["/mnt/shared-vault"], roots);

  it("accepts the folder itself and folders below it", () => {
    expect(underIndex("-workspace-acme-app")).toBe(true);
    expect(underIndex("-workspace-acme-app-.scratch-sample-cache")).toBe(true);
    expect(underVault("--mnt-shared-vault-Sample Folder--")).toBe(true);
  });

  it("rejects siblings whose names only share a prefix without a separator", () => {
    expect(underIndex("-workspace-acme-apper")).toBe(false);
    expect(underIndex("-workspace-other")).toBe(false);
    expect(underVault("--mnt-shared-vaults--")).toBe(false);
  });

  it("matches any of several roots, e.g. a repo and its worktrees", () => {
    const project = subtreeDirMatcher(["/home/user/workspace/acme-app", "/home/user/.herdr/worktrees/acme-app/TICKET-123"], roots);
    expect(project("-workspace-acme-app-worktrees-TICKET-789-review")).toBe(true);
    expect(project("-.herdr-worktrees-acme-app-TICKET-123")).toBe(true);
    expect(project("-.herdr-worktrees-acme-app-TICKET-456")).toBe(false);
  });

  it("keeps hashed legacy names as candidates since their path is only in the files", () => {
    expect(
      underIndex("home-sample-app-b50327a44581a7cca1b476e487323915c1fb3099ff51b3242a411465318662ee"),
    ).toBe(true);
  });
});
