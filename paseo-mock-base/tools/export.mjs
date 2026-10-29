#!/usr/bin/env node
// Exports one PNG per section × variant × viewport of a mock page.
//
//   node tools/export.mjs <mock-url> [out-dir] [--vp=desktop,phone] [--theme=dark,pureBlack] [--scale=1] [--prefix=name]
//
// Defaults: all viewports the mock offers, its default theme, scale 1,
// out-dir ~/www/webshare/images, prefix = the mock's folder name.
// Files: <prefix>-<section>-<variant>-<viewport>[-<theme>].png
// Also the regression check for base changes: export the demo, eyeball it.
// A region in the URL's hash (#...?region=sidebar) exports just that region.

import { chromium } from "playwright"; // local devDependency: npm install in the kit folder
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const opts = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
const [url, outDir = join(homedir(), "www/webshare/images")] = args.filter((a) => !a.startsWith("--"));
if (!url) {
  console.error("usage: export.mjs <mock-url> [out-dir] [--vp=a,b] [--theme=a,b] [--scale=1] [--prefix=name]");
  process.exit(2);
}

const target = new URL(url);
target.searchParams.set("export", "1");
const prefix = opts.prefix || target.pathname.split("/").filter(Boolean).pop()?.replace(/\.html$/, "") || "mock";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: Number(opts.scale || 1) });
await page.goto(target.href, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.MockKit);
const kit = await page.evaluate(() => ({
  sections: window.MockKit.sections,
  viewports: document.documentElement.dataset.viewports?.split(/\s+/) ?? Object.keys(window.MockKit.viewports),
  theme: window.MockKit.state.theme,
}));

const vps = opts.vp ? opts.vp.split(",") : kit.viewports;
const themes = opts.theme ? opts.theme.split(",") : [kit.theme];
const written = [];
for (const sec of kit.sections) {
  const variants = sec.variants.length ? sec.variants.map((v) => v.id) : [null];
  for (const variant of variants) {
    for (const vp of vps) {
      for (const theme of themes) {
        await page.evaluate((s) => window.MockKit.set(s), { section: sec.id, variant, vp, theme });
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        const name = [prefix, sec.id, variant, vp, themes.length > 1 ? theme : null].filter(Boolean).join("-").toLowerCase();
        const file = join(outDir, `${name}.png`);
        await page.locator(".kit-frame-clip").screenshot({ path: file });
        written.push(file);
      }
    }
  }
}
await browser.close();
console.log(written.join("\n"));
