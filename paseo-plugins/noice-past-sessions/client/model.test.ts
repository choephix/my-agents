import { describe, expect, it } from "vitest";
import type { PastSession } from "../shared/rpc";
import { buildListItems, matchesQuery, mergeByNewest, sourceWord, type ListItem } from "./model";

function session(key: string, title: string, cwd = "/home/user/workspace/acme-app"): PastSession {
  return { key, source: key.startsWith("omp:") ? "omp" : "paseo", title, cwd, at: "2026-10-19T00:00:00.000Z", provider: "omp", preview: null };
}

const shape = (items: ListItem[]) =>
  items.map((item) => (item.kind === "row" ? item.key : item.kind === "same-folder-header" ? `header:${item.count}:${item.open}` : item.kind));

describe("buildListItems", () => {
  const data = {
    entries: [session("paseo:a", "Sample highlight"), session("paseo:b", "Example task")],
    sameFolder: [session("omp:1", "Example session."), session("omp:2", "Fix highlight colors")],
  };
  const none = new Set<string>();
  const plain = { query: "", sameFolderOpen: false, starred: none, hidden: none, showHidden: false };

  it("keeps the same-folder section collapsed below the main list until opened", () => {
    expect(shape(buildListItems(data, plain))).toEqual(["paseo:a", "paseo:b", "header:2:false"]);
    expect(shape(buildListItems(data, { ...plain, sameFolderOpen: true }))).toEqual([
      "paseo:a",
      "paseo:b",
      "header:2:true",
      "omp:1",
      "omp:2",
    ]);
  });

  it("opens the section for a search and counts only matches", () => {
    expect(shape(buildListItems(data, { ...plain, query: "highlight" }))).toEqual(["paseo:a", "header:1:true", "omp:2"]);
  });

  it("puts an empty placeholder before the section when the main list has nothing", () => {
    expect(shape(buildListItems({ entries: [], sameFolder: data.sameFolder }, plain))).toEqual(["empty", "header:2:false"]);
    expect(shape(buildListItems({ entries: [], sameFolder: [] }, plain))).toEqual(["empty"]);
  });

  it("leaves hidden rows out of the list, the section and its count until shown", () => {
    const hidden = new Set(["paseo:a", "paseo:b", "omp:1"]);
    expect(shape(buildListItems(data, { ...plain, hidden, sameFolderOpen: true }))).toEqual([
      "empty",
      "header:1:true",
      "omp:2",
    ]);
    expect(shape(buildListItems(data, { ...plain, hidden, showHidden: true }))).toEqual([
      "paseo:a",
      "paseo:b",
      "header:2:false",
    ]);
  });

  it("leads with starred rows in the list and in the section, each group newest first", () => {
    const list = {
      entries: ["paseo:a", "paseo:b", "paseo:c", "paseo:d"].map((key) => session(key, key)),
      sameFolder: ["omp:1", "omp:2", "omp:3"].map((key) => session(key, key)),
    };
    const starred = new Set(["paseo:d", "paseo:b", "omp:3", "omp:gone"]);
    expect(shape(buildListItems(list, { ...plain, sameFolderOpen: true, starred }))).toEqual([
      "paseo:b",
      "paseo:d",
      "paseo:a",
      "paseo:c",
      "header:3:true",
      "omp:3",
      "omp:1",
      "omp:2",
    ]);
  });
});

describe("matchesQuery", () => {
  it("needs every word, in title or folder, ignoring case", () => {
    const entry = session("paseo:a", "Sample highlight tint", "/home/user/workspace/acme-app/.scratch");
    expect(matchesQuery(entry, "TINT scratch")).toBe(true);
    expect(matchesQuery(entry, "tint unrelated")).toBe(false);
    expect(matchesQuery(entry, "   ")).toBe(true);
  });
});

describe("mergeByNewest", () => {
  it("interleaves two newest-first lists by time", () => {
    const at = (key: string, iso: string) => ({ ...session(key, key), at: iso });
    const merged = mergeByNewest(
      [at("paseo:a", "2026-10-19T10:00:00.000Z"), at("omp:b", "2026-10-17T10:00:00.000Z")],
      [at("ext:claude:c", "2026-10-18T10:00:00.000Z"), at("ext:codex:d", "2026-10-01T10:00:00.000Z")],
    );
    expect(merged.map((entry) => entry.key)).toEqual(["paseo:a", "ext:claude:c", "omp:b", "ext:codex:d"]);
  });
});

describe("sourceWord", () => {
  it("names where a session ran; Paseo agents carry no word", () => {
    expect(sourceWord(session("paseo:a", "x"))).toBeNull();
    expect(sourceWord({ ...session("omp:a", "x"), source: "omp" })).toBe("terminal");
    expect(sourceWord({ ...session("ext:claude:a", "x"), source: "external", provider: "claude" })).toBe("claude code");
    expect(sourceWord({ ...session("ext:codex:a", "x"), source: "external", provider: "codex" })).toBe("codex");
  });
});
