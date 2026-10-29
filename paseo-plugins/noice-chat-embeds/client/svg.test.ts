import { describe, expect, it } from "vitest";
import { checkSvg, MAX_SVG_CHARS, resolveCssVars, svgDataUri, type SvgPalette, unescapeSvg } from "./svg";

const palette: SvgPalette = {
  foreground: "#fafafa",
  muted: "#a1a5a4",
  accent: "#58f287",
  accentForeground: "#000000",
  danger: "#ef4444",
  warning: "#f59e0b",
  success: "#22c55e",
  border: "#27272a",
  background: "#1d2326",
};

describe("resolveCssVars", () => {
  it("maps known names, including prefixed and suffixed spellings, to theme colours", () => {
    expect(resolveCssVars('fill="var(--fg)" stroke="var(--accent)"', palette)).toBe('fill="#fafafa" stroke="#58f287"');
    expect(resolveCssVars("var(--color-muted) var(--error-color) var( --WARNING ) var(--success) var(--border) var(--bg)", palette))
      .toBe("#a1a5a4 #ef4444 #f59e0b #22c55e #27272a #1d2326");
  });

  it("ignores the fallback of a known name and uses it for an unknown one, resolving nested var()", () => {
    expect(resolveCssVars("var(--accent, red)", palette)).toBe("#58f287");
    expect(resolveCssVars("var(--brand, rgb(1, 2, 3))", palette)).toBe("rgb(1, 2, 3)");
    expect(resolveCssVars("var(--brand, var(--nope, var(--muted)))", palette)).toBe("#a1a5a4");
  });

  it("gives an unknown name without fallback the foreground colour, and leaves look-alikes and unbalanced text", () => {
    expect(resolveCssVars("var(--brand)", palette)).toBe("#fafafa");
    expect(resolveCssVars("myvar(--fg)", palette)).toBe("myvar(--fg)");
    expect(resolveCssVars("fill: var(--fg", palette)).toBe("fill: var(--fg");
  });
});

describe("checkSvg", () => {
  it("sizes from width/height in px, else from the viewBox", () => {
    expect(checkSvg('<svg width="300px" height="150" viewBox="0 0 900 420"></svg>')).toEqual({ status: "ok", width: 300, height: 150 });
    expect(checkSvg('<?xml version="1.0"?>\n<!-- mock -->\n<svg width="100%" viewBox="0,0,900,420" font-family="sans-serif">\n</svg>\n'))
      .toEqual({ status: "ok", width: 900, height: 420 });
  });

  it("rejects text that isn't a complete svg, one without any size, and oversized blocks", () => {
    expect(checkSvg("<div><svg viewBox=\"0 0 1 1\"></svg></div>").status).toBe("error");
    expect(checkSvg('<svg viewBox="0 0 10 10"><rect/>').status).toBe("error");
    expect(checkSvg('<svg viewBox="0 0 0 10"></svg>').status).toBe("error");
    expect(checkSvg("<svg></svg>").status).toBe("error");
    const big = `<svg viewBox="0 0 1 1"><!--${"x".repeat(MAX_SVG_CHARS)}--></svg>`;
    expect(checkSvg(big)).toMatchObject({ status: "error", message: expect.stringContaining("KB") });
  });
});

describe("svgDataUri", () => {
  it("adds the namespaces an SVG image needs and fills in theme colours", () => {
    const svg = decodeURIComponent(svgDataUri('<svg viewBox="0 0 1 1"><use xlink:href="#a" fill="var(--fg)"/></svg>', palette).split(",")[1]);
    expect(svg).toMatch(/^<svg xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink" xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox/);
    expect(svg).toContain('fill="#fafafa"');
    const declared = decodeURIComponent(svgDataUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>', palette).split(",")[1]);
    expect(declared.match(/xmlns=/g)).toHaveLength(1);
  });
});

describe("unescapeSvg", () => {
  it("decodes a block a provider sent HTML-escaped, and leaves raw SVG with entities in text alone", () => {
    expect(unescapeSvg("&lt;svg viewBox=&quot;0 0 1 1&quot;&gt;&lt;text&gt;a &amp;amp; b&lt;/text&gt;&lt;/svg&gt;"))
      .toBe('<svg viewBox="0 0 1 1"><text>a &amp; b</text></svg>');
    const raw = '<svg viewBox="0 0 1 1"><text>&lt;tag&gt;</text></svg>';
    expect(unescapeSvg(raw)).toBe(raw);
  });
});
