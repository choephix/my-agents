import { describe, expect, it } from "vitest";
import type { Link, LinkKind, WorkspaceTab } from "../shared/links";
import { byTab, bySite, flatRows, searchFilter, subagentExtra } from "./workspace";

const link = (key: string, lastAt: number, extra: Partial<Link> = {}): Link => ({
  key,
  kind: "web" as LinkKind,
  title: key,
  where: "host",
  path: key,
  glyph: "Globe",
  url: `https://${key}`,
  lastAt,
  ...extra,
});
const tab = (title: string, links: Link[], extra: Partial<WorkspaceTab> = {}): WorkspaceTab => ({ agentId: title, title, provider: "omp", closed: false, links, ...extra });

describe("flat rows", () => {
  it("show a link several tabs mention once, naming the tab that mentioned it last and counting the others", () => {
    const tabs = [
      tab("Alpha", [link("a.dev/x", 5), link("b.dev", 2)]),
      tab("Beta", [link("a.dev/x", 9)]),
      tab("Gamma", [link("a.dev/x", 1)]),
    ];
    expect(flatRows(tabs, false).map((row) => [row.link.key, row.link.lastAt, row.tab.title, row.others])).toEqual([
      ["a.dev/x", 9, "Beta", 2],
      ["b.dev", 2, "Alpha", 0],
    ]);
  });

  it("mark a link whose newest mention is in a closed tab with that closed tab", () => {
    const tabs = [tab("Open", [link("a.dev", 3)]), tab("Gone", [link("a.dev", 7), link("c.dev", 1)], { closed: true })];
    expect(flatRows(tabs, false).map((row) => [row.link.key, row.tab.title, row.tab.closed, row.others])).toEqual([
      ["a.dev", "Gone", true, 1],
      ["c.dev", "Gone", true, 0],
    ]);
  });

  it("add sub-agent links only when shown; `+N subagents` counts links no tab mentioned itself", () => {
    const tabs = [
      tab("Alpha", [link("a.dev", 5)], { subagentLinks: [link("b.dev", 8, { via: "Scout" }), link("c.dev", 1, { via: "Scout" })] }),
      // Beta mentioned c.dev itself, so only b.dev is new to the workspace.
      tab("Beta", [link("c.dev", 4)]),
    ];
    expect(subagentExtra(tabs)).toBe(1);
    expect(flatRows(tabs, false).map((row) => row.link.key)).toEqual(["a.dev", "c.dev"]);
    expect(flatRows(tabs, true).map((row) => [row.link.key, row.tab.title, row.link.via, row.others])).toEqual([
      ["b.dev", "Alpha", "Scout", 0],
      ["a.dev", "Alpha", undefined, 0],
      ["c.dev", "Beta", undefined, 1],
    ]);
  });

  it("merge a link's variants across tabs: every distinct URL once, counts summed, newest first; a single URL shows none", () => {
    const page = "http://mock.test:8080/pages/m";
    const variant = (query: string, count: number, lastAt: number, title?: string) => ({ url: `${page}${query}`, query, ...(title ? { title } : {}), count, lastAt });
    const tabs = [
      tab("Alpha", [link("m", 5, { url: `${page}?f=a`, variants: [variant("?f=a", 2, 5, "A"), variant("", 1, 1)] }), link("one", 3, { variants: [variant("", 2, 3)] })]),
      tab("Mocks", [link("m", 9, { url: `${page}?f=b`, variants: [variant("?f=b", 1, 9), variant("?f=a", 3, 4)] })]),
      tab("Gamma", [link("one", 2, { variants: [variant("", 1, 2)] })]),
    ];
    const [m, one] = flatRows(tabs, false);
    expect([m!.link.url, m!.tab.title, m!.others]).toEqual([`${page}?f=b`, "Mocks", 1]);
    expect(m!.link.variants).toEqual([variant("?f=b", 1, 9), variant("?f=a", 5, 5, "A"), variant("", 1, 1)]);
    expect(one!.link).not.toHaveProperty("variants");
    // By tab keeps each tab's own variants, with the same 2+ rule.
    expect(byTab(tabs, false, () => true).map((group) => [group.title, group.rows.map((row) => row.link.variants?.length)])).toEqual([
      ["Mocks", [2]],
      ["Alpha", [2, undefined]],
      ["Gamma", [undefined]],
    ]);
  });
});

describe("grouping", () => {
  const tabs = [
    tab("Old", [link("a.dev", 1)]),
    tab("Closed newest", [link("b.dev", 50)], { closed: true }),
    tab("New", [link("c.dev", 9), link("a.dev", 3)]),
    tab("Closed old", [link("d.dev", 2)], { closed: true }),
    tab("Empty", []),
  ];

  it("by tab: open tabs newest first, then closed tabs newest first; tabs without matching links drop out", () => {
    expect(byTab(tabs, false, () => true).map((group) => [group.title, group.tab?.closed, group.rows.length])).toEqual([
      ["New", false, 2],
      ["Old", false, 1],
      ["Closed newest", true, 1],
      ["Closed old", true, 1],
    ]);
    expect(byTab(tabs, false, searchFilter("c.dev")).map((group) => group.title)).toEqual(["New"]);
  });

  it("by site: one group per host (GitHub per repo) or folder, newest group first, with Flat's rows", () => {
    const rows = flatRows(
      [
        tab("Alpha", [
          link("github.com/getpaseo/paseo/pull/12", 9, { url: "https://github.com/getpaseo/paseo/pull/12" }),
          link("file:/home/user/a.md", 7, { kind: "file", where: "~/notes", url: undefined }),
          link("mock.test:8080/pages/x", 5, { url: "http://mock.test:8080/pages/x" }),
          link("github.com/getpaseo/paseo/issues/3", 4, { url: "https://github.com/getpaseo/paseo/issues/3" }),
          link("mock.test:8080/images/y.png", 2, { kind: "image", url: "http://mock.test:8080/images/y.png" }),
        ]),
      ],
      false,
    );
    expect(bySite(rows).map((group) => [group.title, group.rows.length])).toEqual([
      ["github.com/getpaseo/paseo", 2],
      ["~/notes", 1],
      ["mock.test:8080", 2],
    ]);
  });
});
