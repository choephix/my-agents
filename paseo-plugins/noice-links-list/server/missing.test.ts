import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addProse, listLinks, siteFor, type LinkMap } from "./links";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "mentioned-links-"));
  await mkdir(path.join(home, "www", "webshare", "images"), { recursive: true });
});
afterEach(() => rm(home, { recursive: true, force: true }));

describe("missing", () => {
  it("is checked on every listing for paths and webshare files, never for web URLs", async () => {
    const notes = path.join(home, "notes.md");
    const shot = path.join(home, "www", "webshare", "images", "shot.png");
    await writeFile(notes, "x");
    await writeFile(shot, "x");
    const links: LinkMap = new Map();
    addProse(
      links,
      { role: "assistant", text: `See \`${notes}\`, ![shot](http://mock.test:8080/images/shot.png) and https://paseo.sh/docs.`, at: 0 },
      siteFor(home, "http://mock.test:8080"),
    );
    const missing = () => Object.fromEntries(listLinks(links).map((link) => [link.title, link.missing ?? false]));
    expect(missing()).toEqual({ "notes.md": false, shot: false, docs: false });
    await rm(notes);
    await rm(shot);
    expect(missing()).toEqual({ "notes.md": true, shot: true, docs: false });
  });
});
