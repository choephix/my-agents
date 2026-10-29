import { describe, expect, it } from "vitest";
import { addProse, listLinks, siteFor, type LinkMap } from "./links";

/** Each row's title and snippet for one assistant message (synthetic prose). */
function snippets(text: string) {
  const links: LinkMap = new Map();
  addProse(links, { role: "assistant", text, at: 0 }, siteFor("/home/user", "http://mock.test:8080"));
  return listLinks(links).map(({ title, snippet }) => [title, snippet]);
}

describe("snippets", () => {
  it("take the link's own sentence, the link read as its title", () => {
    expect(
      snippets(
        "I added an example to `/home/user/workspace/acme-app/.scratch/example-notes/example-notes.md:256-262`. The example is ready for review.",
      ),
    ).toEqual([["example-notes.md", "I added an example to example-notes.md."]]);
  });

  it("strip Markdown: list markers, bold and code spans", () => {
    expect(
      snippets(
        "- **Temp files:** sample scripts and data, 2 MB in `/home/user/fixture-archive/mentioned-links/`. They are used by the sample build. The sample source copy `/home/user/fixture-archive/sample-source/` is a temporary fixture.",
      ),
    ).toEqual([
      ["mentioned-links/", "Temp files: sample scripts and data, 2 MB in mentioned-links/."],
      ["sample-source/", "The sample source copy sample-source/ is a temporary fixture."],
    ]);
  });

  it("borrow the sentence before when the link's own says almost nothing, cut to about 120 characters", () => {
    const [[, snippet]] = snippets(
      "The sample screen has type filters. Each type filter appears only when it has results. The filter bar is visible when several result types are available; otherwise it takes no space. Saved in `/home/user/workspace/acme-app/.scratch/example-notes/example-notes.md:324`.",
    ) as [[string, string]];
    expect(snippet).toBe("…otherwise it takes no space. Saved in example-notes.md.");
  });

  it("give an embed on its own line its caption, else the line above it, without repeating its title", () => {
    expect(
      snippets(
        "All sample variants are at `http://mock.test:8080/pages/sample-mocks/`, with a light/dark switch.\n\n![Sample grouped view](/home/user/www/webshare/images/sample-by-group.png)\n**Sample:** grouped results, with one line per link.",
      ),
    ).toEqual([
      ["Sample grouped view", "Sample: grouped results, with one line per link."],
      ["sample-mocks", "All sample variants are at sample-mocks, with a light/dark switch."],
    ]);
    expect(
      snippets(
        "Page: `http://mock.test:8080/pages/sample-mocks-2/` (light/dark switch at the top).\n\n![Example](/home/user/www/webshare/images/sample-image.png)",
      )[0],
    ).toEqual(["Example", "Page: sample-mocks-2 (light/dark switch at the top)."]);
  });
});
