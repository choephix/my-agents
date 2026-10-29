import { describe, expect, it } from "vitest";
import { addProse, siteFor, subagentLinks, type LinkMap } from "./links";

const site = siteFor("/home/user", "http://mock.test:8080");

/** A transcript's links from assistant messages given as [text, minute]. */
function said(...messages: [text: string, minute: number][]): LinkMap {
  const links: LinkMap = new Map();
  for (const [text, minute] of messages) addProse(links, { role: "assistant", text, at: minute * 60_000 }, site);
  return links;
}

describe("subagentLinks", () => {
  it("adds nothing when every sub-agent link is already in the chat (no toggle)", () => {
    const chat = said(["See https://github.com/getpaseo/paseo/pull/12 and ![mock](http://mock.test:8080/images/a.png)", 1]);
    const scout = said(["Checked https://github.com/getpaseo/paseo/pull/12/ again", 5], ["Mock: `~/www/webshare/images/a.png`", 6]);
    expect(subagentLinks(chat, [{ name: "Scout", links: scout }])).toEqual([]);
  });

  it("counts each new link once across sub-agents and marks the one that mentioned it last", () => {
    const chat = said(["Docs are at https://paseo.sh/docs", 1]);
    const scout = said(["Docs: https://paseo.sh/docs and https://github.com/getpaseo/paseo/issues/7", 2]);
    const builder = said(["Fixed per https://github.com/getpaseo/paseo/issues/7", 9], ["Mock at http://mock.test:8080/pages/m.html", 4]);
    const added = subagentLinks(chat, [
      { name: "Scout", links: scout },
      { name: "Builder", links: builder },
    ]);
    expect(added.map(({ key, via, lastAt }) => ({ key, via, minute: lastAt / 60_000 }))).toEqual([
      { key: "https://github.com/getpaseo/paseo/issues/7", via: "Builder", minute: 9 },
      { key: "http://mock.test:8080/pages/m.html", via: "Builder", minute: 4 },
    ]);
  });
});
