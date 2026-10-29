import { describe, expect, it } from "vitest";
import type { Link, LinkVariant } from "../shared/links";
import { queryParts, shortenPath, variantRows } from "./variants";

const variant = (url: string, lastAt: number): LinkVariant => {
  const cut = url.search(/[?#]/);
  return { url, query: cut < 0 ? "" : url.slice(cut), count: 1, lastAt };
};
const link = (key: string, variants: LinkVariant[]): Link => ({ key, kind: "web", title: "x", where: "host", path: key, glyph: "Globe", url: variants[0]!.url, lastAt: variants[0]!.lastAt, variants });

describe("variant rows", () => {
  it("put the bare URL first, derived from the newest variant when it was never mentioned on its own", () => {
    const row = link("https://site.dev/docs/page.html", [variant("https://site.dev/docs/page.html?v=tree&title=1#notes", 9), variant("https://site.dev/docs/page.html?v=card", 4)]);
    expect(variantRows(row)).toEqual([
      { url: "https://site.dev/docs/page.html", query: "" },
      { url: "https://site.dev/docs/page.html?v=tree&title=1#notes", query: "?v=tree&title=1#notes", lastAt: 9 },
      { url: "https://site.dev/docs/page.html?v=card", query: "?v=card", lastAt: 4 },
    ]);
  });

  it("use the mentioned bare URL first even when it is not the newest", () => {
    const row = link("https://site.dev/page", [variant("https://site.dev/page#install", 9), variant("https://site.dev/page", 5), variant("https://site.dev/page?x=1", 2)]);
    expect(variantRows(row).map((sub) => [sub.query, sub.lastAt])).toEqual([
      ["", 5],
      ["#install", 9],
      ["?x=1", 2],
    ]);
  });

  it("drop a webshare `index.html` the row's key dropped, and keep one the key kept", () => {
    const webshare = link("http://mock.test:8080/pages/mocks", [variant("http://mock.test:8080/pages/mocks/index.html?f=2", 9), variant("http://mock.test:8080/pages/mocks/?f=1", 3)]);
    expect(variantRows(webshare)[0]).toEqual({ url: "http://mock.test:8080/pages/mocks/", query: "" });
    const other = link("https://site.dev/index.html", [variant("https://site.dev/index.html?a=1", 9), variant("https://site.dev/index.html?a=2", 3)]);
    expect(variantRows(other)[0]).toEqual({ url: "https://site.dev/index.html", query: "" });
  });
});

describe("query parts", () => {
  it("split a literal query into faded syntax and keys and plain values, the fragment a value", () => {
    expect(queryParts("?v=tree3&pathpos=below&flag&empty=#notes")).toEqual([
      { text: "?v=", value: false },
      { text: "tree3", value: true },
      { text: "&pathpos=", value: false },
      { text: "below", value: true },
      { text: "&flag&empty=#", value: false },
      { text: "notes", value: true },
    ]);
  });

  it("keep a value's own `=` and a fragment-only variant", () => {
    expect(queryParts("?q=a=b")).toEqual([
      { text: "?q=", value: false },
      { text: "a=b", value: true },
    ]);
    expect(queryParts("#install")).toEqual([
      { text: "#", value: false },
      { text: "install", value: true },
    ]);
  });
});

describe("path shortening", () => {
  // Widths in characters; the client measures pixels.
  const at = (path: string, ...widths: number[]) => widths.map((width) => shortenPath(path, (text) => text.length <= width));

  it("keep the first segment and the last two of a GitHub URL, then drop the first, then the second-to-last", () => {
    expect(at("github.com/getpaseo/paseo/pull/123", 40, 30, 20, 6)).toEqual(["github.com/getpaseo/paseo/pull/123", "github.com/…/pull/123", "…/pull/123", "…/123"]);
  });

  it("go from a short webshare URL's full path to its last two segments, its last, then cut that at the end", () => {
    expect(at("mock.test:8080/component-design/widget-layout.html", 50, 40, 25, 12)).toEqual([
      "mock.test:8080/component-design/widget-layout.html",
      "…/component-design/widget-layout.html",
      "…/widget-layout.html",
      "…/widget-la…",
    ]);
  });

  it("keep `~` and the `:line` suffix of a home file", () => {
    expect(at("~/workspace/acme-app/.scratch/example-notes/example-notes.md:318", 70, 38, 36, 30, 20)).toEqual([
      "~/workspace/acme-app/.scratch/example-notes/example-notes.md:318",
      "~/…/example-notes/example-notes.md:318",
      "…/example-notes/example-notes.md:318",
      "…/example-notes.md:318",
      "…/example-notes.md:…",
    ]);
  });

  it("keep a folder's trailing slash on its last segment", () => {
    expect(at("mock.test:8080/acme-app-other-artifacts/acme-portal/share-previews/final/", 40, 30, 10)).toEqual([
      "mock.test:8080/…/share-previews/final/",
      "…/share-previews/final/",
      "…/final/",
    ]);
  });

  it("cut a bare host at the end", () => {
    expect(at("acme-portal.vercel.app", 30, 10)).toEqual(["acme-portal.vercel.app", "acme-port…"]);
  });
});
