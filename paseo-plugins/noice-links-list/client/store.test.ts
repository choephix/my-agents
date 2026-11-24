import { describe, expect, it } from "vitest";
import type { Link, LinkKind } from "../shared/links";
import { keepChatSubagents, kindCounts, LinksStore, rowMark, shownKind, withSubagents, type ChatLinks } from "./store";

const link = (kind: LinkKind, n: number): Link => ({ key: `${kind}:${n}`, kind, title: `${kind} ${n}`, where: "", path: `~/${n}`, glyph: "File", lastAt: n });

describe("type tabs", () => {
  it("lists only the types a chat has, in tab order", () => {
    expect(kindCounts([link("file", 1), link("image", 2), link("file", 3)])).toEqual([
      { kind: "image", count: 1 },
      { kind: "file", count: 2 },
    ]);
  });

  it("open on Web when the chat has web links, else on its first type", () => {
    expect(shownKind([link("image", 1), link("web", 2), link("file", 3)], undefined)).toBe("web");
    expect(shownKind([link("file", 1), link("image", 2)], undefined)).toBe("image");
    expect(shownKind([], undefined)).toBeNull();
  });

  it("keep the user's tab while that type is present, else fall back", () => {
    const chat = [link("web", 1), link("image", 2), link("file", 3)];
    expect(shownKind(chat, "file")).toBe("file");
    expect(shownKind([link("web", 1), link("image", 2)], "file")).toBe("web");
  });
});

describe("sub-agent links", () => {
  it("merge into the chat's links newest first only when shown, marked with their sub-agent", () => {
    const chat = [link("web", 9), link("image", 3)];
    const extra: Link[] = [{ ...link("web", 5), via: "Builder" }, { ...link("file", 1), via: "Scout" }];
    expect(withSubagents(chat, extra, false)).toBe(chat);
    const shown = withSubagents(chat, extra, true);
    expect(shown.map((row) => [row.lastAt, rowMark(row)])).toEqual([
      [9, ""],
      [5, "↳ Builder"],
      [3, ""],
      [1, "↳ Scout"],
    ]);
    // They obey the type filter like any other link: Web alone now has two rows.
    expect(kindCounts(shown)).toEqual([
      { kind: "web", count: 2 },
      { kind: "image", count: 1 },
      { kind: "file", count: 1 },
    ]);
  });

  it("mark a missing path after the path, keeping the sub-agent", () => {
    expect(rowMark({ ...link("file", 1), missing: true })).toBe("missing");
    expect(rowMark({ ...link("file", 1), missing: true, via: "Scout" })).toBe("missing · ↳ Scout");
  });
});

describe("LinksStore push updates", () => {
  it("applies pushed snapshots, clears prior errors, and preserves data on error", () => {
    const store = new LinksStore<ChatLinks>(
      async () => ({ links: [] }),
      keepChatSubagents,
    );
    const seen: string[] = [];
    const off = store.subscribe((id) => seen.push(id));

    store.setError("a1", "disconnected");
    expect(store.get("a1")).toEqual({ data: null, error: "disconnected" });

    store.apply("a1", { links: [link("web", 1)], subagentLinks: [link("file", 2)] });
    expect(store.get("a1")).toEqual({ data: { links: [link("web", 1)], subagentLinks: [link("file", 2)] }, error: null });

    store.setError("a1", "temporary error");
    expect(store.get("a1").data?.links).toHaveLength(1);
    expect(store.get("a1").error).toBe("temporary error");

    // Applying a push without subagentLinks preserves the previous subagentLinks via keepChatSubagents.
    store.apply("a1", { links: [link("web", 3)] });
    expect(store.get("a1").data?.subagentLinks).toHaveLength(1);
    expect(store.get("a1").error).toBeNull();
    expect(seen).toEqual(["a1", "a1", "a1", "a1"]);
    off();
  });
});
