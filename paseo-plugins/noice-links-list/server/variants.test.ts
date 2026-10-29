import { describe, expect, it } from "vitest";
import { addProse, listLinks, siteFor, type LinkMap } from "./links";

const PAGE = "http://mock.test:8080/component-design/widget-layout.html";

/** The rows for messages given as [role, text, minute]. */
function rows(...messages: [role: "user" | "assistant", text: string, minute: number][]) {
  const links: LinkMap = new Map();
  for (const [role, text, minute] of messages) addProse(links, { role, text, at: minute * 60_000 }, siteFor("/home/user", "http://mock.test:8080"));
  return listLinks(links);
}

/**
 * Synthetic mentions of widget-layout.html, in message
 * order: [role, minute, query, link text]. Mentions of one minute came in one message.
 */
const EXAMPLE_MENTIONS: [role: "user" | "assistant", minute: number, query: string, text: string | null][] = [
  ["assistant", 47, "", null],
  ["assistant", 75, "?v=alpha&caption=1", "alpha"],
  ["assistant", 75, "?v=beta&caption=1", "beta"],
  ["assistant", 75, "?v=gamma&caption=1", "gamma"],
  ["assistant", 75, "?v=delta&caption=1", "delta"],
  ["assistant", 75, "?v=epsilon&caption=1", "epsilon"],
  ["assistant", 75, "?v=zeta&caption=1", "zeta"],
  ["assistant", 75, "?v=grid&caption=1", "grid"],
  ["assistant", 88, "?v=grid&caption=1", "grid"],
  ["assistant", 88, "?v=grid2&caption=1", "grid2"],
  ["assistant", 88, "?v=grid3&caption=1", "grid3"],
  ["assistant", 88, "?v=grid4&caption=1", "grid4"],
  ["assistant", 88, "?v=grid5&caption=1", "grid5"],
  ["assistant", 88, "?v=labels&caption=1", "labels"],
  ["assistant", 88, "?v=beta&caption=1", "beta"],
  ["assistant", 88, "?v=alpha&caption=1", "alpha"],
  ["user", 108, "?v=labels&position=above&caption=1&note=1&detail=1&trail=mid&source=docs&items=list", null],
  ["user", 108, "?v=beta&position=below&caption=1&note=1&detail=1&trail=mid&source=docs&items=list", null],
  ["user", 108, "?v=grid3&position=below&caption=1&note=1&detail=1&trail=mid&source=docs&items=list&header=block&content=1&theme=dark", null],
  ["assistant", 109, "?v=grid3&position=below&caption=1&note=1&detail=1&trail=mid&source=docs&items=list&header=block&content=1&theme=dark&sep=line", null],
  ["assistant", 109, "?v=grid3&position=below&caption=1&note=1&detail=1&trail=mid&source=docs&items=list&header=block&content=1&theme=dark&sep=space", null],
  ["assistant", 109, "?v=labels&position=above&sep=line&caption=1&items=list", null],
  ["assistant", 109, "?v=beta&position=above&sep=line&caption=1&items=list", null],
  ["assistant", 109, "?v=beta&position=below&sep=line&caption=1&items=list", null],
  ["assistant", 111, "?v=labels&position=below&caption=1&note=1&detail=1&trail=mid&source=docs&items=list&header=block&content=1&theme=dark&sep=none", null],
  ["assistant", 111, "?v=labels&position=below&caption=1&note=1&detail=1&trail=mid&source=docs&items=list&header=block&content=1&theme=dark&sep=line", null],
  ["assistant", 111, "?v=labels&position=below&caption=1&note=1&detail=1&trail=mid&source=docs&items=list&header=block&content=1&theme=dark&sep=space", null],
];

describe("variants", () => {
  it("folds every widget-layout.html variant of a sample conversation into one row, newest variant first", () => {
    const messages = new Map<string, { role: "user" | "assistant"; minute: number; parts: string[] }>();
    for (const [role, minute, query, text] of EXAMPLE_MENTIONS) {
      const id = `${role}:${minute}`;
      const message = messages.get(id) ?? { role, minute, parts: [] };
      message.parts.push(text ? `[${text}](${PAGE}${query})` : `${PAGE}${query}`);
      messages.set(id, message);
    }
    const [row, ...rest] = rows(...[...messages.values()].map(({ role, minute, parts }): [typeof role, string, number] => [role, parts.join("\n- "), minute]));
    expect(rest).toEqual([]);
    const sepSpace = `${PAGE}?v=labels&position=below&caption=1&note=1&detail=1&trail=mid&source=docs&items=list&header=block&content=1&theme=dark&sep=space`;
    expect(row).toMatchObject({ key: PAGE, kind: "web", title: "widget-layout.html", where: "mock.test:8080", url: sepSpace, lastAt: 111 * 60_000 });
    const variants = row!.variants!;
    expect(variants).toHaveLength(24);
    expect(variants[0]).toEqual({ url: sepSpace, query: sepSpace.slice(PAGE.length), count: 1, lastAt: 111 * 60_000 });
    expect(variants.at(-1)).toEqual({ url: PAGE, query: "", count: 1, lastAt: 47 * 60_000 });
    expect(variants.map((variant) => variant.lastAt)).toEqual([...variants.map((variant) => variant.lastAt)].sort((a, b) => b - a));
    expect(variants.find((variant) => variant.query === "?v=grid&caption=1")).toEqual({
      url: `${PAGE}?v=grid&caption=1`,
      query: "?v=grid&caption=1",
      title: "grid",
      count: 2,
      lastAt: 88 * 60_000,
    });
  });

  it("ignores the fragment, a trailing slash, the default port and the host's case", () => {
    const [row, ...rest] = rows(["assistant", "Docs: https://Paseo.sh:443/docs/ then https://paseo.sh/docs", 1], ["assistant", "See https://paseo.sh/docs#install", 2]);
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ key: "https://paseo.sh/docs", title: "docs", url: "https://paseo.sh/docs#install" });
    expect(row!.variants).toEqual([
      { url: "https://paseo.sh/docs#install", query: "#install", count: 1, lastAt: 2 * 60_000 },
      { url: "https://paseo.sh/docs", query: "", count: 2, lastAt: 60_000 },
    ]);
  });

  it("reads /dir/index.html as /dir/ on the webshare only, and keeps merging webshare paths with their URL", () => {
    const links = rows(
      ["assistant", "Mocks: http://mock.test:8080/pages/sample-mocks/index.html", 1],
      ["assistant", "Same: http://mock.test:8080/pages/sample-mocks/ and `~/www/webshare/pages/sample-mocks/`", 2],
      ["assistant", "Elsewhere https://docs.dev/guide/index.html and https://docs.dev/guide/", 3],
    );
    expect(links.map(({ key, variants }) => ({ key, variants: variants?.length }))).toEqual([
      { key: "https://docs.dev/guide/index.html", variants: undefined },
      { key: "https://docs.dev/guide", variants: undefined },
      { key: "http://mock.test:8080/pages/sample-mocks", variants: undefined },
    ]);
  });

  it("emits no variants for a link mentioned twice identically", () => {
    const [row, ...rest] = rows(["user", "Is [the docs](https://paseo.sh/docs?tab=web) right?", 1], ["assistant", "Yes, [the docs](https://paseo.sh/docs?tab=web).", 2]);
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ title: "the docs", url: "https://paseo.sh/docs?tab=web" });
    expect(row).not.toHaveProperty("variants");
  });

  it("lists the single variant too when asked (the links page merges them across tabs); files never have any", () => {
    const links: LinkMap = new Map();
    addProse(links, { role: "assistant", text: "Twice [the docs](https://paseo.sh/docs?tab=web) and `/home/user/notes.md`", at: 60_000 }, siteFor("/home/user", "http://mock.test:8080"));
    addProse(links, { role: "assistant", text: "Again https://paseo.sh/docs?tab=web", at: 120_000 }, siteFor("/home/user", "http://mock.test:8080"));
    expect(listLinks(links, true).map(({ title, variants }) => [title, variants])).toEqual([
      ["the docs", [{ url: "https://paseo.sh/docs?tab=web", query: "?tab=web", title: "the docs", count: 2, lastAt: 120_000 }]],
      ["notes.md", undefined],
    ]);
  });

  it("keeps one link text all variants share, names the page when the text names a variant", () => {
    const shared = rows(["assistant", `[Widget layout](${PAGE}?v=a) and [Widget layout](${PAGE}?v=b)`, 1]);
    expect(shared.map(({ title, variants }) => [title, variants?.map((variant) => variant.title)])).toEqual([
      ["Widget layout", ["Widget layout", "Widget layout"]],
    ]);
    expect(rows(["assistant", `[grid](${PAGE}?v=grid&caption=1)`, 1]).map(({ title }) => title)).toEqual(["widget-layout.html"]);
  });
});
